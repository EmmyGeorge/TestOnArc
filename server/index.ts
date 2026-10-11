/**
 * NairaLock backend server — v2 with security fixes.
 *
 * Security fixes applied:
 *   - /api/disburse: wallet signature verification (borrower signs bank details)
 *   - /api/disburse: idempotency via SQLite (one payout per txHash+loanIndex)
 *   - /api/disburse: server re-resolves account — client accountName ignored
 *   - /api/create-payment: stores payment record in DB for retry
 *   - /api/webhook/paystack: verifies NGN amount >= ngnDebt before markRepaid
 *   - /api/webhook/paystack: handles transfer.failed + transfer.reversed
 *   - /api/resolve-account: rate limited
 *   - cron rebuilds borrowers from chain on startup
 */
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { verifyMessage } from "viem";
import {
  initializeRepayment,
  verifyWebhookSignature,
  getBanks,
  resolveAccount,
  createTransferRecipient,
  initiateTransfer,
} from "./paystack";
import {
  callMarkRepaid,
  verifyLoanOpened,
  getLoanNgnDebt,
} from "./onchain";
import { saveBorrower, startCron } from "./cron";
import {
  isDisbursed,
  createDisbursement,
  updateDisbursementStatus,
  createPaymentRecord,
  getPaymentRecord,
  updatePaymentStatus,
} from "./db";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors({
  origin: [
    "http://localhost:5173",
    `https://${process.env.PREVIEW_HOSTNAME || "localhost"}`,
    "https://testonarc-production.up.railway.app",
    /\.railway\.app$/,
  ],
}));

// Raw body for webhook — must come before express.json()
app.use("/api/webhook/paystack", express.raw({ type: "application/json" }));
app.use(express.json());

// ── Simple in-memory rate limiter for resolve-account ─────────────────────────
const resolveRateLimitMap = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = resolveRateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    resolveRateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  if (entry.count > 20) return true; // 20 req/min per IP
  return false;
}

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── Bank list ─────────────────────────────────────────────────────────────────
app.get("/api/banks", async (_req, res) => {
  try {
    const banks = await getBanks();
    res.json({ banks });
  } catch (err) {
    console.error("[banks]", err);
    res.status(500).json({ error: "Failed to fetch bank list" });
  }
});

// ── Resolve account — rate limited ───────────────────────────────────────────
app.post("/api/resolve-account", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
  if (isRateLimited(ip)) {
    res.status(429).json({ error: "Too many requests. Try again in a minute." });
    return;
  }
  try {
    const { accountNumber, bankCode } = req.body as { accountNumber?: string; bankCode?: string };
    if (!accountNumber || !bankCode) {
      res.status(400).json({ error: "accountNumber and bankCode are required" });
      return;
    }
    if (!/^\d{10}$/.test(accountNumber)) {
      res.status(400).json({ error: "Account number must be 10 digits" });
      return;
    }
    const resolved = await resolveAccount(accountNumber, bankCode);
    res.json(resolved);
  } catch (err) {
    console.error("[resolve-account]", err);
    res.status(400).json({ error: "Could not resolve account. Check the account number and bank." });
  }
});

// ── Disburse NGN — with wallet sig verification + idempotency ─────────────────
app.post("/api/disburse", async (req, res) => {
  try {
    const { txHash, borrowerAddress, ngnAmount, accountNumber, bankCode, signature } = req.body as {
      txHash?: string;
      borrowerAddress?: string;
      ngnAmount?: number;
      accountNumber?: string;
      bankCode?: string;
      signature?: string; // EIP-191 signature from borrower's wallet
    };

    if (!txHash || !borrowerAddress || !ngnAmount || !accountNumber || !bankCode || !signature) {
      res.status(400).json({ error: "txHash, borrowerAddress, ngnAmount, accountNumber, bankCode, and signature are required" });
      return;
    }

    if (!/^0x[0-9a-fA-F]{40}$/i.test(borrowerAddress)) {
      res.status(400).json({ error: "Invalid borrower address" });
      return;
    }

    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      res.status(400).json({ error: "Invalid tx hash" });
      return;
    }

    if (ngnAmount <= 0) {
      res.status(400).json({ error: "ngnAmount must be positive" });
      return;
    }

    // 1. Verify borrower signed { bankCode, accountNumber, txHash }
    // The message the borrower signs must include bank details so they can't be swapped
    const message = `NairaLock disburse\ntxHash:${txHash}\naccountNumber:${accountNumber}\nbankCode:${bankCode}`;
    let sigValid = false;
    try {
      const recovered = await verifyMessage({
        address: borrowerAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
      sigValid = recovered;
    } catch {
      sigValid = false;
    }
    if (!sigValid) {
      res.status(403).json({ error: "Signature verification failed. Sign the disbursal request with your wallet." });
      return;
    }

    // 2. Verify the transaction onchain
    const { verified, loanIndex } = await verifyLoanOpened(txHash, borrowerAddress, BigInt(Math.round(ngnAmount)));
    if (!verified) {
      res.status(400).json({ error: "Transaction could not be verified onchain. Wait for confirmation and try again." });
      return;
    }

    // 3. Idempotency — reject if already disbursed
    if (isDisbursed(txHash, loanIndex)) {
      res.status(409).json({ error: "This loan has already been disbursed." });
      return;
    }

    // 4. Server-side account resolution — ignore client-provided accountName
    const resolvedAccount = await resolveAccount(accountNumber, bankCode);
    const verifiedAccountName = resolvedAccount.accountName;

    // 5. Deterministic reference
    const paystackRef = `nld-${borrowerAddress.slice(2, 10).toLowerCase()}-${loanIndex}`;

    // 6. Record before transfer (idempotency guard)
    const created = createDisbursement({
      txHash,
      loanIndex,
      borrower: borrowerAddress,
      ngnAmount: Math.round(ngnAmount),
      paystackRef,
    });
    if (!created) {
      res.status(409).json({ error: "This loan has already been disbursed." });
      return;
    }

    // 7. Register borrower for cron
    saveBorrower(borrowerAddress);

    // 8. Create transfer recipient using server-resolved name
    const recipientCode = await createTransferRecipient(verifiedAccountName, accountNumber, bankCode);

    // 9. Initiate transfer
    const transfer = await initiateTransfer(
      Math.round(ngnAmount),
      recipientCode,
      paystackRef,
      `NairaLock loan for ${borrowerAddress.slice(0, 10)}`
    );

    updateDisbursementStatus(paystackRef, transfer.status === "success" ? "success" : "pending", transfer.transferCode);

    console.log(`[disburse] Transfer initiated: ${transfer.transferCode} for ${borrowerAddress} — ₦${ngnAmount}`);
    res.json({ ok: true, transferCode: transfer.transferCode, reference: transfer.reference, status: transfer.status, accountName: verifiedAccountName });
  } catch (err) {
    console.error("[disburse]", err);
    res.status(500).json({ error: "Disbursement failed. Please contact support." });
  }
});

// ── Create Paystack repayment link ────────────────────────────────────────────
app.post("/api/create-payment", async (req, res) => {
  try {
    const { borrowerAddress, ngnAmount, email, loanIndex } = req.body as {
      borrowerAddress: string;
      ngnAmount: number;
      email: string;
      loanIndex: number;
    };

    if (!borrowerAddress || !ngnAmount || !email || loanIndex === undefined) {
      res.status(400).json({ error: "borrowerAddress, ngnAmount, email, and loanIndex are required" });
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(borrowerAddress)) {
      res.status(400).json({ error: "Invalid borrower address" });
      return;
    }
    if (ngnAmount <= 0) {
      res.status(400).json({ error: "ngnAmount must be positive" });
      return;
    }

    const result = await initializeRepayment(borrowerAddress, ngnAmount, email, loanIndex);

    // Store payment record for retry if markRepaid fails
    createPaymentRecord({
      paystackRef: result.reference,
      borrower: borrowerAddress,
      loanIndex,
      ngnAmount: Math.round(ngnAmount),
    });

    res.json(result);
  } catch (err) {
    console.error("[create-payment]", err);
    res.status(500).json({ error: "Failed to create payment link" });
  }
});

// ── Paystack webhook ──────────────────────────────────────────────────────────
app.post("/api/webhook/paystack", async (req, res) => {
  const signature = req.headers["x-paystack-signature"] as string | undefined;
  if (!signature) { res.status(401).json({ error: "Missing signature" }); return; }

  const rawBody = (req.body as Buffer).toString("utf8");
  try {
    if (!verifyWebhookSignature(rawBody, signature)) { res.status(401).json({ error: "Invalid signature" }); return; }
  } catch { res.status(401).json({ error: "Signature verification failed" }); return; }

  // Always 200 immediately — Paystack will retry if we don't respond fast
  res.status(200).send("OK");

  let payload: { event: string; data: Record<string, unknown> };
  try { payload = JSON.parse(rawBody) as typeof payload; }
  catch { console.error("[webhook] Invalid JSON body"); return; }

  const { event, data } = payload;

  // ── charge.success — repayment ────────────────────────────────────────────
  if (event === "charge.success") {
    const reference = data.reference as string;
    const amount = data.amount as number; // kobo
    const currency = data.currency as string;

    // Only accept NGN payments
    if (currency !== "NGN") {
      console.warn(`[webhook] Ignoring non-NGN payment: ${currency} ref=${reference}`);
      return;
    }

    // Must be a reference we created
    const record = getPaymentRecord(reference);
    if (!record) {
      console.warn(`[webhook] Unknown reference ${reference} — ignoring`);
      return;
    }

    if (record.status === "settled") {
      console.log(`[webhook] Already settled ref=${reference}`);
      return;
    }

    // Verify amount on-chain — must be >= ngnDebt
    try {
      const ngnDebtOnchain = await getLoanNgnDebt(record.borrower, record.loan_index);
      const paidNgn = Math.floor(amount / 100); // kobo → NGN
      if (BigInt(paidNgn) < ngnDebtOnchain) {
        console.error(`[webhook] Underpayment: paid ₦${paidNgn} but debt is ₦${ngnDebtOnchain} ref=${reference}`);
        updatePaymentStatus(reference, "underpaid");
        return;
      }
    } catch (err) {
      console.error(`[webhook] Could not verify loan debt for ref=${reference}:`, err);
      // Don't settle — will be retried by cron
      return;
    }

    // Mark paid in DB then call markRepaid
    updatePaymentStatus(reference, "paid");
    try {
      console.log(`[webhook] Marking repaid for ${record.borrower} loan #${record.loan_index}`);
      const hash = await callMarkRepaid(record.borrower, record.loan_index);
      updatePaymentStatus(reference, "settled", hash);
      console.log(`[webhook] markRepaid tx=${hash} for ${record.borrower} loan #${record.loan_index}`);
    } catch (err) {
      console.error(`[webhook] callMarkRepaid failed — will retry via cron:`, err);
    }
    return;
  }

  // ── transfer.success ─────────────────────────────────────────────────────
  if (event === "transfer.success") {
    const reference = data.reference as string;
    updateDisbursementStatus(reference, "success");
    console.log(`[webhook] Transfer succeeded ref=${reference}`);
    return;
  }

  // ── transfer.failed / transfer.reversed ──────────────────────────────────
  if (event === "transfer.failed" || event === "transfer.reversed") {
    const reference = data.reference as string;
    updateDisbursementStatus(reference, event === "transfer.failed" ? "failed" : "reversed");
    console.error(`[webhook] Transfer ${event} ref=${reference} — manual intervention required`);
    // TODO: implement retry or refund logic
    return;
  }
});

// ── Register borrower for cron scanning ──────────────────────────────────────
app.post("/api/register-borrower", (req, res) => {
  const { address } = req.body as { address?: string };
  if (!address || !/^0x[0-9a-fA-F]{40}$/i.test(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }
  saveBorrower(address);
  res.json({ ok: true });
});

// ── Serve built frontend (production) ────────────────────────────────────────
const distPath = path.join(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/(.*)/, (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] NairaLock backend listening on port ${PORT}`);
  void startCron();
});

export default app;
