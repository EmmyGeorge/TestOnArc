/**
 * NairaLock backend server.
 *
 * Routes:
 *   POST /api/create-payment   — create Paystack link for NGN repayment
 *   POST /api/webhook/paystack — Paystack webhook (charge.success)
 *   POST /api/register-borrower — register a borrower address for cron scanning
 *   GET  /api/health           — liveness check
 */
import express from "express";
import cors from "cors";
import { initializeRepayment, verifyTransaction, verifyWebhookSignature } from "./paystack";
import { callMarkRepaid } from "./onchain";
import { saveBorrower, startCron } from "./cron";

const app = express();
const PORT = 3001;

// CORS — allow the Vite dev server origin
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      `https://${process.env.PREVIEW_HOSTNAME || "localhost"}`,
    ],
  })
);

// Raw body needed for webhook signature verification — must come before json()
app.use("/api/webhook/paystack", express.raw({ type: "application/json" }));
app.use(express.json());

// ── Health ──────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ── Create Paystack payment link ────────────────────────────────────────────
app.post("/api/create-payment", async (req, res) => {
  try {
    const { borrowerAddress, ngnAmount, email } = req.body as {
      borrowerAddress: string;
      ngnAmount: number;
      email: string;
    };

    if (!borrowerAddress || !ngnAmount || !email) {
      res.status(400).json({ error: "borrowerAddress, ngnAmount, and email are required" });
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

    const result = await initializeRepayment(borrowerAddress, ngnAmount, email);
    res.json(result);
  } catch (err) {
    console.error("[create-payment]", err);
    res.status(500).json({ error: "Failed to create payment link" });
  }
});

// ── Paystack webhook ─────────────────────────────────────────────────────────
app.post("/api/webhook/paystack", async (req, res) => {
  const signature = req.headers["x-paystack-signature"] as string | undefined;

  if (!signature) {
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody = (req.body as Buffer).toString("utf8");

  try {
    if (!verifyWebhookSignature(rawBody, signature)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  } catch {
    res.status(401).json({ error: "Signature verification failed" });
    return;
  }

  // Acknowledge immediately to avoid Paystack retry
  res.status(200).send("OK");

  let payload: { event: string; data: { reference: string } };
  try {
    payload = JSON.parse(rawBody) as typeof payload;
  } catch {
    console.error("[webhook] Invalid JSON body");
    return;
  }

  if (payload.event !== "charge.success") return;

  const { reference } = payload.data;

  // Always verify server-side before taking action
  let txData: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    txData = await verifyTransaction(reference);
  } catch (err) {
    console.error("[webhook] Verification failed for ref", reference, err);
    return;
  }

  if (txData.status !== "success") {
    console.log(`[webhook] Ignoring non-success status "${txData.status}" for ref ${reference}`);
    return;
  }

  const meta = txData.metadata as Record<string, string>;
  const paymentType = meta?.paymentType;
  const borrowerAddress = meta?.borrowerAddress;

  if (!borrowerAddress || !/^0x[0-9a-fA-F]{40}$/i.test(borrowerAddress)) {
    console.error("[webhook] Invalid or missing borrowerAddress in metadata");
    return;
  }

  if (paymentType === "repay") {
    try {
      console.log(`[webhook] Marking repaid for ${borrowerAddress} (ref=${reference})`);
      const hash = await callMarkRepaid(borrowerAddress);
      console.log(`[webhook] markRepaid tx=${hash} for ${borrowerAddress}`);
    } catch (err) {
      console.error(`[webhook] callMarkRepaid failed for ${borrowerAddress}:`, err);
    }
  } else {
    console.warn(`[webhook] Unknown paymentType "${paymentType}" for ref ${reference}`);
  }
});

// ── Register borrower for cron scanning ─────────────────────────────────────
app.post("/api/register-borrower", (req, res) => {
  const { address } = req.body as { address?: string };
  if (!address || !/^0x[0-9a-fA-F]{40}$/i.test(address)) {
    res.status(400).json({ error: "Invalid address" });
    return;
  }
  saveBorrower(address);
  res.json({ ok: true });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] NairaLock backend listening on port ${PORT}`);
  startCron();
});

export default app;
