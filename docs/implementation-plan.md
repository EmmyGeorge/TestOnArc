Clean rule. Let me define it precisely.

**The condition:**

At any point — whether at refinance attempt or when the grace period starts — the contract checks:

```
collateralUsdc × ngnPerUsd >= ngnDebt  →  refinance allowed
collateralUsdc × ngnPerUsd <= ngnDebt  →  refinance blocked, liquidation on term end
```

In plain terms: if the USDC collateral left is worth the same or less than the NGN debt in Naira terms, the loan is effectively underwater. There is nothing left to deduct as interest for a new term, and the position is insolvent — so refinancing is blocked and the contract moves straight to liquidation when the term ends.

**How this plays out in the contract:**

- `refinanceLoan` adds a check: if `collateralUsdc × ngnPerUsd <= ngnDebt`, revert with a clear error — "Collateral insufficient to refinance"
- The `getLoanPosition` read function returns a `refinanceEligible` boolean so the frontend can show or hide the refinance button before the borrower even tries
- Liquidation logic is unchanged — it already triggers after the grace deadline, whether the borrower tried to refinance or not
- When the term expires and refinancing is blocked, the grace period still opens (14 days) but **only the "Repay NGN" option is shown** — the refinance button is hidden

**One edge case to note:** The NGN/USD rate is owner-controlled and can change. If the rate drops (NGN weakens against USD), a previously healthy collateral position could fall below the threshold. The dashboard should always show the live collateral-to-debt ratio so the borrower can see when they are approaching this boundary and top up if needed.

**What changes in the plan:**

- `NairaLock.sol` — `refinanceLoan` reverts if `collateralUsdc × ngnPerUsd <= ngnDebt`; `getLoanPosition` returns `refinanceEligible`
- `LoanDashboard.tsx` — shows a collateral health indicator (e.g. "Collateral covers X% of debt"); warning state when approaching the threshold
- `GraceActions.tsx` — hides the "Refinance" button and shows a clear message ("Collateral too low to refinance — repayment required") when `refinanceEligible` is false

This is a small, well-scoped addition and the build agent has the full context. Switch to **Build mode** when you are ready and all of this will be included.
