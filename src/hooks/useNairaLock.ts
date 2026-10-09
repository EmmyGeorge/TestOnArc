/**
 * Hooks for reading and writing to the NairaLock contract.
 * Multi-loan: all loan-specific hooks take a loanIndex parameter.
 */
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { erc20Abi } from "viem";
import { getUsdc } from "@/onchain-facts";
import { getNairaLockAddress, NAIRA_LOCK_ABI, ARC_TESTNET_CHAIN_ID, type LoanData } from "@/utils/nairalock";

const CHAIN_ID = ARC_TESTNET_CHAIN_ID;

function getContractAddr(): `0x${string}` | undefined {
  try { return getNairaLockAddress(); } catch { return undefined; }
}

export function useUsdcBalance() {
  const { address } = useAccount();
  const usdc = getUsdc(CHAIN_ID);
  return useReadContract({
    address: usdc?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!usdc },
  });
}

export function useUsdcAllowance() {
  const { address } = useAccount();
  const usdc = getUsdc(CHAIN_ID);
  const contractAddress = getContractAddr();
  return useReadContract({
    address: usdc?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && contractAddress ? [address, contractAddress] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!usdc && !!contractAddress },
  });
}

/** Returns total number of loans for a borrower */
export function useLoanCount(borrowerAddress?: string) {
  const contractAddress = getContractAddr();
  return useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "getLoanCount",
    args: borrowerAddress ? [borrowerAddress as `0x${string}`] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!borrowerAddress && !!contractAddress, refetchInterval: 15_000 },
  }) as { data: bigint | undefined; isLoading: boolean; refetch: () => void };
}

/** Returns loan position for a specific loanIndex */
export function useLoanPosition(borrowerAddress?: string, loanIndex?: number) {
  const contractAddress = getContractAddr();
  return useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "getLoanPosition",
    args: borrowerAddress !== undefined && loanIndex !== undefined
      ? [borrowerAddress as `0x${string}`, BigInt(loanIndex)]
      : undefined,
    chainId: CHAIN_ID,
    query: {
      enabled: !!borrowerAddress && loanIndex !== undefined && !!contractAddress,
      refetchInterval: 15_000,
    },
  }) as { data: [LoanData["loan"], LoanData["loanState"], boolean, bigint] | undefined; isLoading: boolean; refetch: () => void };
}

export function useMaxBorrow(usdcAmount: bigint, termChoice: 0 | 1 | 2) {
  const contractAddress = getContractAddr();
  return useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "getMaxBorrow",
    args: [usdcAmount, termChoice],
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress && usdcAmount > 0n },
  }) as { data: [bigint, bigint, bigint, bigint] | undefined };
}

export function useProcessingFee() {
  const contractAddress = getContractAddr();
  return useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "processingFeeUsdc",
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress, refetchInterval: 60_000 },
  }) as { data: bigint | undefined };
}

export function useGetRefinanceInterest(borrowerAddress: string | undefined, loanIndex: number | undefined, newTermChoice: 0 | 1 | 2) {
  const contractAddress = getContractAddr();
  return useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "getRefinanceInterest",
    args: borrowerAddress !== undefined && loanIndex !== undefined
      ? [borrowerAddress as `0x${string}`, BigInt(loanIndex), newTermChoice]
      : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress && !!borrowerAddress && loanIndex !== undefined, refetchInterval: 15_000 },
  }) as { data: bigint | undefined };
}

export function useContractRates() {
  const contractAddress = getContractAddr();

  const ngnRate = useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "ngnPerUsd",
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress, refetchInterval: 30_000 },
  });

  const termRates = useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "getTermRates",
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress, refetchInterval: 30_000 },
  }) as { data: [bigint, bigint, bigint] | undefined };

  const ownerAddress = useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "owner",
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress },
  });

  return { ngnRate, termRates, ownerAddress };
}

export function useApproveUsdc() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const usdc = getUsdc(CHAIN_ID);

  const approve = (spender: `0x${string}`, amount: bigint) => {
    if (!usdc) return;
    writeContract({
      address: usdc.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
      chainId: CHAIN_ID,
    });
  };

  return { approve, hash, isPending, isConfirming, isSuccess, error };
}

export function useDepositAndBorrow() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const deposit = (usdcAmount: bigint, ngnRequested: bigint, termChoice: 0 | 1 | 2) => {
    const contractAddress = getContractAddr();
    if (!contractAddress) return;
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "depositAndBorrow",
      args: [usdcAmount, ngnRequested, termChoice],
      chainId: CHAIN_ID,
    });
  };

  return { deposit, hash, isPending, isConfirming, isSuccess, error };
}

export function useTopUpCollateral() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const topUp = (loanIndex: number, additionalUsdc: bigint) => {
    const contractAddress = getContractAddr();
    if (!contractAddress) return;
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "topUpCollateral",
      args: [BigInt(loanIndex), additionalUsdc],
      chainId: CHAIN_ID,
    });
  };

  return { topUp, hash, isPending, isConfirming, isSuccess, error };
}

export function useRefinanceMyLoan() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const refinance = (loanIndex: number, newTermChoice: 0 | 1 | 2) => {
    const contractAddress = getContractAddr();
    if (!contractAddress) return;
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "refinanceMyLoan",
      args: [BigInt(loanIndex), newTermChoice],
      chainId: CHAIN_ID,
    });
  };

  return { refinance, hash, isPending, isConfirming, isSuccess, error };
}

// Admin hooks
export function useSetProcessingFee() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setFee = (feeUsdc: bigint) => {
    const contractAddress = getContractAddr();
    if (!contractAddress) return;
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "setProcessingFee",
      args: [feeUsdc],
      chainId: CHAIN_ID,
    });
  };

  return { setFee, hash, isPending, isConfirming, isSuccess, error };
}

export function useSetNgnRate() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setRate = (ngnPerUsd: bigint) => {
    const contractAddress = getContractAddr();
    if (!contractAddress) return;
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "setNgnRate",
      args: [ngnPerUsd],
      chainId: CHAIN_ID,
    });
  };

  return { setRate, hash, isPending, isConfirming, isSuccess, error };
}

export function useSetTermInterestRate() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setTermInterest = (termChoice: 0 | 1 | 2, bps: bigint) => {
    const contractAddress = getContractAddr();
    if (!contractAddress) return;
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "setTermInterestRateBps",
      args: [termChoice, bps],
      chainId: CHAIN_ID,
    });
  };

  return { setTermInterest, hash, isPending, isConfirming, isSuccess, error };
}
