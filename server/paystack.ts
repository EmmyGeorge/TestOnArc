/**
 * Paystack helpers — create NGN repayment links and verify webhooks.
 */
import crypto from "crypto";

const PAYSTACK_BASE = "https://api.paystack.co";

function getSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not set in environment");
  return key;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

/**
 * Creates a Paystack payment link for NGN loan repayment.
 * Stores borrower address and payment type in metadata so the webhook can
 * identify which loan to settle.
 */
export async function initializeRepayment(
  borrowerAddress: string,
  ngnAmountWhole: number, // whole Naira, e.g. 80000
  borrowerEmail: string
): Promise<InitializePaymentResult> {
  const secretKey = getSecretKey();
  const reference = `nairalock-repay-${borrowerAddress.slice(2, 10).toLowerCase()}-${Date.now()}`;

  const body = {
    email: borrowerEmail,
    amount: ngnAmountWhole * 100, // Paystack uses kobo (1/100 of NGN)
    currency: "NGN",
    reference,
    metadata: {
      paymentType: "repay",
      borrowerAddress,
    },
    callback_url: process.env.PAYSTACK_CALLBACK_URL || "https://nairalock.app/repay/callback",
  };

  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Paystack initialize failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { data: { authorization_url: string; access_code: string; reference: string } };
  return {
    authorizationUrl: data.data.authorization_url,
    accessCode: data.data.access_code,
    reference: data.data.reference,
  };
}

/**
 * Verifies a Paystack transaction by reference.
 * Always verify server-side before trusting a webhook.
 */
export async function verifyTransaction(reference: string): Promise<{
  status: string;
  amount: number; // in kobo
  currency: string;
  metadata: Record<string, unknown>;
}> {
  const secretKey = getSecretKey();

  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Paystack verify failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    data: { status: string; amount: number; currency: string; metadata: Record<string, unknown> };
  };
  return data.data;
}

/**
 * Verifies the HMAC-SHA512 signature Paystack sends in x-paystack-signature.
 * Call this before processing any webhook event.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secretKey = getSecretKey();
  const hash = crypto.createHmac("sha512", secretKey).update(rawBody).digest("hex");
  // Constant-time comparison
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}
