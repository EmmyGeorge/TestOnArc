import { useState } from "react";
import { useAccount } from "wagmi";
import { Loader2, ShieldCheck, Settings } from "lucide-react";
import { toast } from "sonner";
import { buildTxExplorerUrl } from "@/onchain-facts";
import { useSetNgnRate, useSetInterestRate, useContractRates } from "@/hooks/useNairaLock";
import { ARC_TESTNET_CHAIN_ID, formatNgn } from "@/utils/nairalock";

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
  const { ngnRate, interestRate, ownerAddress } = useContractRates();
  const setRate = useSetNgnRate();
  const setInterest = useSetInterestRate();

  const [newNgnRate, setNewNgnRate] = useState("");
  const [newInterestBps, setNewInterestBps] = useState("");

  const owner = ownerAddress.data as string | undefined;
  const isOwner = address && owner && address.toLowerCase() === owner.toLowerCase();

  if (!isOwner) return null;

  const currentNgnRate = ngnRate.data as bigint | undefined;
  const currentBps = interestRate.data as bigint | undefined;

  const handleSetNgnRate = () => {
    const val = BigInt(Math.floor(parseFloat(newNgnRate) || 0));
    if (val <= 0n) { toast.error("Rate must be positive"); return; }
    setRate.setRate(val);
    setNewNgnRate("");
  };

  const handleSetInterest = () => {
    const val = BigInt(Math.floor(parseFloat(newInterestBps) || 0));
    if (val <= 0n || val >= 10_000n) { toast.error("Interest must be between 1 and 9999 bps"); return; }
    setInterest.setInterest(val);
    setNewInterestBps("");
  };

  const rateWorking = setRate.isPending || setRate.isConfirming;
  const interestWorking = setInterest.isPending || setInterest.isConfirming;

  return (
    <div className="p-5" style={glass.card}>
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck className="size-4" style={{ color: "var(--accent)" }} />
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
          Admin Panel
        </p>
      </div>

      {/* Current values */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-xl px-3 py-2" style={{ background: "var(--surface-muted)" }}>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Current NGN/USDC</p>
          <p className="font-semibold tabular-nums text-sm" style={{ color: "var(--ink)" }}>
            {currentNgnRate ? `₦${formatNgn(currentNgnRate)}` : "—"}
          </p>
        </div>
        <div className="rounded-xl px-3 py-2" style={{ background: "var(--surface-muted)" }}>
          <p className="text-xs" style={{ color: "var(--muted)" }}>Current interest</p>
          <p className="font-semibold tabular-nums text-sm" style={{ color: "var(--ink)" }}>
            {currentBps ? `${Number(currentBps) / 100}%` : "—"}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Set NGN rate */}
        <div>
          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
            Update NGN/USDC rate <span className="font-normal">(max ±20% from current)</span>
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
            <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, setRate.hash)} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "var(--accent-hover)" }}>
              View tx →
            </a>
          )}
        </div>

        {/* Set interest rate */}
        <div>
          <p className="text-xs font-medium mb-1.5" style={{ color: "var(--muted)" }}>
            Update interest rate (basis points, e.g. 1000 = 10%)
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              value={newInterestBps}
              onChange={(e) => setNewInterestBps(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder={currentBps ? currentBps.toString() : "e.g. 1000"}
              className="flex-1 rounded-xl px-3 py-2.5 text-sm outline-none"
              style={{ background: "var(--surface-muted)", color: "var(--ink)", border: "1px solid var(--border)" }}
            />
            <button
              onClick={handleSetInterest}
              disabled={!newInterestBps || interestWorking}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              {interestWorking ? <Loader2 className="size-4 animate-spin" /> : <Settings className="size-4" />}
            </button>
          </div>
          {setInterest.hash && (
            <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, setInterest.hash)} target="_blank" rel="noreferrer" className="text-xs" style={{ color: "var(--accent-hover)" }}>
              View tx →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
