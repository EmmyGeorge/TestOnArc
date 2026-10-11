// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract NairaLock is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct Loan {
        uint256 collateralUsdc;
        uint256 ngnDebt;
        uint256 termExpiry;
        uint256 graceDeadline;
        uint256 openedAt;
        uint256 totalFeesPaid;
        bool active;
        bool repaid;
        bool liquidated;
        bool cancelled;
    }

    error NoActiveLoan();
    error ExceedsMaxBorrow(uint256 requested, uint256 maxAllowed);
    error InsufficientCollateralForInterest(uint256 available, uint256 required);
    error RefinanceNotEligible();
    error GracePeriodNotStarted();
    error GracePeriodExpired();
    error LiquidationNotReady();
    error ZeroAmount();
    error ZeroAddress();
    error RateDeviationTooLarge(uint256 current, uint256 proposed);
    error LtvViolated(uint256 requested, uint256 maxAllowed);
    error CancelWindowExpired();
    error NothingToClaim();
    error FeeTooHigh(uint256 proposed, uint256 max);
    error InterestTooHigh(uint256 proposed, uint256 max);
    error RateCooldownActive(uint256 nextAllowed);

    IERC20 public immutable usdc;
    address public treasury;
    uint256 public ngnPerUsd;
    uint256 public processingFeeUsdc = 500_000;
    uint256[3] public termInterestRateBps;
    uint256 public lastRateUpdate;

    mapping(address => Loan[]) public loans;
    mapping(address => uint256) public claimable;

    uint256 public constant LTV_BPS = 6000;
    uint256 public constant GRACE_PERIOD = 14 days;
    uint256 public constant CANCEL_WINDOW = 7 days;
    uint256 public constant MAX_RATE_DEVIATION_BPS = 1000;
    uint256 public constant RATE_COOLDOWN = 1 hours;
    uint256 public constant MAX_FEE_USDC = 10_000_000;
    uint256 public constant MAX_INTEREST_BPS = 5000;

    uint256[3] public TERM_DURATIONS;

    event LoanOpened(
        address indexed borrower,
        uint256 loanIndex,
        uint256 collateralUsdc,
        uint256 ngnDebt,
        uint256 interestPaidUsdc,
        uint256 processingFeePaid,
        uint256 termExpiry
    );
    event LoanRefinanced(
        address indexed borrower, uint256 loanIndex, uint256 interestPaidUsdc, uint256 newTermExpiry, uint8 newTermChoice
    );
    event LoanRepaid(address indexed borrower, uint256 loanIndex, uint256 collateralReturned);
    event LoanLiquidated(address indexed borrower, uint256 loanIndex, uint256 deductedUsdc, uint256 returnedUsdc);
    event LoanCancelled(address indexed borrower, uint256 loanIndex, uint256 collateralReturned, bool feesRefunded);
    event CollateralToppedUp(address indexed borrower, uint256 loanIndex, uint256 addedUsdc);
    event NgnRateUpdated(uint256 newRate);
    event TermInterestRateUpdated(uint8 indexed termChoice, uint256 newBps);
    event TreasuryUpdated(address newTreasury);
    event ProcessingFeeUpdated(uint256 newFee);
    event Claimed(address indexed account, address indexed to, uint256 amount);

    constructor(address _usdc, address _treasury, uint256 _ngnPerUsd, address initialOwner)
        Ownable(initialOwner)
    {
        if (_usdc == address(0) || _treasury == address(0) || initialOwner == address(0)) revert ZeroAddress();
        if (_ngnPerUsd == 0) revert ZeroAmount();

        usdc = IERC20(_usdc);
        treasury = _treasury;
        ngnPerUsd = _ngnPerUsd;

        termInterestRateBps[0] = 1000;
        termInterestRateBps[1] = 1500;
        termInterestRateBps[2] = 2000;

        TERM_DURATIONS[0] = 90 days;
        TERM_DURATIONS[1] = 180 days;
        TERM_DURATIONS[2] = 365 days;
    }

    function depositAndBorrow(uint256 usdcAmount, uint256 ngnRequested, uint8 termChoice)
        external
        whenNotPaused
        nonReentrant
    {
        if (usdcAmount == 0 || ngnRequested == 0) revert ZeroAmount();
        require(termChoice < 3, "Invalid term choice");

        uint256 interestUsdc = (ngnRequested * termInterestRateBps[termChoice] * 1e6) / (ngnPerUsd * 10_000);
        uint256 totalFees = interestUsdc + processingFeeUsdc;
        if (totalFees >= usdcAmount) revert InsufficientCollateralForInterest(usdcAmount, totalFees);

        uint256 collateralLocked = usdcAmount - totalFees;
        uint256 maxNgn = (collateralLocked * ngnPerUsd * LTV_BPS) / (10_000 * 1e6);
        if (ngnRequested > maxNgn) revert ExceedsMaxBorrow(ngnRequested, maxNgn);

        if ((ngnRequested * 10_000 * 1e6) > (collateralLocked * ngnPerUsd * LTV_BPS)) {
            revert LtvViolated(ngnRequested, maxNgn);
        }

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdc.safeTransfer(treasury, totalFees);

        uint256 termExpiry = block.timestamp + TERM_DURATIONS[termChoice];
        uint256 graceDeadline = termExpiry + GRACE_PERIOD;

        Loan memory newLoan = Loan({
            collateralUsdc: collateralLocked,
            ngnDebt: ngnRequested,
            termExpiry: termExpiry,
            graceDeadline: graceDeadline,
            openedAt: block.timestamp,
            totalFeesPaid: totalFees,
            active: true,
            repaid: false,
            liquidated: false,
            cancelled: false
        });

        uint256 loanIndex = loans[msg.sender].length;
        loans[msg.sender].push(newLoan);

        emit LoanOpened(msg.sender, loanIndex, collateralLocked, ngnRequested, interestUsdc, processingFeeUsdc, termExpiry);
    }

    /// @notice Borrower-callable: refinance own loan during grace period.
    function refinanceMyLoan(uint256 loanIndex, uint8 newTermChoice) external nonReentrant {
        _doRefinance(msg.sender, loanIndex, newTermChoice);
    }

    /// @notice Owner helper: refinance any loan (operational fallback).
    function refinanceLoan(address borrower, uint256 loanIndex, uint8 newTermChoice) external onlyOwner nonReentrant {
        _doRefinance(borrower, loanIndex, newTermChoice);
    }

    function _doRefinance(address borrower, uint256 loanIndex, uint8 newTermChoice) internal {
        require(loanIndex < loans[borrower].length, "Invalid loan index");
        Loan storage loan = loans[borrower][loanIndex];
        if (!loan.active) revert NoActiveLoan();
        require(newTermChoice < 3, "Invalid term choice");

        if (block.timestamp < loan.termExpiry) revert GracePeriodNotStarted();
        if (block.timestamp >= loan.graceDeadline) revert GracePeriodExpired();

        if ((loan.collateralUsdc * ngnPerUsd) <= (loan.ngnDebt * 1e6)) revert RefinanceNotEligible();

        // Refinance uses the new term's current rate
        uint256 interestUsdc = (loan.ngnDebt * termInterestRateBps[newTermChoice] * 1e6) / (ngnPerUsd * 10_000);
        if (loan.collateralUsdc <= interestUsdc) {
            revert InsufficientCollateralForInterest(loan.collateralUsdc, interestUsdc);
        }

        loan.collateralUsdc -= interestUsdc;
        _safePayTreasury(interestUsdc);

        uint256 newTermExpiry = block.timestamp + TERM_DURATIONS[newTermChoice];
        loan.termExpiry = newTermExpiry;
        loan.graceDeadline = newTermExpiry + GRACE_PERIOD;

        emit LoanRefinanced(borrower, loanIndex, interestUsdc, newTermExpiry, newTermChoice);
    }

    function markRepaid(address borrower, uint256 loanIndex) external onlyOwner nonReentrant {
        require(loanIndex < loans[borrower].length, "Invalid loan index");
        Loan storage loan = loans[borrower][loanIndex];
        if (!loan.active) revert NoActiveLoan();
        if (block.timestamp >= loan.graceDeadline) revert GracePeriodExpired();

        loan.repaid = true;
        loan.active = false;

        uint256 collateralToReturn = loan.collateralUsdc;
        loan.collateralUsdc = 0;

        _safePay(borrower, collateralToReturn);

        emit LoanRepaid(borrower, loanIndex, collateralToReturn);
    }

    function liquidate(address borrower, uint256 loanIndex) external onlyOwner nonReentrant {
        require(loanIndex < loans[borrower].length, "Invalid loan index");
        Loan storage loan = loans[borrower][loanIndex];
        if (!loan.active) revert NoActiveLoan();
        if (block.timestamp < loan.graceDeadline) revert LiquidationNotReady();

        uint256 deductUsdc = (loan.ngnDebt * 1e6) / ngnPerUsd;
        if (deductUsdc > loan.collateralUsdc) deductUsdc = loan.collateralUsdc;
        uint256 returnUsdc = loan.collateralUsdc - deductUsdc;

        loan.liquidated = true;
        loan.active = false;
        loan.collateralUsdc = 0;

        _safePayTreasury(deductUsdc);
        _safePay(borrower, returnUsdc);

        emit LoanLiquidated(borrower, loanIndex, deductUsdc, returnUsdc);
    }

    function cancelLoan(address borrower, uint256 loanIndex, bool refundFees) external onlyOwner nonReentrant {
        require(loanIndex < loans[borrower].length, "Invalid loan index");
        Loan storage loan = loans[borrower][loanIndex];
        if (!loan.active) revert NoActiveLoan();
        if (block.timestamp > loan.openedAt + CANCEL_WINDOW) revert CancelWindowExpired();

        loan.active = false;
        loan.cancelled = true;

        uint256 collateralToReturn = loan.collateralUsdc;
        loan.collateralUsdc = 0;

        if (refundFees && loan.totalFeesPaid > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), loan.totalFeesPaid);
            collateralToReturn += loan.totalFeesPaid;
        }

        _safePay(borrower, collateralToReturn);

        emit LoanCancelled(borrower, loanIndex, collateralToReturn, refundFees);
    }

    function topUpCollateral(uint256 loanIndex, uint256 additionalUsdc) external nonReentrant {
        require(loanIndex < loans[msg.sender].length, "Invalid loan index");
        Loan storage loan = loans[msg.sender][loanIndex];
        if (!loan.active) revert NoActiveLoan();
        if (additionalUsdc == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), additionalUsdc);
        loan.collateralUsdc += additionalUsdc;

        emit CollateralToppedUp(msg.sender, loanIndex, additionalUsdc);
    }

    function claim(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();

        claimable[msg.sender] = 0;
        usdc.safeTransfer(to, amount);

        emit Claimed(msg.sender, to, amount);
    }

    function setNgnRate(uint256 _ngnPerUsd) external onlyOwner nonReentrant {
        if (_ngnPerUsd == 0) revert ZeroAmount();
        uint256 current = ngnPerUsd;
        if (current > 0) {
            if (lastRateUpdate > 0 && block.timestamp < lastRateUpdate + RATE_COOLDOWN) {
                revert RateCooldownActive(lastRateUpdate + RATE_COOLDOWN);
            }
            uint256 maxAllowed = current + (current * MAX_RATE_DEVIATION_BPS / 10_000);
            uint256 minAllowed = current - (current * MAX_RATE_DEVIATION_BPS / 10_000);
            if (_ngnPerUsd > maxAllowed || _ngnPerUsd < minAllowed) {
                revert RateDeviationTooLarge(current, _ngnPerUsd);
            }
        }

        ngnPerUsd = _ngnPerUsd;
        lastRateUpdate = block.timestamp;

        emit NgnRateUpdated(_ngnPerUsd);
    }

    function setProcessingFee(uint256 _feeUsdc) external onlyOwner {
        if (_feeUsdc > MAX_FEE_USDC) revert FeeTooHigh(_feeUsdc, MAX_FEE_USDC);
        processingFeeUsdc = _feeUsdc;
        emit ProcessingFeeUpdated(_feeUsdc);
    }

    function setTreasury(address _treasury) external onlyOwner nonReentrant {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function getLoanPosition(address borrower, uint256 loanIndex)
        external
        view
        returns (Loan memory loan, uint8 loanState, bool refinanceEligible, uint256 currentInterestDueUsdc)
    {
        require(loanIndex < loans[borrower].length, "Invalid loan index");
        loan = loans[borrower][loanIndex];

        if (loan.cancelled) {
            loanState = 6;
        } else if (loan.liquidated) {
            loanState = 5;
        } else if (loan.repaid) {
            loanState = 4;
        } else if (loan.active) {
            if (block.timestamp < loan.termExpiry) {
                loanState = 1;
            } else if (block.timestamp < loan.graceDeadline) {
                loanState = 2;
            } else {
                loanState = 3;
            }
        } else {
            loanState = 0;
        }

        if (loanState == 2) {
            refinanceEligible = (loan.collateralUsdc * ngnPerUsd) > (loan.ngnDebt * 1e6);
            // currentInterestDueUsdc is per-term — use getRefinanceInterest(borrower, loanIndex, newTermChoice) instead
            currentInterestDueUsdc = 0;
        }
    }

    function getLoanCount(address borrower) external view returns (uint256) {
        return loans[borrower].length;
    }

    function getMaxBorrow(uint256 usdcAmount, uint8 termChoice)
        external
        view
        returns (uint256 maxNgn, uint256 interestUsdc, uint256 collateralAfterInterest, uint256 processingFee)
    {
        require(termChoice < 3, "Invalid term choice");
        processingFee = processingFeeUsdc;
        if (ngnPerUsd == 0 || usdcAmount <= processingFee) return (0, 0, 0, processingFee);

        uint256 rateBps = termInterestRateBps[termChoice];
        uint256 numerator = (usdcAmount - processingFee) * ngnPerUsd * LTV_BPS * 10_000;
        uint256 denominator = (10_000 * 1e6 * 10_000) + (LTV_BPS * rateBps * 1e6);

        maxNgn = numerator / denominator;
        interestUsdc = (maxNgn * rateBps * 1e6) / (ngnPerUsd * 10_000);

        uint256 totalFees = interestUsdc + processingFee;
        collateralAfterInterest = usdcAmount > totalFees ? usdcAmount - totalFees : 0;
    }

    /// @notice Returns all three per-term interest rates (bps).
    function getTermRates() external view returns (uint256 rate0, uint256 rate1, uint256 rate2) {
        rate0 = termInterestRateBps[0];
        rate1 = termInterestRateBps[1];
        rate2 = termInterestRateBps[2];
    }

    /// @notice Returns the USDC interest that would be deducted for refinancing into a given term right now.
    function getRefinanceInterest(address borrower, uint256 loanIndex, uint8 newTermChoice)
        external
        view
        returns (uint256 interestUsdc)
    {
        require(newTermChoice < 3, "Invalid term choice");
        require(loanIndex < loans[borrower].length, "Invalid loan index");
        if (ngnPerUsd == 0) return 0;
        Loan storage loan = loans[borrower][loanIndex];
        if (!loan.active) return 0;
        interestUsdc = (loan.ngnDebt * termInterestRateBps[newTermChoice] * 1e6) / (ngnPerUsd * 10_000);
    }

    function setTermInterestRateBps(uint8 termChoice, uint256 _bps) external onlyOwner nonReentrant {
        require(termChoice < 3, "Invalid term choice");
        if (_bps > MAX_INTEREST_BPS) revert InterestTooHigh(_bps, MAX_INTEREST_BPS);
        termInterestRateBps[termChoice] = _bps;
        emit TermInterestRateUpdated(termChoice, _bps);
    }

    function renounceOwnership() public pure override {
        revert("Renounce disabled");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _safePay(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        try IERC20(address(usdc)).transfer(recipient, amount) returns (bool ok) {
            if (!ok) claimable[recipient] += amount;
        } catch {
            claimable[recipient] += amount;
        }
    }

    function _safePayTreasury(uint256 amount) internal {
        if (amount == 0) return;
        address t = treasury;
        try IERC20(address(usdc)).transfer(t, amount) returns (bool ok) {
            if (!ok) claimable[t] += amount;
        } catch {
            claimable[t] += amount;
        }
    }
}
