Good changes. Let me think through the implications carefully before building.

**Change 1 — LTV 60%:**
Simple — change `LTV_BPS` from `5000` to `6000`. Max NGN borrow becomes 60% of collateral value instead of 50%.

**Change 2 — Multiple loans per address:**
This is a bigger structural change. Currently the contract uses `mapping(address => Loan)` — one loan per address. To support multiple loans, this needs to become `mapping(address => Loan[])` with a loan ID system.

Here is how it works with the 60% LTV multi-loan model:

**Collateral is shared across all loans.** The total USDC deposited across all open loans for one address must collectively satisfy 60% LTV. So:

- Borrower deposits 100 USDC on Loan 1, borrows ₦96,000 (60% of 100 USDC at ₦1,600)
- To open Loan 2, they must deposit fresh USDC — they can't reuse the collateral already locked in Loan 1
- Each loan is independent: its own collateral, its own term, its own grace period, its own debt

This is actually simpler and safer than shared collateral — each loan stands alone. The borrower just opens a new loan with a new USDC deposit.

**What changes in the contract:**
- `mapping(address => Loan) public loans` → `mapping(address => Loan[]) public loans`
- All functions that take `address borrower` now also take `uint256 loanIndex`
- `depositAndBorrow` pushes a new loan into the array (no "already active" block)
- `topUpCollateral(loanIndex)`, `refinanceMyLoan(loanIndex)`, `refinanceLoan(borrower, loanIndex, newTermChoice)`, `markRepaid(borrower, loanIndex)`, `liquidate(borrower, loanIndex)` all updated
- `getLoanPosition(borrower, loanIndex)` and `getLoanCount(borrower)` added
- Cron and frontend updated to handle multiple loans per address

**Frontend:**
- Loan Dashboard shows all active loans in a scrollable list, each with its own health bar, countdown, and action buttons
- Each loan card has its own Repay / Refinance / Top Up controls

Shall I go ahead and build this?
