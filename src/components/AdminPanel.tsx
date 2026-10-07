import { useState } from "react";
import { useAccount } from "wagmi";
import { Loader2, ShieldCheck, Settings } from "lucide-react";
import { toast } from "sonner";
import { buildTxExplorerUrl } from "@/onchain-facts";
import { useSetNgnRate, useSetTermInterestRate, useContractRates } from "@/hooks/useNairaLock";
import { ARC_TESTNET_CHAIN_ID, TERM_LABELS, formatNgn, type TermChoice } from "@/utils/nairalock";

const glass = {
  card: {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid rgba(18,45,69,0.10)",
    borderRadius: "1.5rem",
  } as React.CSSProperties,
};

export function AdminPanel() {
  const { address } = useAccount();
  const { ngnRate, termRates, ownerAddress } = useContractRates();
  const setRate = useSetNgnRate();
  const setTermInterest = useSetTermInterestRate();

  const [newNgnRate, setNewNgnRate] = useState("");
  // Per-term bps inputs
  const [termBps, setTermBps] = useState<[string, string, string]>(["", "", ""]);

  const owner = ownerAddress.data as string | undefined;
  const isOwner = address && owner && address.toLowerCase() === owner.toLowerCase();

  if (!isOwner) return null;

  const currentNgnRate = ngnRate.data as bigint | undefined;
  const currentTermRates = termRates.data;

  const handleSetNgnRate = () => {
    const val = BigInt(Math.floor(parseFloat(newNgnRate) || 0));
    if (val <= 0n) { toast.error("Rate must be positive"); return; }
    setRate.setRate(val);
    setNewNgnRate("");
  };

  const handleSetTermInterest = (termChoice: TermChoice) => {
    const val = BigInt(Math.floor(parseFloat(termBps[termChoice]) || 0));
    if (val <= 0n || val >= 10_000n) {
      toast.error("Interest must be between 1 and 9999 bps (e.g. 1000 = 10%)");
      return;
    }
    setTermInterest.setTermInterest(termChoice, val);
    setTermBps((prev) => {
      const next: [string, string, string] = [...prev] as [string, string, string];
      next[termChoice] = "";
      return next;
    });
  };

  const rateWorking = setRate.isPending || setRate.isConfirming;
  const interestWorking = setTermInterest.isPending || setTermInterest.isConfirming;

  return (
    <div className="p-5" style={glass.card}>
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="size-4" style={{ color: "var(--accent)" }} />
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
          Admin Panel
        </p>
      </div>

      {/* Current NGN rate */}
      <div className="rounded-xl px-3 py-2 mb-4" style={{ background: "var(--surface-muted)" }}>
        <p className="text-xs" style={{ color: "var(--muted)" }}>Current NGN/USDC rate</p>
        <p className="font-semibold tabular-nums text-sm" style={{ color: "var(--ink)" }}>
          {currentNgnRate ? `₦${formatNgn(currentNgnRate)} per USDC` : "—"}
        </p>
      </div>

      <div className="space-y-4">
        {/* Set NGN rate */}
        <div>
          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
            Update NGN/USDC rate <span className="font-normal">(max ±20% per update)</span>
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              value={newNgnRate}
              onChange={(e) => setNewNgnRate(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={currentNgnRate ? currentNgnRate.toString() : "e.g. 1650"}
              className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--surface-muted)", color: "var(--ink)", border: "1px solid var(--border)" }}
            />
            <button
              onClick={handleSetNgnRate}
              disabled={!newNgnRate || rateWorking}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              {rateWorking ? <Loader2 className="size-4 animate-spin" /> : <Settings className="size-4" />}
            </button>
          </div>
          {setRate.hash && (
            <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, setRate.hash)} target="_blank" rel="noreferrer" className="mt-1 block text-xs" style={{ color: "var(--accent-hover)" }}>
              View tx →
            </a>
          )}
        </div>

        {/* Per-term interest rates */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--muted)" }}>
            Interest rates per term
          </p>
          <p className="text-xs mb-3" style={{ color: "var(--subtle)" }}>
            Enter basis points (bps). 1000 = 10%, 1500 = 15%, 2000 = 20%. Applies to new loans and refinancing.
          </p>
          <div className="space-y-2">
            {TERM_LABELS.map((label, i) => {
              const termChoice = i as TermChoice;
              const current = currentTermRates?.[i];
              return (
                <div key={i}>
                  <p className="text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
                    {label}{current !== undefined ? ` — current: ${Number(current) / 100}%` : ""}
                  </p>
                  <div className="flex gap-2">
                    <input
                      inputMode="numeric"
                      value={termBps[i]}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9]/g, "");
                        setTermBps((prev) => {
                          const next: [string, string, string] = [...prev] as [string, string, string];
                          next[i] = v;
                          return next;
                        });
                      }}
                      placeholder={current !== undefined ? current.toString() : "e.g. 1000"}
                      className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
                      style={{ background: "var(--surface-muted)", color: "var(--ink)", border: "1px solid var(--border)" }}
                    />
                    <button
                      onClick={() => handleSetTermInterest(termChoice)}
                      disabled={!termBps[i] || interestWorking}
                      className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--accent)" }}
                    >
                      {interestWorking ? <Loader2 className="size-4 animate-spin" /> : <Settings className="size-4" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {setTermInterest.hash && (
            <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, setTermInterest.hash)} target="_blank" rel="noreferrer" className="mt-2 block text-xs" style={{ color: "var(--accent-hover)" }}>
              View tx →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
