import { useState } from "react";
import { useAccount } from "wagmi";
import { Loader2, PlusCircle, CheckCircle } from "lucide-react";
import { buildTxExplorerUrl } from "@/onchain-facts";
import { parseAmount } from "@/onchain-money";
import { useUsdcBalance, useUsdcAllowance, useApproveUsdc, useTopUpCollateral, useLoanPosition } from "@/hooks/useNairaLock";
import { getNairaLockAddress, ARC_TESTNET_CHAIN_ID, formatUsdc } from "@/utils/nairalock";

const glass = {
  card: {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid rgba(18,45,69,0.10)",
    borderRadius: "1.5rem",
  } as React.CSSProperties,
};

export function TopUpCollateral({ loanIndex, onSuccess }: { loanIndex: number; onSuccess?: () => void }) {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");

  const { data: balance } = useUsdcBalance();
  const { data: allowance } = useUsdcAllowance();
  const { data: loanData } = useLoanPosition(address, loanIndex);
  const approve = useApproveUsdc();
  const topUp = useTopUpCollateral();

  let amountRaw = 0n;
  try {
    if (amount) amountRaw = parseAmount(ARC_TESTNET_CHAIN_ID, amount).raw;
  } catch { /* ignore */ }

  const needsApproval = amountRaw > 0n && (allowance ?? 0n) < amountRaw;
  const isApproving = approve.isPending || approve.isConfirming;
  const isTopping = topUp.isPending || topUp.isConfirming;
  const isWorking = isApproving || isTopping;

  if (topUp.isSuccess) onSuccess?.();

  if (!loanData) return null;
  const [loan, loanState] = loanData;
  if (loanState !== 1 && loanState !== 2) return null;

  const handleAction = () => {
    if (needsApproval) {
      let contractAddress: `0x${string}`;
      try { contractAddress = getNairaLockAddress(); } catch { return; }
      approve.approve(contractAddress, amountRaw);
    } else {
      topUp.topUp(loanIndex, amountRaw);
    }
  };

  const canProceed = amountRaw > 0n && !isWorking && !topUp.isSuccess;
  const txHash = topUp.hash || approve.hash;

  return (
    <div className="p-5" style={glass.card}>
      <p className="mb-1 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
        Add Collateral — Loan #{loanIndex + 1}
      </p>
      <p className="text-xs mb-4" style={{ color: "var(--ink-2)" }}>
        Add more USDC to improve your health ratio or ensure enough coverage for future refinancing.
      </p>

      <div className="flex justify-between text-sm mb-3 rounded-xl px-3 py-2" style={{ background: "var(--surface-muted)" }}>
        <span style={{ color: "var(--muted)" }}>Current collateral</span>
        <span className="font-semibold tabular-nums" style={{ color: "var(--ink)" }}>{formatUsdc(loan.collateralUsdc)} USDC</span>
      </div>

      {topUp.isSuccess && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-3" style={{ background: "rgba(26,128,71,0.08)" }}>
          <CheckCircle className="size-4" style={{ color: "var(--success)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--success)" }}>Collateral added successfully</p>
        </div>
      )}

      <div className="rounded-2xl px-4 py-3 mb-3" style={{ background: "rgba(18,45,69,0.04)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs" style={{ color: "var(--muted)" }}>Amount to add</span>
          {balance !== undefined && (
            <button className="text-xs font-semibold" style={{ color: "var(--accent-hover)" }}
              onClick={() => setAmount(formatUsdc(balance))}>
              Max: {formatUsdc(balance)} USDC
            </button>
          )}
        </div>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ""); if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v); }}
          placeholder="0.00"
          className="display w-full bg-transparent text-2xl font-bold tabular-nums outline-none placeholder:opacity-30"
          style={{ color: "var(--ink)" }}
        />
      </div>

      <button onClick={handleAction} disabled={!canProceed}
        className="w-full rounded-2xl py-3 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: "var(--accent)" }}>
        {isApproving
          ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Approving...</span>
          : isTopping
          ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />Adding collateral...</span>
          : needsApproval ? "Approve USDC"
          : <span className="flex items-center justify-center gap-2"><PlusCircle className="size-4" />Add Collateral</span>}
      </button>

      {txHash && (
        <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, txHash)} target="_blank" rel="noreferrer"
          className="mt-2 flex items-center justify-center gap-1 text-xs" style={{ color: "var(--accent-hover)" }}>
          View transaction →
        </a>
      )}
    </div>
  );
}
