/**
 * LoanCard — renders a single loan position.
 * Used by LoanDashboard to show one card per loan index.
 */
import { Shield, Clock, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useLoanPosition, useContractRates } from "@/hooks/useNairaLock";
import {
  LOAN_STATE_LABELS, formatUsdc, formatNgn, formatCountdown, formatDate, type LoanState,
} from "@/utils/nairalock";

const glass = {
  card: {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid rgba(18,45,69,0.10)",
    borderRadius: "1.5rem",
  } as React.CSSProperties,
};

const STATE_COLORS: Record<LoanState, string> = {
  0: "var(--subtle)", 1: "var(--success)", 2: "#e08a00",
  3: "var(--danger)", 4: "var(--success)", 5: "var(--danger)",
};

const STATE_ICONS: Record<LoanState, React.ReactNode> = {
  0: <Shield className="size-3.5" />, 1: <CheckCircle className="size-3.5" />,
  2: <Clock className="size-3.5" />, 3: <AlertTriangle className="size-3.5" />,
  4: <CheckCircle className="size-3.5" />, 5: <XCircle className="size-3.5" />,
};

interface LoanCardProps {
  borrowerAddress: string;
  loanIndex: number;
  onGraceAction?: (loanIndex: number) => void;
  onTopUp?: (loanIndex: number) => void;
}

export function LoanCard({ borrowerAddress, loanIndex, onGraceAction, onTopUp }: LoanCardProps) {
  const { data: loanData } = useLoanPosition(borrowerAddress, loanIndex);
  const { ngnRate } = useContractRates();

  if (!loanData) return null;

  const [loan, loanState, refinanceEligible] = loanData;
  const ngnPerUsd = ngnRate.data as bigint | undefined;

  if (loanState === 0) return null;

  const collateralNgn = ngnPerUsd && loan.collateralUsdc > 0n
    ? (loan.collateralUsdc * ngnPerUsd) / 1_000_000n : null;
  const healthPct = collateralNgn && loan.ngnDebt > 0n
    ? Math.min(200, Math.floor(Number((collateralNgn * 100n) / loan.ngnDebt))) : null;

  const isGrace = loanState === 2;
  const isLiquidatable = loanState === 3;
  const isDone = loanState === 4 || loanState === 5;

  return (
    <div className="p-4 space-y-3" style={glass.card}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Loan #{loanIndex + 1}</span>
          <div
            className="flex items-center gap-1 rounded-full px-2 py-0.5"
            style={{ background: `${STATE_COLORS[loanState]}18`, color: STATE_COLORS[loanState] }}
          >
            {STATE_ICONS[loanState]}
            <span className="text-xs font-semibold">{LOAN_STATE_LABELS[loanState]}</span>
          </div>
        </div>
        {!isDone && onTopUp && (
          <button
            onClick={() => onTopUp(loanIndex)}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold"
            style={{ background: "var(--surface-muted)", color: "var(--ink-2)" }}
          >
            Top Up
          </button>
        )}
      </div>

      {/* Amounts */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--surface-muted)" }}>
          <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>Collateral</p>
          <p className="font-bold tabular-nums text-sm" style={{ color: "var(--ink)" }}>
            {formatUsdc(loan.collateralUsdc)} <span className="font-normal text-xs" style={{ color: "var(--subtle)" }}>USDC</span>
          </p>
        </div>
        <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--surface-muted)" }}>
          <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>NGN debt</p>
          <p className="font-bold tabular-nums text-sm" style={{ color: "var(--ink)" }}>
            ₦{formatNgn(loan.ngnDebt)}
          </p>
        </div>
      </div>

      {/* Health bar */}
      {healthPct !== null && !isDone && (
        <div>
          <div className="flex justify-between mb-1">
            <p className="text-xs" style={{ color: "var(--muted)" }}>Collateral health</p>
            <p className="text-xs font-semibold" style={{
              color: healthPct > 120 ? "var(--success)" : healthPct > 100 ? "#e08a00" : "var(--danger)"
            }}>{healthPct}%</p>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-muted)" }}>
            <div className="h-full rounded-full transition-all" style={{
              width: `${Math.min(100, healthPct)}%`,
              background: healthPct > 120 ? "var(--success)" : healthPct > 100 ? "#e08a00" : "var(--danger)",
            }} />
          </div>
        </div>
      )}

      {/* Timeline dates */}
      {!isDone && (
        <div className="flex gap-4 text-xs" style={{ color: "var(--muted)" }}>
          <span>Term ends: <span className="font-medium" style={{ color: "var(--ink-2)" }}>{formatDate(loan.termExpiry)}</span></span>
          {isGrace && <span>Grace: <span className="font-semibold" style={{ color: "#e08a00" }}>{formatCountdown(loan.graceDeadline)}</span></span>}
        </div>
      )}

      {/* In-grace action */}
      {isGrace && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Clock className="size-3.5" style={{ color: "#e08a00" }} />
            <p className="text-xs font-semibold" style={{ color: "#e08a00" }}>
              {refinanceEligible ? "Repay or refinance before deadline" : "Repayment required — collateral too low to refinance"}
            </p>
          </div>
          {onGraceAction && (
            <button
              onClick={() => onGraceAction(loanIndex)}
              className="w-full rounded-xl py-2 text-sm font-semibold"
              style={{ background: "#e08a00", color: "#fff" }}
            >
              Repay / Refinance →
            </button>
          )}
        </div>
      )}

      {/* Liquidatable */}
      {isLiquidatable && (
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" style={{ color: "var(--danger)" }} />
          <p className="text-xs font-semibold" style={{ color: "var(--danger)" }}>Grace period expired — liquidation pending</p>
        </div>
      )}

      {/* Done */}
      {loanState === 4 && (
        <div className="flex items-center gap-1.5">
          <CheckCircle className="size-3.5" style={{ color: "var(--success)" }} />
          <p className="text-xs font-semibold" style={{ color: "var(--success)" }}>Repaid — collateral returned</p>
        </div>
      )}
      {loanState === 5 && (
        <div className="flex items-center gap-1.5">
          <XCircle className="size-3.5" style={{ color: "var(--danger)" }} />
          <p className="text-xs font-semibold" style={{ color: "var(--danger)" }}>Liquidated — surplus USDC returned</p>
        </div>
      )}
    </div>
  );
}
