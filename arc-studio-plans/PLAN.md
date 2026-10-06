# NairaLock — USDC Collateral Lending App (with Paystack, Interest & Refinancing)

## Summary
A dApp where you lock USDC as collateral onchain and borrow the equivalent NGN value. The borrower picks a loan term (3 months, 6 months, or 1 year). Every 14 days they must either pay current interest to stay current (refinance) or repay the full principal to close the loan. If a 14-day payment deadline is missed, or the full loan term expires, the USDC equivalent of the NGN debt is deducted from the collateral and any remainder is returned. Interest rate is set by the company and applies to all refinancing payments at the rate current at the time of that payment.

## Architecture

- **Blockchain:** Arc Testnet — USDC is the native gas token; no ETH needed
- **Contract:** `NairaLock.sol` — collateral vault with loan term selection, rolling 14-day payment deadlines, variable interest rate (current rate applies at each refinance), and liquidation
- **Backend:** Express server with Paystack webhook handler, cron job for automatic liquidation of missed deadlines and expired terms, owner wallet for onchain calls
- **Frontend:** React + Tailwind, wagmi + ConnectKit; Paystack inline popup for repayments and interest payments
- **Wallet:** ConnectKit (default)

## Loan Lifecycle

```
Open loan (depositAndBorrow) → pick term: 3mo / 6mo / 1yr
        │
        ▼
  termExpiry = now + term duration
  paymentDeadline = now + 14 days
        │
  Every 14-day cycle:
  ┌─────┴───────────────────────────┐
  │ Before paymentDeadline           │ paymentDeadline missed
  ▼                                  ▼
Pay current interest only         Backend cron calls liquidate()
via Paystack → refinanceLoan()    → USDC equivalent of ngnDebt
→ paymentDeadline resets +14 days   deducted at current NGN/USD rate
→ principal rolls over            → remaining collateral returned to borrower
        │
  OR repay principal in full
  via Paystack → markRepaid()
  → all collateral returned
        │
  At termExpiry (regardless of 14-day cycle):
  → Full repayment required
  → If missed → liquidate()
```

## Key Contract Functions

| Function | Caller | Purpose |
|---|---|---|
| `depositAndBorrow(uint256 usdcAmount, uint256 ngnRequested, uint8 termChoice)` | Borrower | Locks USDC, records NGN debt, sets term expiry (0=3mo, 1=6mo, 2=1yr) and first 14-day payment deadline |
| `setNgnRate(uint256 ngnPerUsd)` | Owner | Updates NGN/USD exchange rate |
| `setInterestRateBps(uint256 bps)` | Owner | Updates global interest rate in basis points — applies to all future refinance payments |
| `refinanceLoan(address borrower)` | Owner (via backend) | Interest payment confirmed at current rate — resets paymentDeadline +14 days, principal rolls over |
| `markRepaid(address borrower)` | Owner (via backend) | Full principal repayment confirmed — releases all collateral |
| `liquidate(address borrower)` | Owner (via backend cron) | Payment deadline OR term expiry missed — deducts USDC equivalent of ngnDebt, returns remainder |
| `withdraw()` | Borrower | Pulls released/remaining USDC after repayment or liquidation |
| `getLoanPosition(address)` | Anyone | Returns collateral, NGN debt, term expiry, payment deadline, current interest rate, loan status |

## Loan Position Storage (per borrower)

```
struct Loan {
  uint256 collateralUsdc;    // USDC locked (6 decimals)
  uint256 ngnDebt;           // NGN principal owed
  uint256 termExpiry;        // Unix timestamp — loan must be fully repaid by this date
  uint256 paymentDeadline;   // Unix timestamp — next interest payment due (resets +14 days on refinance)
  bool    repaid;            // True after full principal repayment
  bool    liquidated;        // True after liquidation
}
// Note: no interest rate snapshot — refinance always uses current global interestRateBps
```

## Interest & Payment Amounts

- **Interest per refinance cycle** = `ngnDebt × currentInterestRateBps / 10000` (rate is whatever the company has set at payment time)
- **Full repayment via Paystack** = `ngnDebt + one cycle's interest at current rate` (NGN)
- **Refinance via Paystack** = `interest only at current rate` (NGN)
- **Liquidation deduction** = `ngnDebt / ngnPerUsd` in USDC (at current NGN/USD rate)

## Files to Create/Modify

1. `contracts/NairaLock.sol` — collateral vault: term selection, rolling 14-day payment deadlines, current-rate refinancing, liquidation
2. `server/index.ts` — Express server: `/create-payment` route, `/webhook/paystack` route, hourly liquidation cron
3. `server/paystack.ts` — payment link creation for full repayment and interest-only; stores borrower address + payment type in metadata; webhook signature verification
4. `server/onchain.ts` — viem wallet client: `markRepaid`, `refinanceLoan`, `liquidate` using owner private key
5. `server/cron.ts` — hourly job: scans active loans, calls `liquidate` on any where `paymentDeadline` or `termExpiry` has passed
6. `src/components/DepositBorrow.tsx` — approve USDC, deposit, set NGN amount, pick loan term (3mo/6mo/1yr); shows current interest rate and projected per-cycle cost
7. `src/components/LoanDashboard.tsx` — shows USDC locked, NGN debt, loan term, term expiry, next payment deadline countdown, current interest due this cycle, and loan status
8. `src/components/RepayOptions.tsx` — "Pay Interest & Refinance" and "Repay in Full" Paystack buttons; shows exact NGN amounts at current rate; polls for onchain status update after payment
9. `src/components/AdminPanel.tsx` — owner-only panel (shown when connected wallet = contract owner): set NGN/USD rate, set interest rate in bps
10. `src/components/RateDisplay.tsx` — current NGN/USD rate, current interest rate (bps + percentage), and max NGN borrowable per USDC
11. `src/App.tsx` — wallet connection, tab layout, all components wired

## Environment Variables Needed

- `PAYSTACK_SECRET_KEY` — Paystack secret key (use test key for development)
- `OWNER_PRIVATE_KEY` — private key of the deployer wallet (backend uses this for `markRepaid`, `refinanceLoan`, `liquidate`)
- `VITE_PAYSTACK_PUBLIC_KEY` — Paystack public key for frontend inline popup

## Build Sequence

1. Write and deploy `NairaLock.sol` — term selection (3mo/6mo/1yr), rolling 14-day deadlines, current-rate refinancing, liquidation; balanced security review before deploy
2. Build `server/onchain.ts` — viem wallet client for Arc Testnet; `markRepaid`, `refinanceLoan`, `liquidate`
3. Build `server/paystack.ts` — payment links for full repayment and interest-only; borrower address + payment type in Paystack metadata; webhook verification
4. Build `server/cron.ts` — hourly scan; calls `liquidate` for any loan where `paymentDeadline` or `termExpiry` < now
5. Build `server/index.ts` — `/create-payment` (type: `repay | refinance`), `/webhook/paystack` routing to `markRepaid` or `refinanceLoan` by metadata type
6. Build `RateDisplay.tsx` — reads current NGN/USD rate and interest rate bps from contract
7. Build `DepositBorrow.tsx` — USDC approval + `depositAndBorrow` with term selector; shows interest cost per cycle
8. Build `LoanDashboard.tsx` — full loan status: term, expiry, next deadline countdown, interest due this cycle
9. Build `RepayOptions.tsx` — "Pay Interest & Refinance" and "Repay in Full" flows with live NGN amounts at current rate
10. Build `AdminPanel.tsx` — owner-only rate controls
11. Wire everything in `src/App.tsx`

## Done When

- [ ] Contract deployed to Arc Testnet and address saved
- [ ] Owner can set NGN/USD rate and interest rate (bps) from the admin panel
- [ ] Borrower picks term (3mo/6mo/1yr), approves USDC, opens loan — term expiry and first payment deadline recorded onchain
- [ ] Dashboard shows full loan details: NGN debt, term expiry, next 14-day payment deadline countdown, interest due at current rate
- [ ] "Pay Interest & Refinance": Paystack payment confirmed → `refinanceLoan` called → deadline resets +14 days, current rate applied
- [ ] "Repay in Full": Paystack payment confirmed → `markRepaid` called → all collateral returned
- [ ] Backend cron auto-liquidates any loan where payment deadline or term expiry is missed
- [ ] Liquidation deducts USDC equivalent of NGN debt at current rate; remaining collateral returned to borrower
- [ ] Borrower calls `withdraw()` to retrieve released/remaining USDC
- [ ] Rate changes by owner apply immediately to all future refinance payments (no per-loan rate snapshot)
