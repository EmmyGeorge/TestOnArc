import { useAccount } from "wagmi";
import { Shield, RefreshCw, Plus } from "lucide-react";
import { useLoanCount } from "@/hooks/useNairaLock";
import { LoanCard } from "@/components/LoanCard";

const glass = {
  card: {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid rgba(18,45,69,0.10)",
    borderRadius: "1.5rem",
  } as React.CSSProperties,
};

interface LoanDashboardProps {
  onGoToGraceActions?: (loanIndex: number) => void;
  onGoToTopUp?: (loanIndex: number) => void;
  onGoToBorrow?: () => void;
}

export function LoanDashboard({ onGoToGraceActions, onGoToTopUp, onGoToBorrow }: LoanDashboardProps) {
  const { address } = useAccount();
  const { data: loanCount, isLoading, refetch } = useLoanCount(address);

  if (!address) {
    return (
      <div className="p-5 text-center" style={glass.card}>
        <Shield className="mx-auto mb-3 size-8 opacity-30" style={{ color: "var(--muted)" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>Connect your wallet to view your loans</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-5 text-center" style={glass.card}>
        <RefreshCw className="mx-auto mb-3 size-5 animate-spin opacity-40" style={{ color: "var(--muted)" }} />
        <p className="text-sm" style={{ color: "var(--muted)" }}>Loading loans...</p>
      </div>
    );
  }

  const count = Number(loanCount ?? 0n);

  if (count === 0) {
    return (
      <div className="p-5 text-center" style={glass.card}>
        <Shield className="mx-auto mb-3 size-8 opacity-30" style={{ color: "var(--muted)" }} />
        <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No loans yet</p>
        <p className="text-xs mt-1 mb-4" style={{ color: "var(--muted)" }}>Deposit USDC to open your first loan</p>
        {onGoToBorrow && (
          <button
            onClick={onGoToBorrow}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white"
            style={{ background: "var(--accent)" }}
          >
            <Plus className="size-4" /> Open a Loan
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
          Your Loans ({count})
        </p>
        <div className="flex items-center gap-2">
          {onGoToBorrow && (
            <button
              onClick={onGoToBorrow}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-white"
              style={{ background: "var(--accent)" }}
            >
              <Plus className="size-3.5" /> New Loan
            </button>
          )}
          <button onClick={() => void refetch()} className="rounded-full p-1" style={{ color: "var(--subtle)" }}>
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      {/* One LoanCard per loan index */}
      {Array.from({ length: count }, (_, i) => (
        <LoanCard
          key={i}
          borrowerAddress={address}
          loanIndex={i}
          onGraceAction={onGoToGraceActions}
          onTopUp={onGoToTopUp}
        />
      ))}
    </div>
  );
}
