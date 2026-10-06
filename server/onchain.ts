/**
 * Onchain helpers — viem wallet client for NairaLock owner actions.
 * Uses the owner private key stored in OWNER_PRIVATE_KEY env var.
 * Never log or expose the private key value.
 *
 * RPC: uses RPC_PROXY_BASE_URL when Arc_Testnet is in RPC_PROXY_CHAINS,
 * otherwise falls back to the public Arc Testnet RPC from onchain-facts.
 */
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Arc Testnet chain ID
const ARC_TESTNET_CHAIN_ID = 5042002;

// Arc Testnet viem chain definition — RPC resolved at runtime via getArcRpcUrl()
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

/**
 * Resolve the Arc Testnet RPC URL: prefer the keyed RPC proxy if available,
 * fall back to the public endpoint from onchain-facts.
 */
function getArcRpcUrl(): string {
  const proxyBase = process.env.RPC_PROXY_BASE_URL;
  const proxyToken = process.env.RPC_PROXY_TOKEN;
  const proxyChains = (process.env.RPC_PROXY_CHAINS || "").split(",");

  if (proxyBase && proxyToken && proxyChains.includes("Arc_Testnet")) {
    return `${proxyBase}/api/rpc/Arc_Testnet?_rpc_token=${proxyToken}`;
  }

  // Fall back to public Arc Testnet RPC (rate limit unknown; may throttle under load)
  return "https://rpc.testnet.arc.io"; // arc-studio-allow-onchain-literal
}

const NAIRA_LOCK_ABI = parseAbi([
  "function markRepaid(address borrower) external",
  "function refinanceLoan(address borrower, uint8 newTermChoice) external",
  "function liquidate(address borrower) external",
  "function getLoanPosition(address borrower) external view returns ((uint256 collateralUsdc, uint256 ngnDebt, uint256 termExpiry, uint256 graceDeadline, bool active, bool repaid, bool liquidated) loan, uint8 loanState, bool refinanceEligible, uint256 currentInterestDueUsdc)",
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

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport,
  });

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport,
  });

  return { walletClient, publicClient, account };
}

export async function callMarkRepaid(borrower: string): Promise<string> {
  const { walletClient, publicClient, account } = buildClients();
  const contractAddress = getContractAddress();

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "markRepaid",
    args: [borrower as `0x${string}`],
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callRefinanceLoan(borrower: string, newTermChoice: number): Promise<string> {
  const { walletClient, publicClient, account } = buildClients();
  const contractAddress = getContractAddress();

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "refinanceLoan",
    args: [borrower as `0x${string}`, newTermChoice as 0 | 1 | 2],
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function callLiquidate(borrower: string): Promise<string> {
  const { walletClient, publicClient, account } = buildClients();
  const contractAddress = getContractAddress();

  const hash = await walletClient.writeContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "liquidate",
    args: [borrower as `0x${string}`],
    account,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function getLoanPosition(borrower: string) {
  const { publicClient } = buildClients();
  const contractAddress = getContractAddress();

  const result = await publicClient.readContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "getLoanPosition",
    args: [borrower as `0x${string}`],
  });

  return result;
}
