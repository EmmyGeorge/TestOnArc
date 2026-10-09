/**
 * Onchain helpers — viem wallet client for NairaLock owner actions.
 * Uses the owner private key stored in OWNER_PRIVATE_KEY env var.
 * Never log or expose the private key value.
 *
 * RPC: uses RPC_PROXY_BASE_URL when Arc_Testnet is in RPC_PROXY_CHAINS,
 * otherwise falls back to the public Arc Testnet RPC.
 */
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_TESTNET_CHAIN_ID = 5042002;

const arcTestnet = {
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.io"] }, // arc-studio-allow-onchain-literal
    public: { http: ["https://rpc.testnet.arc.io"] },  // arc-studio-allow-onchain-literal
  },
  blockExplorers: {
    default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" },
  },
} as const;

function getArcRpcUrl(): string {
  const proxyBase = process.env.RPC_PROXY_BASE_URL;
  const proxyToken = process.env.RPC_PROXY_TOKEN;
  const proxyChains = (process.env.RPC_PROXY_CHAINS || "").split(",");
  if (proxyBase && proxyToken && proxyChains.includes("Arc_Testnet")) {
    return `${proxyBase}/api/rpc/Arc_Testnet?_rpc_token=${proxyToken}`;
  }
  return "https://rpc.testnet.arc.io"; // arc-studio-allow-onchain-literal
}

const NAIRA_LOCK_ABI = parseAbi([
  "function markRepaid(address borrower, uint256 loanIndex) external",
  "function refinanceLoan(address borrower, uint256 loanIndex, uint8 newTermChoice) external",
  "function liquidate(address borrower, uint256 loanIndex) external",
  "function getLoanCount(address borrower) external view returns (uint256)",
  "function getLoanPosition(address borrower, uint256 loanIndex) external view returns ((uint256 collateralUsdc, uint256 ngnDebt, uint256 termExpiry, uint256 graceDeadline, bool active, bool repaid, bool liquidated) loan, uint8 loanState, bool refinanceEligible)",
  "event LoanOpened(address indexed borrower, uint256 loanIndex, uint256 collateralUsdc, uint256 ngnDebt, uint256 interestPaidUsdc, uint256 processingFeePaid, uint256 termExpiry)",
]);

function getOwnerAccount() {
  const pk = process.env.OWNER_PRIVATE_KEY;
  if (!pk) throw new Error("OWNER_PRIVATE_KEY not set in environment");
  const hex = pk.startsWith("0x") ? (pk as `0x${string}`) : (`0x${pk}` as `0x${string}`);
  return privateKeyToAccount(hex);
}

function getContractAddress(): `0x${string}` {
  const addr = process.env.VITE_NAIRA_LOCK_ADDRESS;
  if (!addr) throw new Error("VITE_NAIRA_LOCK_ADDRESS not set in environment");
  return addr as `0x${string}`;
}

function buildClients() {
  const account = getOwnerAccount();
  const transport = http(getArcRpcUrl());
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport });
  const publicClient = createPublicClient({ chain: arcTestnet, transport });
  return { walletClient, publicClient, account };
}

export async function callMarkRepaid(borrower: string, loanIndex: number): Promise<string> {
  const { walletClient, publicClient, account } = buildClients();
  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: NAIRA_LOCK_ABI,
    functionName: "markRepaid",
    args: [borrower as `0x${string}`, BigInt(loanIndex)],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callRefinanceLoan(borrower: string, loanIndex: number, newTermChoice: number): Promise<string> {
  const { walletClient, publicClient, account } = buildClients();
  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: NAIRA_LOCK_ABI,
    functionName: "refinanceLoan",
    args: [borrower as `0x${string}`, BigInt(loanIndex), newTermChoice as 0 | 1 | 2],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callLiquidate(borrower: string, loanIndex: number): Promise<string> {
  const { walletClient, publicClient, account } = buildClients();
  const hash = await walletClient.writeContract({
    address: getContractAddress(),
    abi: NAIRA_LOCK_ABI,
    functionName: "liquidate",
    args: [borrower as `0x${string}`, BigInt(loanIndex)],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function getLoanCount(borrower: string): Promise<number> {
  const { publicClient } = buildClients();
  const count = await publicClient.readContract({
    address: getContractAddress(),
    abi: NAIRA_LOCK_ABI,
    functionName: "getLoanCount",
    args: [borrower as `0x${string}`],
  });
  return Number(count);
}

export async function getLoanPosition(borrower: string, loanIndex: number) {
  const { publicClient } = buildClients();
  return publicClient.readContract({
    address: getContractAddress(),
    abi: NAIRA_LOCK_ABI,
    functionName: "getLoanPosition",
    args: [borrower as `0x${string}`, BigInt(loanIndex)],
  });
}

export async function verifyLoanOpened(
  txHash: string,
  borrowerAddress: string,
  expectedNgnDebt: bigint
): Promise<{ verified: boolean; loanIndex: number }> {
  try {
    const transport = http(getArcRpcUrl());
    const publicClient = createPublicClient({ chain: arcTestnet, transport });
    const contractAddress = getContractAddress();

    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    if (!receipt || receipt.status !== "success") return { verified: false, loanIndex: 0 };
    if (receipt.to?.toLowerCase() !== contractAddress.toLowerCase()) return { verified: false, loanIndex: 0 };

    const { decodeEventLog } = await import("viem");
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({ abi: NAIRA_LOCK_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName === "LoanOpened") {
          const args = decoded.args as { borrower: string; loanIndex: bigint; ngnDebt: bigint };
          if (
            args.borrower.toLowerCase() === borrowerAddress.toLowerCase() &&
            args.ngnDebt === expectedNgnDebt
          ) {
            return { verified: true, loanIndex: Number(args.loanIndex) };
          }
        }
      } catch { /* not a matching log */ }
    }
    return { verified: false, loanIndex: 0 };
  } catch {
    return { verified: false, loanIndex: 0 };
  }
}
