import { useAccount } from "wagmi";
import { Shield, Clock, AlertTriangle, CheckCircle, XCircle, RefreshCw } from "lucide-react";
import { useLoanPosition, useContractRates } from "@/hooks/useNairaLock";
import {
  LOAN_STATE_LABELS,
  formatUsdc,
  formatNgn,
  formatCountdown,
  formatDate,
  type LoanState,
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
  0: "var(--subtle)",
  1: "var(--success)",
  2: "#e08a00",
  3: "var(--danger)",
  4: "var(--success)",
  5: "var(--danger)",
};

const STATE_ICONS: Record<LoanState, React.ReactNode> = {
  0: <Shield className="size-4" />,
  1: <CheckCircle className="size-4" />,
  2: <Clock className="size-4" />,
  3: <AlertTriangle className="size-4" />,
  4: <CheckCircle className="size-4" />,
  5: <XCircle className="size-4" />,
};

interface LoanDashboardProps {
  onGoToGraceActions?: () => void;
}

export function LoanDashboard({ onGoToGraceActions }: LoanDashboardProps) {
  const { address } = useAccount();
  const { data: loanData, isLoading, refetch } = useLoanPosition(address);
  const { ngnRate } = useContractRates();

  if (!address) {
    return (
      <div className="p-5 text-center" style={glass.card}>
        <Shield className="mx-auto mb-3 size-8 opacity-30" style={{ color: "var(--muted)" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>Connect your wallet to view your loan</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-5 text-center" style={glass.card}>
        <RefreshCw className="mx-auto mb-3 size-5 animate-spin opacity-40" style={{ color: "var(--muted)" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading loan position...</p>
      </div>
    );
  }

  if (!loanData) {
    return (
      <div className="p-5 text-center" style={glass.card}>
        <Shield className="mx-auto mb-3 size-8 opacity-30" style={{ color: "var(--muted)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No active loan</p>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Deposit USDC to open a loan</p>
      </div>
    );
  }

  const [loan, loanState, refinanceEligible] = loanData;
  const ngnPerUsd = ngnRate.data as bigint | undefined;

  if (loanState === 0) {
    return (
      <div className="p-5 text-center" style={glass.card}>
        <Shield className="mx-auto mb-3 size-8 opacity-30" style={{ color: "var(--muted)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No active loan</p>
        <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>Deposit USDC to open a loan</p>
      </div>
    );
  }

  // Collateral health: collateral value in NGN vs debt
  const collateralNgn =
    ngnPerUsd && loan.collateralUsdc > 0n
      ? (loan.collateralUsdc * ngnPerUsd) / 1_000_000n
      : null;
  const healthPct =
    collateralNgn && loan.ngnDebt > 0n
      ? Math.min(100, Math.floor(Number((collateralNgn * 100n) / loan.ngnDebt)))
      : null;

  const isGrace = loanState === 2;
  const isLiquidatable = loanState === 3;
  const isDone = loanState === 4 || loanState === 5;

  return (
    <div className="space-y-4">
      {/* State badge + hero */}
      <div className="p-5" style={glass.card}>
        {/* State badge */}
        <div className="mb-4 flex items-center justify-between">
          <div
            className="flex items-center gap-2 rounded-full px-3 py-1.5"
            style={{ background: `${STATE_COLORS[loanState]}18`, color: STATE_COLORS[loanState] }}
          >
            {STATE_ICONS[loanState]}
            <span className="text-xs font-semibold">{LOAN_STATE_LABELS[loanState]}</span>
          </div>
          <button onClick={() => void refetch()} className="rounded-full p-1.5" style={{ color: "var(--subtle)" }}>
            <RefreshCw className="size-4" />
          </button>
        </div>

        {/* Hero: collateral */}
        <div className="mb-1">
          <p className="text-xs" style={{ color: "var(--muted)" }}>Collateral locked</p>
          <p className="display text-4xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>
            {formatUsdc(loan.collateralUsdc)}{" "}
            <span className="text-lg font-medium" style={{ color: "var(--subtle)" }}>USDC</span>
          </p>
        </div>

        {/* NGN debt */}
        <div className="mt-3 rounded-2xl px-4 py-3" style={{ background: "rgba(18,45,69,0.04)" }}>
          <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>NGN debt (principal)</p>
          <p className="display text-2xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>
            ₦{formatNgn(loan.ngnDebt)}
          </p>
          {!!ngnPerUsd && (
            <p className="text-xs mt-0.5" style={{ color: "var(--subtle)" }}>
              ≈ {formatUsdc((loan.ngnDebt * 1_000_000n) / ngnPerUsd)} USDC at current rate
            </p>
          )}
        </div>

        {/* Collateral health bar */}
        {healthPct !== null && !isDone && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs" style={{ color: "var(--muted)" }}>Collateral health</p>
              <p
                className="text-xs font-semibold"
                style={{ color: healthPct > 120 ? "var(--success)" : healthPct > 100 ? "#e08a00" : "var(--danger)" }}
              >
                {healthPct}%
              </p>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-muted)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, healthPct)}%`,
                  background: healthPct > 120 ? "var(--success)" : healthPct > 100 ? "#e08a00" : "var(--danger)",
                }}
              />
            </div>
            {healthPct <= 100 && !isGrace && !isLiquidatable && (
              <p className="text-xs mt-1 font-medium" style={{ color: "var(--danger)" }}>
                Collateral below debt value — refinancing will be blocked at term end
              </p>
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      {!isDone && (
        <div className="p-4 space-y-3" style={glass.card}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
            Loan timeline
          </p>

          <div className="flex items-center gap-3">
            <div
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: isGrace || isLiquidatable ? "var(--success)" : "var(--accent)", color: "#fff" }}
            >
              1
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>Term ends</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {formatDate(loan.termExpiry)} · {isGrace || isLiquidatable ? "Passed" : formatCountdown(loan.termExpiry)}
              </p>
            </div>
          </div>

          <div className="ml-3.5 w-px h-4" style={{ background: "var(--border)" }} />

          <div className="flex items-center gap-3">
            <div
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
              style={{
                background: isGrace ? "#e08a00" : isLiquidatable ? "var(--danger)" : "var(--surface-muted)",
                color: isGrace || isLiquidatable ? "#fff" : "var(--muted)",
              }}
            >
              2
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>Grace period ends</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {formatDate(loan.graceDeadline)} ·{" "}
                {isLiquidatable
                  ? "Expired — liquidation pending"
                  : isGrace
                  ? formatCountdown(loan.graceDeadline)
                  : "Not started yet"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* In-grace callout */}
      {isGrace && (
        <div
          className="p-4 rounded-2xl space-y-2"
          style={{ background: "rgba(224,138,0,0.08)", border: "1px solid rgba(224,138,0,0.25)" }}
        >
          <div className="flex items-center gap-2">
            <Clock className="size-4" style={{ color: "#e08a00" }} />
            <p className="text-sm font-semibold" style={{ color: "#e08a00" }}>Action required</p>
          </div>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            Your loan term has ended. Repay your NGN debt or refinance before the grace period expires to avoid liquidation.
          </p>
          {!!refinanceEligible && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Refinancing available — interest will be deducted from collateral
            </p>
          )}
          {!refinanceEligible && (
            <p className="text-xs font-medium" style={{ color: "var(--danger)" }}>
              Collateral too low to refinance — repayment only
            </p>
          )}
          {onGoToGraceActions && (
            <button
              onClick={onGoToGraceActions}
              className="mt-1 w-full rounded-xl py-2.5 text-sm font-semibold transition-all hover:scale-[1.01]"
              style={{ background: "#e08a00", color: "#fff" }}
            >
              Repay or Refinance →
            </button>
          )}
        </div>
      )}

      {/* Liquidatable warning */}
      {isLiquidatable && (
        <div
          className="p-4 rounded-2xl"
          style={{ background: "rgba(186,43,76,0.08)", border: "1px solid rgba(186,43,76,0.25)" }}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="size-4" style={{ color: "var(--danger)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>Pending liquidation</p>
          </div>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            The grace period has expired. Your loan will be liquidated shortly.{" "}
            {ngnPerUsd
              ? `Estimated deduction: ${formatUsdc((loan.ngnDebt * 1_000_000n) / ngnPerUsd)} USDC.`
              : ""}
          </p>
        </div>
      )}

      {/* Done state */}
      {loanState === 4 && (
        <div
          className="p-4 rounded-2xl"
          style={{ background: "rgba(26,128,71,0.08)", border: "1px solid rgba(26,128,71,0.25)" }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="size-4" style={{ color: "var(--success)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--success)" }}>
              Loan fully repaid — collateral returned
            </p>
          </div>
        </div>
      )}
      {loanState === 5 && (
        <div
          className="p-4 rounded-2xl"
          style={{ background: "rgba(186,43,76,0.08)", border: "1px solid rgba(186,43,76,0.25)" }}
        >
          <div className="flex items-center gap-2">
            <XCircle className="size-4" style={{ color: "var(--danger)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
              Loan liquidated — any surplus USDC was returned to your wallet
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
