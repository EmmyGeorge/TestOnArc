/**
 * Hooks for reading and writing to the NairaLock contract.
 */
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount } from "wagmi";
import { erc20Abi } from "viem";
import { getUsdc } from "@/onchain-facts";
import { getNairaLockAddress, NAIRA_LOCK_ABI, ARC_TESTNET_CHAIN_ID, type LoanData } from "@/utils/nairalock";

const CHAIN_ID = ARC_TESTNET_CHAIN_ID;

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
  let contractAddress: `0x${string}` | undefined;
  try {
    contractAddress = getNairaLockAddress();
  } catch {
    // not deployed yet
  }

  return useReadContract({
    address: usdc?.address as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && contractAddress ? [address, contractAddress] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address && !!usdc && !!contractAddress },
  });
}

export function useLoanPosition(borrowerAddress?: string) {
  let contractAddress: `0x${string}` | undefined;
  try {
    contractAddress = getNairaLockAddress();
  } catch {
    // not deployed yet
  }

  return useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "getLoanPosition",
    args: borrowerAddress ? [borrowerAddress as `0x${string}`] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!borrowerAddress && !!contractAddress, refetchInterval: 15_000 },
  }) as { data: [LoanData["loan"], LoanData["loanState"], boolean, bigint] | undefined; isLoading: boolean; refetch: () => void };
}

export function useMaxBorrow(usdcAmount: bigint) {
  let contractAddress: `0x${string}` | undefined;
  try {
    contractAddress = getNairaLockAddress();
  } catch {
    // not deployed yet
  }

  return useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "getMaxBorrow",
    args: [usdcAmount],
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress && usdcAmount > 0n },
  }) as { data: [bigint, bigint, bigint] | undefined };
}

export function useContractRates() {
  let contractAddress: `0x${string}` | undefined;
  try {
    contractAddress = getNairaLockAddress();
  } catch {
    // not deployed yet
  }

  const ngnRate = useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "ngnPerUsd",
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress, refetchInterval: 30_000 },
  });

  const interestRate = useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "interestRateBps",
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress, refetchInterval: 30_000 },
  });

  const ownerAddress = useReadContract({
    address: contractAddress,
    abi: NAIRA_LOCK_ABI,
    functionName: "owner",
    chainId: CHAIN_ID,
    query: { enabled: !!contractAddress },
  });

  return { ngnRate, interestRate, ownerAddress };
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
    let contractAddress: `0x${string}`;
    try {
      contractAddress = getNairaLockAddress();
    } catch {
      return;
    }
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

  const topUp = (additionalUsdc: bigint) => {
    let contractAddress: `0x${string}`;
    try {
      contractAddress = getNairaLockAddress();
    } catch {
      return;
    }
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "topUpCollateral",
      args: [additionalUsdc],
      chainId: CHAIN_ID,
    });
  };

  return { topUp, hash, isPending, isConfirming, isSuccess, error };
}

export function useRefinanceMyLoan() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const refinance = (newTermChoice: 0 | 1 | 2) => {
    let contractAddress: `0x${string}`;
    try {
      contractAddress = getNairaLockAddress();
    } catch {
      return;
    }
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "refinanceMyLoan",
      args: [newTermChoice],
      chainId: CHAIN_ID,
    });
  };

  return { refinance, hash, isPending, isConfirming, isSuccess, error };
}

// Admin hooks
export function useSetNgnRate() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setRate = (ngnPerUsd: bigint) => {
    let contractAddress: `0x${string}`;
    try {
      contractAddress = getNairaLockAddress();
    } catch {
      return;
    }
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

export function useSetInterestRate() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const setInterest = (bps: bigint) => {
    let contractAddress: `0x${string}`;
    try {
      contractAddress = getNairaLockAddress();
    } catch {
      return;
    }
    writeContract({
      address: contractAddress,
      abi: NAIRA_LOCK_ABI,
      functionName: "setInterestRateBps",
      args: [bps],
      chainId: CHAIN_ID,
    });
  };

  return { setInterest, hash, isPending, isConfirming, isSuccess, error };
}
