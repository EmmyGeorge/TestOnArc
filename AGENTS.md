# NairaLock

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

NairaLock is a USDC-collateralized NGN lending dApp on Arc Testnet. Users deposit USDC as collateral; upfront interest is deducted immediately and sent to the treasury; the remaining USDC is locked; and the equivalent NGN (at 50% LTV) is disbursed offchain. Loan terms: 3 months, 6 months, or 1 year. After the term, a 14-day grace period opens where the borrower can repay NGN (via Paystack) or refinance onchain. If no action is taken, liquidation deducts the USDC equivalent of the NGN debt and returns any surplus.

## Deployed Contracts

| Contract | Network | Address | Explorer |
|---|---|---|---|
| NairaLock v1 (deprecated) | Arc Testnet | `0xe57acda2052f1cb2ec2a292d85936ab02a9c1dd7` | [View](https://explorer.testnet.arc.io/address/0xe57acda2052f1cb2ec2a292d85936ab02a9c1dd7) |
| NairaLock v2 (current) | Arc Testnet | `0xb946ca8fbb355b74755019597d0c973f6b1a9f66` | [View](https://explorer.testnet.arc.io/address/0xb946ca8fbb355b74755019597d0c973f6b1a9f66) |

## Environment Variables

- `VITE_NAIRA_LOCK_ADDRESS=0xe57acda2052f1cb2ec2a292d85936ab02a9c1dd7`
- `PAYSTACK_SECRET_KEY=sk_test_...` (from Paystack dashboard)
- `VITE_PAYSTACK_PUBLIC_KEY=pk_test_...`
- `OWNER_PRIVATE_KEY=0x...` (deployer wallet — controls markRepaid, liquidate, setNgnRate)

## Contract Key Parameters (at deployment)

- NGN/USDC rate: 1600 (₦1,600 per 1 USDC)
- Interest rate: 1000 bps (10% per term)
- LTV: 50%
- Treasury: 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42 (update via setTreasury)
- Owner: 0x5B12Ce46C7194aD57d143bC22847224047b1Ef42

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
