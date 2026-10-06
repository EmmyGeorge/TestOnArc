/**
 * NairaLock contract config and ABI — read from env, never hardcoded.
 * Address is set via VITE_NAIRA_LOCK_ADDRESS after deployment.
 */
import NairaLockArtifact from "../../contracts/out/NairaLock.sol/NairaLock.json";

export const ARC_TESTNET_CHAIN_ID = 5042002;

export function getNairaLockAddress(): `0x${string}` {
  const addr = import.meta.env.VITE_NAIRA_LOCK_ADDRESS as string | undefined;
  if (!addr) throw new Error("VITE_NAIRA_LOCK_ADDRESS not configured. Deploy the contract first.");
  return addr as `0x${string}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const NAIRA_LOCK_ABI = NairaLockArtifact.abi as any[];

export const TERM_LABELS = ["3 months", "6 months", "1 year"] as const;
export type TermChoice = 0 | 1 | 2;

export type LoanState = 0 | 1 | 2 | 3 | 4 | 5;
export const LOAN_STATE_LABELS: Record<LoanState, string> = {
  0: "No Loan",
  1: "Active",
  2: "In Grace Period",
  3: "Liquidatable",
  4: "Repaid",
  5: "Liquidated",
};

export interface LoanPosition {
  collateralUsdc: bigint;
  ngnDebt: bigint;
  termExpiry: bigint;
  graceDeadline: bigint;
  active: boolean;
  repaid: boolean;
  liquidated: boolean;
}

export interface LoanData {
  loan: LoanPosition;
  loanState: LoanState;
  refinanceEligible: boolean;
  currentInterestDueUsdc: bigint;
}

/** Format a bigint USDC amount (6 decimals) to a readable string */
export function formatUsdc(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/** Format a bigint NGN amount (whole Naira, no decimals) */
export function formatNgn(raw: bigint): string {
  return new Intl.NumberFormat("en-NG").format(Number(raw));
}

/** Format seconds remaining into a human countdown */
export function formatCountdown(unixTs: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (unixTs <= now) return "Expired";
  const diff = Number(unixTs - now);
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h remaining`;
  const mins = Math.floor((diff % 3600) / 60);
  return `${hours}h ${mins}m remaining`;
}

/** Format Unix timestamp to locale date string */
export function formatDate(unixTs: bigint): string {
  return new Date(Number(unixTs) * 1000).toLocaleDateString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
