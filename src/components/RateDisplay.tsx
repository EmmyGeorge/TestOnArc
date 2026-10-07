import { TrendingUp, Percent, DollarSign } from "lucide-react";
import { useContractRates } from "@/hooks/useNairaLock";
import { formatNgn, TERM_LABELS } from "@/utils/nairalock";

const glass = {
  card: {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid rgba(18,45,69,0.10)",
    borderRadius: "1.5rem",
  } as React.CSSProperties,
};

export function RateDisplay() {
  const { ngnRate, termRates } = useContractRates();

  const ngnPerUsd = ngnRate.data as bigint | undefined;
  const rates = termRates.data;

  // Example: 100 USDC deposited, borrowing 50% = 50 USDC worth of NGN
  // Interest on each term based on the 50 USDC borrow
  const exampleBorrowUsdc = 50_000_000n; // 50 USDC in 6-decimal units

  return (
    <div className="p-4" style={glass.card}>
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
        Current Rates
      </p>

      {/* NGN/USDC rate */}
      <div className="rounded-2xl px-4 py-3 mb-3" style={{ background: "var(--surface-muted)" }}>
        <div className="mb-1 flex items-center gap-1.5">
          <DollarSign className="size-3.5" style={{ color: "var(--accent)" }} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>NGN / USDC</span>
        </div>
        <p className="display text-xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>
          {ngnPerUsd ? `₦${formatNgn(ngnPerUsd)}` : "—"}
        </p>
      </div>

      {/* Per-term interest rates */}
      <div className="mb-1 flex items-center gap-1.5">
        <Percent className="size-3.5" style={{ color: "var(--accent)" }} />
        <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Interest rates per term</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {TERM_LABELS.map((label, i) => {
          const bps = rates?.[i];
          const pct = bps !== undefined ? Number(bps) / 100 : null;
          return (
            <div key={i} className="rounded-2xl px-3 py-2 text-center" style={{ background: "var(--surface-muted)" }}>
              <p className="text-xs mb-0.5" style={{ color: "var(--muted)" }}>{label}</p>
              <p className="font-bold tabular-nums text-sm" style={{ color: "var(--ink)" }}>
                {pct !== null ? `${pct}%` : "—"}
              </p>
            </div>
          );
        })}
      </div>

      {/* Example borrow */}
      {!!ngnPerUsd && !!rates && (
        <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(18,45,69,0.04)" }}>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUp className="size-3.5" style={{ color: "var(--success)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
              100 USDC deposit · 50 USDC borrow example
            </span>
          </div>
          {TERM_LABELS.map((label, i) => {
            const bps = rates[i];
            const interestUsdc = (exampleBorrowUsdc * bps) / 10_000n;
            const interestDisplay = (Number(interestUsdc) / 1_000_000).toFixed(2);
            const maxNgn = (exampleBorrowUsdc * ngnPerUsd) / 1_000_000n;
            return (
              <p key={i} className="text-xs mb-0.5" style={{ color: "var(--ink-2)" }}>
                <span className="font-medium">{label}:</span>{" "}
                {interestDisplay} USDC interest · max ₦{formatNgn(maxNgn)}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
