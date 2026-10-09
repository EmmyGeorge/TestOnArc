import { useState } from "react";
import { useAccount } from "wagmi";
import { Loader2, CreditCard, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { buildTxExplorerUrl } from "@/onchain-facts";
import { useLoanPosition, useRefinanceMyLoan, useGetRefinanceInterest } from "@/hooks/useNairaLock";
import { formatUsdc, formatNgn, TERM_LABELS, ARC_TESTNET_CHAIN_ID, type TermChoice } from "@/utils/nairalock";

const glass = {
  card: {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid rgba(18,45,69,0.10)",
    borderRadius: "1.5rem",
  } as React.CSSProperties,
};

export function GraceActions({ loanIndex, onDone: _onDone }: { loanIndex: number; onDone?: () => void }) {
  const { address } = useAccount();
  const { data: loanData } = useLoanPosition(address, loanIndex);
  const refinance = useRefinanceMyLoan();

  const [newTerm, setNewTerm] = useState<TermChoice>(0);
  const [repayLoading, setRepayLoading] = useState(false);
  const { data: refinanceInterestUsdc } = useGetRefinanceInterest(address, loanIndex, newTerm);

  if (!loanData) return null;
  const [loan, loanState, refinanceEligible] = loanData;
  if (loanState !== 2) return null;

  const handleRepay = async () => {
    if (!address) return;
    setRepayLoading(true);
    try {
      const res = await fetch("/api/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrower: address, loanIndex }),
      });
      const data = await res.json() as { authorization_url?: string; error?: string };
      if (!res.ok || !data.authorization_url) {
        toast.error(data.error ?? "Failed to create payment link");
        return;
      }
      window.open(data.authorization_url, "_blank", "noopener,noreferrer");
      toast.info("Complete your NGN payment in the new tab. Your USDC will be released automatically once confirmed.");
    } catch (err) {
      toast.error("Failed to reach payment server");
      console.error(err);
    } finally {
      setRepayLoading(false);
    }
  };

  const handleRefinance = () => refinance.refinance(loanIndex, newTerm);
  const isRefinancing = refinance.isPending || refinance.isConfirming;

  return (
    <div className="space-y-4">
      <div className="p-5" style={glass.card}>
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: "#e08a00" }}>
          Grace Period — Loan #{loanIndex + 1}
        </p>
        <p className="text-sm mb-4" style={{ color: "var(--ink-2)" }}>
          Your loan term has ended. Choose to repay your NGN debt or refinance into a new term.
        </p>

        {/* Loan summary */}
        <div className="rounded-2xl px-4 py-3 mb-4" style={{ background: "rgba(18,45,69,0.04)" }}>
          <div className="flex justify-between text-sm mb-1">
            <span style={{ color: "var(--muted)" }}>NGN debt (principal)</span>
            <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>₦{formatNgn(loan.ngnDebt)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span style={{ color: "var(--muted)" }}>Collateral locked</span>
            <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{formatUsdc(loan.collateralUsdc)} USDC</span>
          </div>
        </div>

        {/* Option 1: Repay */}
        <div className="rounded-2xl p-4 mb-3" style={{ background: "rgba(26,128,71,0.06)", border: "1px solid rgba(26,128,71,0.2)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "var(--success)" }}>Option 1 — Repay NGN principal</p>
          <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
            Pay ₦{formatNgn(loan.ngnDebt)} via Paystack. Your {formatUsdc(loan.collateralUsdc)} USDC collateral will be released automatically.
          </p>
          <button
            onClick={() => void handleRepay()}
            disabled={repayLoading}
            className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--success)" }}
          >
            {repayLoading
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Creating link...</span>
              : <span className="flex items-center justify-center gap-2"><CreditCard className="size-4" />Pay ₦{formatNgn(loan.ngnDebt)} via Paystack</span>}
          </button>
        </div>

        {/* Option 2: Refinance */}
        {refinanceEligible ? (
          <div className="rounded-2xl p-4" style={{ background: "rgba(18,45,69,0.04)", border: "1px solid var(--border)" }}>
            <p className="text-sm font-semibold mb-1" style={{ color: "var(--ink)" }}>Option 2 — Refinance (extend loan)</p>
            <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
              Interest is deducted from your collateral upfront in USDC. NGN debt rolls over into a new term.
            </p>
            <div className="flex items-center justify-between text-xs mb-3 rounded-xl px-3 py-2" style={{ background: "rgba(186,43,76,0.06)" }}>
              <span style={{ color: "var(--muted)" }}>Interest to deduct</span>
              <span className="font-semibold" style={{ color: "var(--danger)" }}>{formatUsdc(refinanceInterestUsdc ?? 0n)} USDC</span>
            </div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--muted)" }}>Select new loan term</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {TERM_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => setNewTerm(i as TermChoice)}
                  className="rounded-xl py-2 text-xs font-semibold transition-all"
                  style={{
                    background: newTerm === i ? "var(--accent)" : "var(--surface-muted)",
                    color: newTerm === i ? "#fff" : "var(--ink-2)",
                    border: newTerm === i ? "none" : "1px solid var(--border)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={handleRefinance}
              disabled={isRefinancing}
              className="w-full rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {isRefinancing
                ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Refinancing...</span>
                : <span className="flex items-center justify-center gap-2"><RefreshCw className="size-4" />Refinance into {TERM_LABELS[newTerm]}</span>}
            </button>
            {refinance.hash && (
              <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, refinance.hash)} target="_blank" rel="noreferrer"
                className="mt-2 flex items-center justify-center gap-1 text-xs" style={{ color: "var(--accent-hover)" }}>
                View transaction →
              </a>
            )}
          </div>
        ) : (
          <div className="rounded-2xl p-4 flex items-start gap-2" style={{ background: "rgba(186,43,76,0.06)", border: "1px solid rgba(186,43,76,0.2)" }}>
            <AlertTriangle className="size-4 mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--danger)" }}>Refinancing not available</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--ink-2)" }}>
                Your remaining collateral is worth less than or equal to your NGN debt. Repay the full NGN principal to recover any remaining collateral.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
