/**
 * Liquidation cron — scans known borrowers and liquidates all expired loans.
 * Runs hourly. Tracks borrower addresses in a file-persisted set.
 */
import { callLiquidate, getLoanCount, getLoanPosition } from "./onchain";
import fs from "fs";
import path from "path";

const BORROWERS_FILE = path.join(process.cwd(), ".borrowers.json");

function loadBorrowers(): string[] {
  try {
    if (fs.existsSync(BORROWERS_FILE)) {
      return JSON.parse(fs.readFileSync(BORROWERS_FILE, "utf8")) as string[];
    }
  } catch { /* ignore */ }
  return [];
}

export function saveBorrower(address: string): void {
  const borrowers = loadBorrowers();
  const normalized = address.toLowerCase();
  if (!borrowers.includes(normalized)) {
    borrowers.push(normalized);
    fs.writeFileSync(BORROWERS_FILE, JSON.stringify(borrowers), "utf8");
  }
}

export async function runLiquidationScan(): Promise<void> {
  const borrowers = loadBorrowers();
  if (borrowers.length === 0) return;

  console.log(`[cron] Scanning ${borrowers.length} borrower(s) for expired loans...`);

  for (const borrower of borrowers) {
    try {
      const count = await getLoanCount(borrower);
      for (let i = 0; i < count; i++) {
        try {
          const [, loanState] = await getLoanPosition(borrower, i);
          // loanState 3 = liquidatable (graceDeadline passed, still active)
          if (loanState === 3) {
            console.log(`[cron] Liquidating ${borrower} loan #${i}`);
            const hash = await callLiquidate(borrower, i);
            console.log(`[cron] Liquidated ${borrower} loan #${i} tx=${hash}`);
          }
        } catch (err) {
          console.error(`[cron] Error processing ${borrower} loan #${i}:`, err);
        }
      }
    } catch (err) {
      console.error(`[cron] Error fetching loan count for ${borrower}:`, err);
    }
  }
}

let cronInterval: ReturnType<typeof setInterval> | null = null;

export function startCron(): void {
  if (cronInterval) return;
  void runLiquidationScan();
  cronInterval = setInterval(() => void runLiquidationScan(), 60 * 60 * 1000);
  console.log("[cron] Liquidation cron started (hourly)");
}

export function stopCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}
