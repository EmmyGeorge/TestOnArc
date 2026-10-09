/**
 * Paystack helpers — NGN repayment links, account resolution, transfers, webhook verification.
 */
import crypto from "crypto";

const PAYSTACK_BASE = "https://api.paystack.co";

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not set in environment");
  return key;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface InitializePaymentResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface BankItem {
  name: string;
  code: string;
}

export interface ResolvedAccount {
  accountName: string;
  accountNumber: string;
  bankCode: string;
}

export interface TransferResult {
  transferCode: string;
  reference: string;
  status: string;
}

// ── Repayment link ────────────────────────────────────────────────────────────

export async function initializeRepayment(
  borrowerAddress: string,
  ngnAmountWhole: number,
  borrowerEmail: string,
  loanIndex = 0
): Promise<InitializePaymentResult> {
  const secretKey = getSecretKey();
  const reference = `nairalock-repay-${borrowerAddress.slice(2, 10).toLowerCase()}-${loanIndex}-${Date.now()}`;

  const body = {
    email: borrowerEmail,
    amount: ngnAmountWhole * 100,
    currency: "NGN",
    reference,
    metadata: { paymentType: "repay", borrowerAddress, loanIndex: String(loanIndex) },
    callback_url: process.env.PAYSTACK_CALLBACK_URL || "https://nairalock.app/repay/callback",
  };

  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Paystack initialize failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: { authorization_url: string; access_code: string; reference: string } };
  return { authorizationUrl: data.data.authorization_url, accessCode: data.data.access_code, reference: data.data.reference };
}

// ── Verify transaction ────────────────────────────────────────────────────────

export async function verifyTransaction(reference: string): Promise<{
  status: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
}> {
  const secretKey = getSecretKey();
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`Paystack verify failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: { status: string; amount: number; currency: string; metadata: Record<string, unknown> } };
  return data.data;
}

// ── Webhook signature ─────────────────────────────────────────────────────────

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secretKey = getSecretKey();
  const hash = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

// ── Bank list ─────────────────────────────────────────────────────────────────

export async function getBanks(): Promise<BankItem[]> {
  const secretKey = getSecretKey();
  const res = await fetch(`${PAYSTACK_BASE}/bank?currency=NGN&perPage=100`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch banks: ${res.status}`);
  const data = (await res.json()) as { data: { name: string; code: string }[] };
  return data.data.map((b) => ({ name: b.name, code: b.code }));
}

// ── Account resolution ────────────────────────────────────────────────────────

export async function resolveAccount(accountNumber: string, bankCode: string): Promise<ResolvedAccount> {
  const secretKey = getSecretKey();
  const url = `${PAYSTACK_BASE}/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secretKey}` } });
  if (!res.ok) throw new Error(`Account resolution failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: { account_name: string; account_number: string } };
  return {
    accountName: data.data.account_name,
    accountNumber: data.data.account_number,
    bankCode,
  };
}

// ── Transfer recipient ────────────────────────────────────────────────────────

export async function createTransferRecipient(
  accountName: string,
  accountNumber: string,
  bankCode: string
): Promise<string> {
  const secretKey = getSecretKey();
  const body = { type: "nuban", name: accountName, account_number: accountNumber, bank_code: bankCode, currency: "NGN" };
  const res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Create recipient failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: { recipient_code: string } };
  return data.data.recipient_code;
}

// ── Initiate transfer ─────────────────────────────────────────────────────────

export async function initiateTransfer(
  ngnAmountWhole: number,
  recipientCode: string,
  reference: string,
  reason: string
): Promise<TransferResult> {
  const secretKey = getSecretKey();
  const body = {
    source: "balance",
    amount: ngnAmountWhole * 100, // kobo
    recipient: recipientCode,
    reason,
    reference,
  };
  const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Transfer failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { data: { transfer_code: string; reference: string; status: string } };
  return { transferCode: data.data.transfer_code, reference: data.data.reference, status: data.data.status };
}
