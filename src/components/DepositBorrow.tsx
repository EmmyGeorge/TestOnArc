import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Loader2, Lock, Info } from "lucide-react";
import { toast } from "sonner";
import { parseAmount } from "@/onchain-money";
import { buildTxExplorerUrl } from "@/onchain-facts";
import {
  useUsdcBalance,
  useUsdcAllowance,
  useApproveUsdc,
  useDepositAndBorrow,
  useMaxBorrow,
  useContractRates,
} from "@/hooks/useNairaLock";
import { getNairaLockAddress, ARC_TESTNET_CHAIN_ID, TERM_LABELS, formatUsdc, formatNgn, type TermChoice } from "@/utils/nairalock";

const glass = {
  card: {
    background: "rgba(255,255,255,0.72)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid rgba(18,45,69,0.10)",
    borderRadius: "1.5rem",
  } as React.CSSProperties,
  inner: {
    background: "rgba(18,45,69,0.04)",
    borderRadius: "1rem",
    border: "1px solid rgba(18,45,69,0.08)",
  } as React.CSSProperties,
};

export function DepositBorrow({ onSuccess }: { onSuccess?: () => void }) {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const [usdcInput, setUsdcInput] = useState("");
  const [ngnInput, setNgnInput] = useState("");
  const [termChoice, setTermChoice] = useState<TermChoice>(0);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "borrowing" | "done">("idle");
  const wrongChain = chainId !== ARC_TESTNET_CHAIN_ID;

  // Parse USDC input
  let usdcRaw = 0n;
  try {
    if (usdcInput) usdcRaw = parseAmount(ARC_TESTNET_CHAIN_ID, usdcInput).raw;
  } catch { /* ignore */ }

  // Parse NGN input (whole Naira, stored as bigint)
  const ngnRaw = ngnInput ? BigInt(Math.floor(parseFloat(ngnInput) || 0)) : 0n;

  const { data: balance } = useUsdcBalance();
  const { data: allowance, refetch: refetchAllowance } = useUsdcAllowance();
  const { data: maxBorrowData } = useMaxBorrow(usdcRaw);
  const { ngnRate, interestRate } = useContractRates();
  const approve = useApproveUsdc();
  const borrow = useDepositAndBorrow();

  const maxNgn = maxBorrowData?.[0] ?? 0n;
  const ngnPerUsd = ngnRate.data as bigint | undefined;
  const rateBps = interestRate.data as bigint | undefined;

  // Interest is on the USDC equivalent of the NGN amount the user actually wants to borrow
  // Formula mirrors the contract: ngnRequested * interestRateBps * 1e6 / (ngnPerUsd * 10_000)
  const actualInterestUsdc =
    ngnRaw > 0n && ngnPerUsd && ngnPerUsd > 0n && rateBps !== undefined
      ? (ngnRaw * rateBps * 1_000_000n) / (ngnPerUsd * 10_000n)
      : 0n;
  const collateralAfterInterest = usdcRaw > actualInterestUsdc ? usdcRaw - actualInterestUsdc : 0n;

  const needsApproval = usdcRaw > 0n && (allowance ?? 0n) < usdcRaw;

  // Approval confirmed — refetch allowance and reset step
  if (approve.isSuccess && step === "approving") {
    void refetchAllowance();
    setStep("idle");
    toast.success("USDC approved");
  }

  // Borrow confirmed
  if (borrow.isSuccess && step === "borrowing") {
    setStep("done");
    toast.success("Loan opened! NGN will be disbursed to your account.");
    if (address) {
      void fetch("/api/register-borrower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
    }
    onSuccess?.();
  }

  const handleAction = () => {
    if (wrongChain) {
      switchChain({ chainId: ARC_TESTNET_CHAIN_ID });
      return;
    }
    if (needsApproval) {
      let contractAddress: `0x${string}`;
      try { contractAddress = getNairaLockAddress(); } catch { return; }
      setStep("approving");
      approve.approve(contractAddress, usdcRaw);
      return;
    }
    if (ngnRaw > 0n && usdcRaw > 0n) {
      setStep("borrowing");
      borrow.deposit(usdcRaw, ngnRaw, termChoice);
    }
  };

  const isWorking = approve.isPending || approve.isConfirming || borrow.isPending || borrow.isConfirming;

  const canProceed =
    !!address &&
    usdcRaw > 0n &&
    ngnRaw > 0n &&
    ngnRaw <= maxNgn &&
    !!email &&
    !isWorking;

  const txHash = borrow.hash || approve.hash;

  return (
    <div className="space-y-4">
      <div style={glass.card} className="p-5">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
          Open a Loan
        </p>

        {/* USDC Amount */}
        <div className="space-y-3">
          <div style={glass.inner} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Deposit USDC (collateral)</span>
              {balance !== undefined && (
                <button
                  className="text-xs font-semibold"
                  style={{ color: "var(--accent-hover)" }}
                  onClick={() => setUsdcInput(formatUsdc(balance))}
                >
                  Max: {formatUsdc(balance)} USDC
                </button>
              )}
            </div>
            <input
              inputMode="decimal"
              value={usdcInput}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, "");
                if (v === "" || /^\d*\.?\d*$/.test(v)) setUsdcInput(v);
              }}
              placeholder="0.00"
              className="display w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:opacity-30"
              style={{ color: "var(--ink)" }}
            />
            <p className="text-xs mt-1" style={{ color: "var(--subtle)" }}>USDC</p>
          </div>

          {/* Interest preview */}
          {ngnRaw > 0n && rateBps !== undefined && actualInterestUsdc > 0n && (
            <div className="flex items-start gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(186,43,76,0.06)" }}>
              <Info className="size-3.5 mt-0.5 shrink-0" style={{ color: "var(--danger)" }} />
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                <span className="font-semibold">{formatUsdc(actualInterestUsdc)} USDC</span> interest deducted upfront ({Number(rateBps) / 100}% of borrowed amount).{" "}
                <span className="font-semibold">{formatUsdc(collateralAfterInterest)} USDC</span> will be locked as collateral.
              </p>
            </div>
          )}

          {/* NGN Amount */}
          <div style={glass.inner} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Borrow NGN amount</span>
              {maxNgn > 0n && (
                <button
                  className="text-xs font-semibold"
                  style={{ color: "var(--accent-hover)" }}
                  onClick={() => setNgnInput(maxNgn.toString())}
                >
                  Max: ₦{formatNgn(maxNgn)}
                </button>
              )}
            </div>
            <input
              inputMode="numeric"
              value={ngnInput}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, "");
                setNgnInput(v);
              }}
              placeholder="0"
              className="display w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:opacity-30"
              style={{ color: "var(--ink)" }}
            />
            <p className="text-xs mt-1" style={{ color: "var(--subtle)" }}>
              NGN {ngnPerUsd && usdcRaw > 0n ? `· Rate: ₦${formatNgn(ngnPerUsd)} / USDC` : ""}
            </p>
            {ngnRaw > 0n && maxNgn > 0n && ngnRaw > maxNgn && (
              <p className="text-xs mt-1 font-medium" style={{ color: "var(--danger)" }}>
                Exceeds max (₦{formatNgn(maxNgn)})
              </p>
            )}
          </div>

          {/* Loan term */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--muted)" }}>Loan term</p>
            <div className="grid grid-cols-3 gap-2">
              {TERM_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => setTermChoice(i as TermChoice)}
                  className="rounded-xl py-2.5 text-sm font-semibold transition-all"
                  style={{
                    background: termChoice === i ? "var(--accent)" : "var(--surface-muted)",
                    color: termChoice === i ? "#fff" : "var(--ink-2)",
                    border: termChoice === i ? "none" : "1px solid var(--border)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Email for NGN disbursal */}
          <div style={glass.inner} className="px-4 py-3">
            <p className="text-xs font-medium mb-1" style={{ color: "var(--muted)" }}>
              Email for NGN transfer notifications
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
              style={{ color: "var(--ink)" }}
            />
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleAction}
          disabled={!canProceed && !wrongChain}
          className="mt-4 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          {!address
            ? "Connect Wallet"
            : wrongChain
            ? "Switch to Arc Testnet"
            : isWorking
            ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{step === "approving" ? "Approving USDC..." : "Opening loan..."}</span>
            : needsApproval
            ? "Approve USDC"
            : <span className="flex items-center justify-center gap-2"><Lock className="size-4" /> Deposit & Borrow NGN</span>}
        </button>

        {/* Tx link */}
        {txHash && (
          <a
            href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, txHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex items-center justify-center gap-1 text-xs"
            style={{ color: "var(--accent-hover)" }}
          >
            View transaction →
          </a>
        )}
      </div>
    </div>
  );
}
