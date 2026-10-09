import { useState } from "react";
import { ConnectKitButton } from "connectkit";
import { useAccount } from "wagmi";
import { TrendingUp, LayoutDashboard, AlertTriangle, PlusCircle, ShieldCheck } from "lucide-react";
import { RateDisplay } from "@/components/RateDisplay";
import { DepositBorrow } from "@/components/DepositBorrow";
import { LoanDashboard } from "@/components/LoanDashboard";
import { GraceActions } from "@/components/GraceActions";
import { TopUpCollateral } from "@/components/TopUpCollateral";
import { AdminPanel } from "@/components/AdminPanel";
import { useLoanCount, useContractRates } from "@/hooks/useNairaLock";

type Tab = "borrow" | "dashboard" | "grace" | "topup" | "admin";

function TabBar({ active, setActive, showAdmin }: {
  active: Tab;
  setActive: (t: Tab) => void;
  showAdmin: boolean;
}) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "borrow", label: "Borrow", icon: <TrendingUp className="size-4" /> },
    { id: "dashboard", label: "Loans", icon: <LayoutDashboard className="size-4" /> },
    { id: "grace", label: "Repay/Refi", icon: <AlertTriangle className="size-4" /> },
    { id: "topup", label: "Top Up", icon: <PlusCircle className="size-4" /> },
    ...(showAdmin ? [{ id: "admin" as Tab, label: "Admin", icon: <ShieldCheck className="size-4" /> }] : []),
  ];

  return (
    <div className="flex gap-1 rounded-2xl p-1" style={{ background: "var(--surface-muted)", border: "1px solid var(--border)" }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActive(tab.id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold transition-all"
          style={
            active === tab.id
              ? { background: "var(--accent)", color: "#fff", boxShadow: "0 2px 8px rgba(18,45,69,0.18)" }
              : { color: "var(--muted)" }
          }
        >
          {tab.icon}
          <span className="hidden sm:inline">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const { address } = useAccount();
  const [tab, setTab] = useState<Tab>("borrow");
  // activeLoanIndex is set when user clicks "Repay/Refinance" or "Top Up" on a specific loan card
  const [activeLoanIndex, setActiveLoanIndex] = useState(0);
  const { data: loanCount } = useLoanCount(address);
  const { ownerAddress } = useContractRates();

  const owner = ownerAddress.data as string | undefined;
  const isOwner = address && owner && address.toLowerCase() === owner.toLowerCase();

  const handleGoToGraceActions = (loanIndex: number) => {
    setActiveLoanIndex(loanIndex);
    setTab("grace");
  };

  const handleGoToTopUp = (loanIndex: number) => {
    setActiveLoanIndex(loanIndex);
    setTab("topup");
  };

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg-gradient)" }}>
      {/* Header */}
      <header
        className="sticky top-0 z-30 px-4 py-3"
        style={{
          background: "rgba(255,255,255,0.82)",
          backdropFilter: "blur(24px) saturate(180%)",
          WebkitBackdropFilter: "blur(24px) saturate(180%)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="mx-auto flex max-w-md items-center justify-between">
          <div>
            <p className="display text-lg font-bold" style={{ color: "var(--ink)" }}>NairaLock</p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>USDC-backed NGN lending</p>
          </div>
          <ConnectKitButton />
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-md px-4 pb-16 pt-4 space-y-4">
        <RateDisplay />

        <TabBar active={tab} setActive={setTab} showAdmin={!!isOwner} />

        {tab === "borrow" && (
          <DepositBorrow onSuccess={() => setTab("dashboard")} />
        )}

        {tab === "dashboard" && (
          <LoanDashboard
            onGoToGraceActions={handleGoToGraceActions}
            onGoToTopUp={handleGoToTopUp}
            onGoToBorrow={() => setTab("borrow")}
          />
        )}

        {tab === "grace" && (
          <>
            {/* Loan selector when multiple loans exist */}
            {Number(loanCount ?? 0n) > 1 && (
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: Number(loanCount) }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveLoanIndex(i)}
                    className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                    style={{
                      background: activeLoanIndex === i ? "var(--accent)" : "var(--surface-muted)",
                      color: activeLoanIndex === i ? "#fff" : "var(--muted)",
                    }}
                  >
                    Loan #{i + 1}
                  </button>
                ))}
              </div>
            )}
            <GraceActions loanIndex={activeLoanIndex} onDone={() => setTab("dashboard")} />
          </>
        )}

        {tab === "topup" && (
          <>
            {Number(loanCount ?? 0n) > 1 && (
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: Number(loanCount) }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveLoanIndex(i)}
                    className="rounded-xl px-3 py-1.5 text-xs font-semibold transition-all"
                    style={{
                      background: activeLoanIndex === i ? "var(--accent)" : "var(--surface-muted)",
                      color: activeLoanIndex === i ? "#fff" : "var(--muted)",
                    }}
                  >
                    Loan #{i + 1}
                  </button>
                ))}
              </div>
            )}
            <TopUpCollateral loanIndex={activeLoanIndex} onSuccess={() => setTab("dashboard")} />
          </>
        )}

        {tab === "admin" && isOwner && <AdminPanel />}

        <div className="rounded-2xl px-4 py-3 text-xs space-y-1" style={{ background: "rgba(18,45,69,0.04)", border: "1px solid var(--border)" }}>
          <p className="font-semibold" style={{ color: "var(--ink-2)" }}>How NGN disbursal works</p>
          <p style={{ color: "var(--muted)" }}>
            After locking your USDC, the equivalent NGN is transferred to your verified bank account automatically via Paystack. Your USDC collateral is released automatically once your NGN repayment clears.
          </p>
        </div>
      </main>
    </div>
  );
}
