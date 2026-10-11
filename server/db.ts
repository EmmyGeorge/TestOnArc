/**
 * SQLite persistence layer for NairaLock backend.
 * Uses bun:sqlite (built into Bun — no install needed).
 *
 * Tables:
 *   disbursements  — idempotency for NGN payouts (one row per txHash+loanIndex)
 *   payments       — Paystack repayment records (persist + retry)
 *   borrowers      — known borrower addresses for liquidation cron
 */
import { Database } from "bun:sqlite";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "nairalock.db");

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS disbursements (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tx_hash       TEXT    NOT NULL,
      loan_index    INTEGER NOT NULL,
      borrower      TEXT    NOT NULL,
      ngn_amount    INTEGER NOT NULL,
      paystack_ref  TEXT    NOT NULL UNIQUE,
      transfer_code TEXT,
      status        TEXT    NOT NULL DEFAULT 'pending',
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(tx_hash, loan_index)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      paystack_ref    TEXT    NOT NULL UNIQUE,
      borrower        TEXT    NOT NULL,
      loan_index      INTEGER NOT NULL,
      ngn_amount      INTEGER NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending',
      mark_repaid_tx  TEXT,
      retries         INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS borrowers (
      address     TEXT PRIMARY KEY,
      added_at    INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

// ── Disbursements ─────────────────────────────────────────────────────────────

export function isDisbursed(txHash: string, loanIndex: number): boolean {
  const db = getDb();
  const row = db.query(
    "SELECT id FROM disbursements WHERE tx_hash = ? AND loan_index = ? AND status = 'success'"
  ).get(txHash, loanIndex);
  return !!row;
}

export function createDisbursement(opts: {
  txHash: string;
  loanIndex: number;
  borrower: string;
  ngnAmount: number;
  paystackRef: string;
}): boolean {
  const db = getDb();
  try {
    db.run(
      `INSERT INTO disbursements (tx_hash, loan_index, borrower, ngn_amount, paystack_ref)
       VALUES (?, ?, ?, ?, ?)`,
      [opts.txHash, opts.loanIndex, opts.borrower.toLowerCase(), opts.ngnAmount, opts.paystackRef]
    );
    return true;
  } catch {
    return false; // UNIQUE constraint violation — already exists
  }
}

export function updateDisbursementStatus(paystackRef: string, status: string, transferCode?: string) {
  const db = getDb();
  db.run(
    `UPDATE disbursements SET status = ?, transfer_code = ?, updated_at = unixepoch()
     WHERE paystack_ref = ?`,
    [status, transferCode ?? null, paystackRef]
  );
}

// ── Payments ──────────────────────────────────────────────────────────────────

export function createPaymentRecord(opts: {
  paystackRef: string;
  borrower: string;
  loanIndex: number;
  ngnAmount: number;
}) {
  const db = getDb();
  db.run(
    `INSERT OR IGNORE INTO payments (paystack_ref, borrower, loan_index, ngn_amount)
     VALUES (?, ?, ?, ?)`,
    [opts.paystackRef, opts.borrower.toLowerCase(), opts.loanIndex, opts.ngnAmount]
  );
}

export function getPaymentRecord(paystackRef: string) {
  const db = getDb();
  return db.query("SELECT * FROM payments WHERE paystack_ref = ?").get(paystackRef) as
    | { borrower: string; loan_index: number; ngn_amount: number; status: string; retries: number }
    | undefined;
}

export function updatePaymentStatus(paystackRef: string, status: string, markRepaidTx?: string) {
  const db = getDb();
  db.run(
    `UPDATE payments SET status = ?, mark_repaid_tx = ?, updated_at = unixepoch()
     WHERE paystack_ref = ?`,
    [status, markRepaidTx ?? null, paystackRef]
  );
}

export function incrementPaymentRetry(paystackRef: string) {
  const db = getDb();
  db.run(
    "UPDATE payments SET retries = retries + 1, updated_at = unixepoch() WHERE paystack_ref = ?",
    [paystackRef]
  );
}

export function getPendingPayments() {
  const db = getDb();
  return db.query(
    "SELECT * FROM payments WHERE status = 'paid' AND mark_repaid_tx IS NULL AND retries < 5"
  ).all() as { paystack_ref: string; borrower: string; loan_index: number; ngn_amount: number; retries: number }[];
}

// ── Borrowers ─────────────────────────────────────────────────────────────────

export function saveBorrowerDb(address: string) {
  const db = getDb();
  db.run("INSERT OR IGNORE INTO borrowers (address) VALUES (?)", [address.toLowerCase()]);
}

export function getAllBorrowers(): string[] {
  const db = getDb();
  const rows = db.query("SELECT address FROM borrowers").all() as { address: string }[];
  return rows.map((r) => r.address);
}
