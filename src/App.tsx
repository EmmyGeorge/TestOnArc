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
import { useLoanPosition, useContractRates } from "@/hooks/useNairaLock";

type Tab = "borrow" | "dashboard" | "grace" | "topup" | "admin";

function TabBar({ active, setActive, showGrace, showAdmin }: {
  active: Tab;
  setActive: (t: Tab) => void;
  showGrace: boolean;
  showAdmin: boolean;
}) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "borrow", label: "Borrow", icon: <TrendingUp className="size-4" /> },
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" /> },
    ...(showGrace ? [{ id: "grace" as Tab, label: "Repay/Refi", icon: <AlertTriangle className="size-4" /> }] : []),
    { id: "topup", label: "Top Up", icon: <PlusCircle className="size-4" /> },
    ...(showAdmin ? [{ id: "admin" as Tab, label: "Admin", icon: <ShieldCheck className="size-4" /> }] : []),
  ];

  return (
    <div className="flex gap-1 rounded-2xl p-1" style={{ background: "var(--surface-muted)", border: "1px solid var(--border)" }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActive(tab.id)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all"
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
  const { data: loanData } = useLoanPosition(address);
  const { ownerAddress } = useContractRates();

  const loanState = loanData?.[1] ?? 0;
  const showGrace = loanState === 2;
  const owner = ownerAddress.data as string | undefined;
  const isOwner = address && owner && address.toLowerCase() === owner.toLowerCase();

  // Auto-navigate to grace tab when grace period detected
  // (user is already on borrow tab — nudge them gently via the dashboard state badge instead)

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
            <p className="display text-lg font-bold" style={{ color: "var(--ink)" }}>
              NairaLock
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              USDC-backed NGN lending
            </p>
          </div>
          <ConnectKitButton />
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-md px-4 pb-16 pt-4 space-y-4">
        {/* Rate banner */}
        <RateDisplay />

        {/* Tab bar */}
        <TabBar
          active={tab}
          setActive={setTab}
          showGrace={showGrace}
          showAdmin={!!isOwner}
        />

        {/* Tab content */}
        {tab === "borrow" && (
          <DepositBorrow onSuccess={() => setTab("dashboard")} />
        )}

        {tab === "dashboard" && (
          <LoanDashboard onGoToGraceActions={() => setTab("grace")} />
        )}

        {tab === "grace" && (
          <GraceActions onDone={() => setTab("dashboard")} />
        )}

        {tab === "topup" && (
          <TopUpCollateral onSuccess={() => setTab("dashboard")} />
        )}

        {tab === "admin" && isOwner && (
          <AdminPanel />
        )}

        {/* Paystack note */}
        <div
          className="rounded-2xl px-4 py-3 text-xs space-y-1"
          style={{ background: "rgba(18,45,69,0.04)", border: "1px solid var(--border)" }}
        >
          <p className="font-semibold" style={{ color: "var(--ink-2)" }}>How NGN disbursal works</p>
          <p style={{ color: "var(--muted)" }}>
            After locking your USDC, the equivalent NGN will be transferred to your bank account within 24 hours. Repayment is processed via Paystack — bank transfer, card, or USSD. Your USDC collateral is released automatically once your NGN payment clears.
          </p>
        </div>
      </main>
    </div>
  );
}
