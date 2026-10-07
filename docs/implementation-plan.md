Good idea. Right now there's one global rate applied to all terms. This change makes each term have its own rate. Now I have the full contract. Rewriting it with per-term rates — the key changes are:

- Replace `uint256 public interestRateBps` with `uint256[3] public termInterestRateBps`
- Replace `setInterestRateBps` with `setTermInterestRateBps(uint8 termChoice, uint256 bps)`
- Add `getTermRates()` view for the frontend to read all three rates at once
- Update `depositAndBorrow`, `_doRefinance`, `getLoanPosition`, and `getMaxBorrow` to use `termInterestRateBps[termChoice]`
- Update the `InterestRateUpdated` event to include `termChoice`The session dropped back into Plan mode. Switch to **Build mode** using the mode selector, then come back and say "continue" — all the changes are ready to apply and will take just a few minutes once I'm back in Build mode.

Here is exactly what will change when you switch back:

**Contract (`NairaLock.sol`):**
- `interestRateBps` → replaced by `termInterestRateBps[3]` (one rate per term)
- `setInterestRateBps(uint256)` → replaced by `setTermInterestRateBps(uint8 termChoice, uint256 bps)`
- New `getTermRates()` view returns all three rates at once
- `depositAndBorrow`, `_doRefinance`, `getLoanPosition`, `getMaxBorrow` all updated to use `termInterestRateBps[termChoice]`
- Constructor sets defaults: `[1000, 1500, 2000]` (10% / 15% / 20%)

**Frontend:**
- `DepositBorrow` — interest preview updates based on the selected term's rate, not a single global rate
- `AdminPanel` — three separate rate inputs, one per term, each with its own update button
- `hooks/useNairaLock` — `useContractRates` reads `getTermRates()` instead of `interestRateBps`
- `GraceActions` — refinance interest shown uses the selected new term's rate
