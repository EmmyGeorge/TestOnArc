/**
 * NairaLock backend server.
 *
 * Routes:
 *   GET  /api/health              — liveness check
 *   GET  /api/banks               — list of Nigerian banks from Paystack
 *   POST /api/resolve-account     — resolve bank account name
 *   POST /api/disburse            — verify onchain tx then send NGN to borrower's bank
 *   POST /api/create-payment      — create Paystack link for NGN repayment
 *   POST /api/webhook/paystack    — Paystack webhook (charge.success)
 *   POST /api/register-borrower  — register a borrower address for cron scanning
 */
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import {
  initializeRepayment,
  verifyTransaction,
  verifyWebhookSignature,
  getBanks,
  resolveAccount,
  createTransferRecipient,
  initiateTransfer,
} from "./paystack";
import { callMarkRepaid, verifyLoanOpened } from "./onchain";
import { saveBorrower, startCron } from "./cron";

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

// ── Resolve account ───────────────────────────────────────────────────────────
app.post("/api/resolve-account", async (req, res) => {
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

// ── Disburse NGN automatically after confirmed onchain tx ─────────────────────
app.post("/api/disburse", async (req, res) => {
  try {
    const { txHash, borrowerAddress, ngnAmount, accountNumber, bankCode, accountName } = req.body as {
      txHash?: string;
      borrowerAddress?: string;
      ngnAmount?: number;
      accountNumber?: string;
      bankCode?: string;
      accountName?: string;
    };

    if (!txHash || !borrowerAddress || !ngnAmount || !accountNumber || !bankCode || !accountName) {
      res.status(400).json({ error: "txHash, borrowerAddress, ngnAmount, accountNumber, bankCode, and accountName are required" });
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

    // Verify the transaction onchain — ensures the loan was actually opened with this borrower
    const { verified } = await verifyLoanOpened(txHash, borrowerAddress, BigInt(Math.round(ngnAmount)));
    if (!verified) {
      res.status(400).json({ error: "Transaction could not be verified onchain. Wait for confirmation and try again." });
      return;
    }

    // Create Paystack transfer recipient and initiate transfer
    const reference = `nairalock-disburse-${borrowerAddress.slice(2, 10).toLowerCase()}-${Date.now()}`;
    const recipientCode = await createTransferRecipient(accountName, accountNumber, bankCode);
    const transfer = await initiateTransfer(ngnAmount, recipientCode, reference, `NairaLock loan disbursement for ${borrowerAddress.slice(0, 10)}`);

    console.log(`[disburse] Transfer initiated: ${transfer.transferCode} for ${borrowerAddress} — ₦${ngnAmount}`);
    res.json({ ok: true, transferCode: transfer.transferCode, reference: transfer.reference, status: transfer.status });
  } catch (err) {
    console.error("[disburse]", err);
    res.status(500).json({ error: "Disbursement failed. The team has been notified." });
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

  res.status(200).send("OK");

  let payload: { event: string; data: { reference: string } };
  try { payload = JSON.parse(rawBody) as typeof payload; }
  catch { console.error("[webhook] Invalid JSON body"); return; }

  if (payload.event !== "charge.success") return;

  const { reference } = payload.data;
  let txData: Awaited<ReturnType<typeof verifyTransaction>>;
  try { txData = await verifyTransaction(reference); }
  catch (err) { console.error("[webhook] Verification failed for ref", reference, err); return; }

  if (txData.status !== "success") return;

  const meta = txData.metadata as Record<string, string>;
  const paymentType = meta?.paymentType;
  const borrowerAddress = meta?.borrowerAddress;
  const loanIndex = meta?.loanIndex !== undefined ? Number(meta.loanIndex) : 0;

  if (!borrowerAddress || !/^0x[0-9a-fA-F]{40}$/i.test(borrowerAddress)) {
    console.error("[webhook] Invalid or missing borrowerAddress in metadata");
    return;
  }

  if (paymentType === "repay") {
    try {
      console.log(`[webhook] Marking repaid for ${borrowerAddress} loan #${loanIndex} (ref=${reference})`);
      const hash = await callMarkRepaid(borrowerAddress, loanIndex);
      console.log(`[webhook] markRepaid tx=${hash} for ${borrowerAddress} loan #${loanIndex}`);
    } catch (err) {
      console.error(`[webhook] callMarkRepaid failed for ${borrowerAddress}:`, err);
    }
  } else {
    console.warn(`[webhook] Unknown paymentType "${paymentType}" for ref ${reference}`);
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
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] NairaLock backend listening on port ${PORT}`);
  startCron();
});

export default app;
