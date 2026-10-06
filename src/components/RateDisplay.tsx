import { TrendingUp, Percent, DollarSign } from "lucide-react";
import { useContractRates } from "@/hooks/useNairaLock";
import { formatNgn } from "@/utils/nairalock";

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
  const { ngnRate, interestRate } = useContractRates();

  const ngnPerUsd = ngnRate.data as bigint | undefined;
  const rateBps = interestRate.data as bigint | undefined;
  const ratePercent = rateBps ? Number(rateBps) / 100 : null;

  // Max NGN borrowable per 100 USDC example
  const exampleCollateral = 100_000_000n; // 100 USDC in 6-decimal units
  const exampleInterestUsdc = rateBps ? (exampleCollateral * rateBps) / 10_000n : 0n;
  const exampleNet = exampleCollateral - exampleInterestUsdc;
  const exampleMaxNgn = ngnPerUsd ? (exampleNet * ngnPerUsd) / (2n * 1_000_000n) : 0n;

  return (
    <div className="p-4" style={glass.card}>
      <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
        Current Rates
      </p>

      <div className="grid grid-cols-2 gap-3">
        {/* NGN/USD rate */}
        <div className="rounded-2xl px-4 py-3" style={{ background: "var(--surface-muted)" }}>
          <div className="mb-1 flex items-center gap-1.5">
            <DollarSign className="size-3.5" style={{ color: "var(--accent)" }} />
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              NGN / USDC
            </span>
          </div>
          <p className="display text-xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>
            {ngnPerUsd ? `₦${formatNgn(ngnPerUsd)}` : "—"}
          </p>
        </div>

        {/* Interest rate */}
        <div className="rounded-2xl px-4 py-3" style={{ background: "var(--surface-muted)" }}>
          <div className="mb-1 flex items-center gap-1.5">
            <Percent className="size-3.5" style={{ color: "var(--accent)" }} />
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              Interest / term
            </span>
          </div>
          <p className="display text-xl font-bold tabular-nums" style={{ color: "var(--ink)" }}>
            {ratePercent !== null ? `${ratePercent}%` : "—"}
          </p>
        </div>
      </div>

      {/* Example borrow */}
      {!!ngnPerUsd && !!rateBps && (
        <div className="mt-3 rounded-2xl px-4 py-3" style={{ background: "rgba(18,45,69,0.04)" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="size-3.5" style={{ color: "var(--success)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>
              100 USDC deposit example
            </span>
          </div>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            Interest deducted:{" "}
            <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>
              {Number(exampleInterestUsdc) / 1_000_000} USDC
            </span>
          </p>
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            Max you can borrow:{" "}
            <span className="font-semibold tabular-nums" style={{ color: "var(--success)" }}>
              ₦{formatNgn(exampleMaxNgn)}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
