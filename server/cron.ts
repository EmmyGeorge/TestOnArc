/**
 * Liquidation + retry cron.
 * - Rebuilds borrower list from chain on startup (no ephemeral file dependency).
 * - Liquidates expired loans (state 3).
 * - Retries pending markRepaid calls for payments that were recorded but failed.
 */
import { callLiquidate, callMarkRepaid, getLoanCount, getLoanPosition, scanAllBorrowers } from "./onchain";
import { getAllBorrowers, saveBorrowerDb, getPendingPayments, updatePaymentStatus, incrementPaymentRetry } from "./db";

export function saveBorrower(address: string): void {
  saveBorrowerDb(address);
}

async function rebuildBorrowersFromChain(): Promise<void> {
  try {
    const onchainBorrowers = await scanAllBorrowers();
    for (const addr of onchainBorrowers) {
      saveBorrowerDb(addr);
    }
    console.log(`[cron] Rebuilt borrower list from chain: ${onchainBorrowers.length} address(es)`);
  } catch (err) {
    console.error("[cron] Failed to rebuild borrower list from chain:", err);
  }
}

async function runLiquidationScan(): Promise<void> {
  const borrowers = getAllBorrowers();
  if (borrowers.length === 0) return;

  console.log(`[cron] Scanning ${borrowers.length} borrower(s) for expired loans...`);

  for (const borrower of borrowers) {
    try {
      const count = await getLoanCount(borrower);
      for (let i = 0; i < count; i++) {
        try {
          const result = await getLoanPosition(borrower, i);
          // result is [loan, loanState, refinanceEligible, currentInterestDueUsdc]
          const loanState = (result as [unknown, number, boolean, bigint])[1];
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

async function retryPendingMarkRepaid(): Promise<void> {
  const pending = getPendingPayments();
  if (pending.length === 0) return;

  console.log(`[cron] Retrying ${pending.length} pending markRepaid call(s)...`);

  for (const p of pending) {
    try {
      console.log(`[cron] Retrying markRepaid for ${p.borrower} loan #${p.loan_index} (attempt ${p.retries + 1})`);
      const hash = await callMarkRepaid(p.borrower, p.loan_index);
      updatePaymentStatus(p.paystack_ref, "settled", hash);
      console.log(`[cron] markRepaid succeeded for ${p.borrower} loan #${p.loan_index} tx=${hash}`);
    } catch (err) {
      incrementPaymentRetry(p.paystack_ref);
      console.error(`[cron] markRepaid retry failed for ${p.borrower} loan #${p.loan_index}:`, err);
    }
  }
}

let cronInterval: ReturnType<typeof setInterval> | null = null;

export async function startCron(): Promise<void> {
  if (cronInterval) return;

  // Rebuild borrower list from chain on startup
  await rebuildBorrowersFromChain();

  // Run immediately then every hour
  void runLiquidationScan();
  void retryPendingMarkRepaid();

  cronInterval = setInterval(() => {
    void runLiquidationScan();
    void retryPendingMarkRepaid();
  }, 60 * 60 * 1000);

  console.log("[cron] Liquidation + retry cron started (hourly)");
}

export function stopCron(): void {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
}
