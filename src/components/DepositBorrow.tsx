import { useState, useEffect, useRef } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Loader2, Lock, Info, CheckCircle2, Building2, User } from "lucide-react";
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
  useProcessingFee,
} from "@/hooks/useNairaLock";
import {
  getNairaLockAddress,
  ARC_TESTNET_CHAIN_ID,
  TERM_LABELS,
  formatUsdc,
  formatNgn,
  type TermChoice,
} from "@/utils/nairalock";

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

interface Bank { name: string; code: string; }
interface ResolvedAccount { accountName: string; accountNumber: string; bankCode: string; }

export function DepositBorrow({ onSuccess }: { onSuccess?: () => void }) {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();

  // Form state
  const [usdcInput, setUsdcInput] = useState("");
  const [ngnInput, setNgnInput] = useState("");
  const [termChoice, setTermChoice] = useState<TermChoice>(0);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "borrowing" | "done">("idle");

  // Bank / account resolution state
  const [banks, setBanks] = useState<Bank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [selectedBank, setSelectedBank] = useState<Bank | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedAccount, setResolvedAccount] = useState<ResolvedAccount | null>(null);
  const [resolving, setResolving] = useState(false);
  const [bankSearch, setBankSearch] = useState("");
  const [showBankList, setShowBankList] = useState(false);
  const bankListRef = useRef<HTMLDivElement>(null);

  const wrongChain = chainId !== ARC_TESTNET_CHAIN_ID;

  // Parse USDC input
  let usdcRaw = 0n;
  try { if (usdcInput) usdcRaw = parseAmount(ARC_TESTNET_CHAIN_ID, usdcInput).raw; } catch { /* ignore */ }

  // Parse NGN input
  const ngnRaw = ngnInput ? BigInt(Math.floor(parseFloat(ngnInput) || 0)) : 0n;

  const { data: balance } = useUsdcBalance();
  const { data: allowance, refetch: refetchAllowance } = useUsdcAllowance();
  const { data: maxBorrowData } = useMaxBorrow(usdcRaw, termChoice);
  const { ngnRate, termRates } = useContractRates();
  const { data: processingFee } = useProcessingFee();
  const approve = useApproveUsdc();
  const borrow = useDepositAndBorrow();

  const maxNgn = maxBorrowData?.[0] ?? 0n;
  const ngnPerUsd = ngnRate.data as bigint | undefined;
  const rateBps = termRates.data?.[termChoice];
  const feeUsdc = processingFee ?? 500_000n;

  // Interest on actual NGN requested
  const actualInterestUsdc =
    ngnRaw > 0n && ngnPerUsd && ngnPerUsd > 0n && rateBps !== undefined
      ? (ngnRaw * rateBps * 1_000_000n) / (ngnPerUsd * 10_000n)
      : 0n;
  const totalFeesUsdc = actualInterestUsdc + feeUsdc;
  const collateralAfterFees = usdcRaw > totalFeesUsdc ? usdcRaw - totalFeesUsdc : 0n;

  // Load banks on mount
  useEffect(() => {
    setBanksLoading(true);
    fetch("/api/banks")
      .then((r) => r.json())
      .then((d: { banks: Bank[] }) => setBanks(d.banks ?? []))
      .catch(() => setBanks([]))
      .finally(() => setBanksLoading(false));
  }, []);

  // Close bank dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bankListRef.current && !bankListRef.current.contains(e.target as Node)) {
        setShowBankList(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reset resolved account when bank or account number changes
  useEffect(() => {
    setResolvedAccount(null);
  }, [selectedBank, accountNumber]);

  // Auto-resolve once 10 digits entered and bank selected
  useEffect(() => {
    if (accountNumber.length === 10 && selectedBank) {
      void handleResolveAccount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountNumber, selectedBank]);

  const handleResolveAccount = async () => {
    if (!selectedBank || accountNumber.length !== 10) return;
    setResolving(true);
    try {
      const res = await fetch("/api/resolve-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber, bankCode: selectedBank.code }),
      });
      const data = (await res.json()) as ResolvedAccount & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || "Resolution failed");
      setResolvedAccount(data);
    } catch {
      toast.error("Could not verify account. Check the account number and bank.");
      setResolvedAccount(null);
    } finally {
      setResolving(false);
    }
  };

  const needsApproval = usdcRaw > 0n && (allowance ?? 0n) < usdcRaw;

  // Approval confirmed
  if (approve.isSuccess && step === "approving") {
    void refetchAllowance();
    setStep("idle");
    toast.success("USDC approved");
  }

  // Borrow confirmed — trigger disbursement
  if (borrow.isSuccess && step === "borrowing" && borrow.hash) {
    setStep("done");
    toast.success("Loan opened! Disbursing NGN to your account...");
    if (address) {
      void fetch("/api/register-borrower", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      // Trigger automatic NGN disbursement
      void fetch("/api/disburse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: borrow.hash,
          borrowerAddress: address,
          ngnAmount: Number(ngnRaw),
          accountNumber,
          bankCode: selectedBank?.code,
          accountName: resolvedAccount?.accountName,
        }),
      }).then(async (r) => {
        const d = (await r.json()) as { ok?: boolean; error?: string };
        if (d.ok) {
          toast.success(`₦${formatNgn(ngnRaw)} is on its way to ${resolvedAccount?.accountName ?? "your account"}!`);
        } else {
          toast.error(`Disbursement issue: ${d.error ?? "Contact support"}`);
        }
      });
    }
    onSuccess?.();
  }

  const filteredBanks = banks.filter((b) => b.name.toLowerCase().includes(bankSearch.toLowerCase()));

  const handleAction = () => {
    if (wrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return; }
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
    !!resolvedAccount &&
    !isWorking;

  const txHash = borrow.hash || approve.hash;

  return (
    <div className="space-y-4">
      <div style={glass.card} className="p-5">
        <p className="mb-4 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--muted)" }}>
          Open a Loan
        </p>

        <div className="space-y-3">
          {/* USDC Amount */}
          <div style={glass.inner} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Deposit USDC (collateral)</span>
              {balance !== undefined && (
                <button className="text-xs font-semibold" style={{ color: "var(--accent-hover)" }}
                  onClick={() => setUsdcInput(formatUsdc(balance))}>
                  Max: {formatUsdc(balance)} USDC
                </button>
              )}
            </div>
            <input
              inputMode="decimal"
              value={usdcInput}
              onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ""); if (v === "" || /^\d*\.?\d*$/.test(v)) setUsdcInput(v); }}
              placeholder="0.00"
              className="display w-full bg-transparent text-3xl font-bold tabular-nums outline-none placeholder:opacity-30"
              style={{ color: "var(--ink)" }}
            />
            <p className="text-xs mt-1" style={{ color: "var(--subtle)" }}>USDC</p>
          </div>

          {/* NGN Amount */}
          <div style={glass.inner} className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium" style={{ color: "var(--muted)" }}>Borrow NGN amount</span>
              {maxNgn > 0n && (
                <button className="text-xs font-semibold" style={{ color: "var(--accent-hover)" }}
                  onClick={() => setNgnInput(maxNgn.toString())}>
                  Max: ₦{formatNgn(maxNgn)}
                </button>
              )}
            </div>
            <input
              inputMode="numeric"
              value={ngnInput}
              onChange={(e) => setNgnInput(e.target.value.replace(/[^0-9]/g, ""))}
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

          {/* Fee breakdown */}
          {ngnRaw > 0n && usdcRaw > 0n && (
            <div className="rounded-xl px-3 py-3 space-y-1.5" style={{ background: "rgba(186,43,76,0.06)" }}>
              <div className="flex items-center gap-1.5 mb-1">
                <Info className="size-3.5 shrink-0" style={{ color: "var(--danger)" }} />
                <p className="text-xs font-semibold" style={{ color: "var(--danger)" }}>Upfront deductions</p>
              </div>
              <div className="flex justify-between text-xs" style={{ color: "var(--ink-2)" }}>
                <span>Interest ({Number(rateBps ?? 0n) / 100}% of borrowed amount)</span>
                <span className="font-semibold tabular-nums">{formatUsdc(actualInterestUsdc)} USDC</span>
              </div>
              <div className="flex justify-between text-xs" style={{ color: "var(--ink-2)" }}>
                <span>Bank transfer processing fee</span>
                <span className="font-semibold tabular-nums">{formatUsdc(feeUsdc)} USDC</span>
              </div>
              <div className="flex justify-between text-xs border-t pt-1.5 mt-1" style={{ color: "var(--ink)", borderColor: "rgba(186,43,76,0.15)" }}>
                <span className="font-semibold">Collateral locked</span>
                <span className="font-bold tabular-nums">{formatUsdc(collateralAfterFees)} USDC</span>
              </div>
            </div>
          )}

          {/* Loan term */}
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--muted)" }}>Loan term</p>
            <div className="grid grid-cols-3 gap-2">
              {TERM_LABELS.map((label, i) => (
                <button key={i} onClick={() => setTermChoice(i as TermChoice)}
                  className="rounded-xl py-2.5 text-sm font-semibold transition-all"
                  style={{
                    background: termChoice === i ? "var(--accent)" : "var(--surface-muted)",
                    color: termChoice === i ? "#fff" : "var(--ink-2)",
                    border: termChoice === i ? "none" : "1px solid var(--border)",
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Bank account section */}
          <div style={glass.inner} className="p-4 space-y-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Building2 className="size-3.5" style={{ color: "var(--accent)" }} />
              <p className="text-xs font-semibold" style={{ color: "var(--ink)" }}>Receiving Bank Account</p>
            </div>

            {/* Bank selector */}
            <div className="relative" ref={bankListRef}>
              <button
                type="button"
                onClick={() => setShowBankList((v) => !v)}
                className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm"
                style={{ background: "var(--surface-muted)", border: "1px solid var(--border)", color: "var(--ink)" }}>
                <span>{selectedBank?.name ?? (banksLoading ? "Loading banks..." : "Select bank")}</span>
                <span style={{ color: "var(--muted)" }}>▾</span>
              </button>
              {showBankList && (
                <div className="absolute z-20 w-full mt-1 rounded-xl shadow-lg overflow-hidden"
                  style={{ background: "white", border: "1px solid var(--border)", maxHeight: "220px" }}>
                  <div className="p-2 border-b" style={{ borderColor: "var(--border)" }}>
                    <input
                      autoFocus
                      value={bankSearch}
                      onChange={(e) => setBankSearch(e.target.value)}
                      placeholder="Search bank..."
                      className="w-full text-sm outline-none px-2 py-1 rounded-lg"
                      style={{ background: "var(--surface-muted)", color: "var(--ink)" }}
                    />
                  </div>
                  <div className="overflow-y-auto" style={{ maxHeight: "160px" }}>
                    {filteredBanks.map((b) => (
                      <button key={b.code} type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                        style={{ color: "var(--ink)" }}
                        onClick={() => { setSelectedBank(b); setShowBankList(false); setBankSearch(""); }}>
                        {b.name}
                      </button>
                    ))}
                    {filteredBanks.length === 0 && (
                      <p className="text-xs text-center py-3" style={{ color: "var(--muted)" }}>No banks found</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Account number */}
            <div>
              <input
                inputMode="numeric"
                maxLength={10}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="10-digit account number"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: "var(--surface-muted)", border: "1px solid var(--border)", color: "var(--ink)" }}
              />
            </div>

            {/* Account resolution status */}
            {resolving && (
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
                <Loader2 className="size-3.5 animate-spin" /> Verifying account...
              </div>
            )}
            {resolvedAccount && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)" }}>
                <CheckCircle2 className="size-4 shrink-0" style={{ color: "var(--success)" }} />
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--success)" }}>Account verified</p>
                  <p className="text-sm font-bold" style={{ color: "var(--ink)" }}>
                    <User className="size-3 inline mr-1" style={{ color: "var(--muted)" }} />
                    {resolvedAccount.accountName}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Email */}
          <div style={glass.inner} className="px-4 py-3">
            <p className="text-xs font-medium mb-1" style={{ color: "var(--muted)" }}>
              Email for transfer notifications
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

          {/* Account not verified warning */}
          {!resolvedAccount && (accountNumber.length > 0 || selectedBank) && !resolving && (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {!selectedBank ? "Select a bank to continue." : accountNumber.length < 10 ? `Enter ${10 - accountNumber.length} more digit(s).` : "Verifying..."}
            </p>
          )}
        </div>

        {/* CTA */}
        <button
          onClick={handleAction}
          disabled={!canProceed && !wrongChain}
          className="mt-4 w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--accent)" }}>
          {!address
            ? "Connect Wallet"
            : wrongChain
            ? "Switch to Arc Testnet"
            : isWorking
            ? <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {step === "approving" ? "Approving USDC..." : "Opening loan..."}
              </span>
            : needsApproval
            ? "Approve USDC"
            : !resolvedAccount
            ? "Verify Bank Account to Continue"
            : <span className="flex items-center justify-center gap-2">
                <Lock className="size-4" /> Deposit & Borrow NGN
              </span>}
        </button>

        {txHash && (
          <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, txHash)} target="_blank" rel="noreferrer"
            className="mt-2 flex items-center justify-center gap-1 text-xs" style={{ color: "var(--accent-hover)" }}>
            View transaction →
          </a>
        )}
      </div>
    </div>
  );
}
