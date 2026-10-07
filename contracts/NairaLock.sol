// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract NairaLock is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Loan {
        uint256 collateralUsdc;
        uint256 ngnDebt;
        uint256 termExpiry;
        uint256 graceDeadline;
        bool active;
        bool repaid;
        bool liquidated;
    }

    error NoActiveLoan();
    error LoanAlreadyActive();
    error ExceedsMaxBorrow(uint256 requested, uint256 maxAllowed);
    error InsufficientCollateralForInterest(uint256 available, uint256 required);
    error RefinanceNotEligible();
    error GracePeriodNotStarted();
    error GracePeriodExpired();
    error LiquidationNotReady();
    error ZeroAmount();
    error ZeroAddress();
    error RateDeviationTooLarge(uint256 current, uint256 proposed);

    IERC20 public immutable usdc;
    address public treasury;
    uint256 public ngnPerUsd;
    uint256 public interestRateBps;

    uint256 public constant LTV_BPS = 5000;
    uint256 public constant GRACE_PERIOD = 14 days;

    uint256[3] public TERM_DURATIONS;

    mapping(address => Loan) public loans;

    event LoanOpened(
        address indexed borrower,
        uint256 collateralUsdc,
        uint256 ngnDebt,
        uint256 interestPaidUsdc,
        uint256 termExpiry
    );
    event LoanRefinanced(address indexed borrower, uint256 interestPaidUsdc, uint256 newTermExpiry, uint8 newTermChoice);
    event LoanRepaid(address indexed borrower, uint256 collateralReturned);
    event LoanLiquidated(address indexed borrower, uint256 deductedUsdc, uint256 returnedUsdc);
    event CollateralToppedUp(address indexed borrower, uint256 addedUsdc);
    event NgnRateUpdated(uint256 newRate);
    event InterestRateUpdated(uint256 newBps);
    event TreasuryUpdated(address newTreasury);

    constructor(address _usdc, address _treasury, uint256 _ngnPerUsd, uint256 _interestRateBps, address initialOwner)
        Ownable(initialOwner)
    {
        if (_usdc == address(0) || _treasury == address(0) || initialOwner == address(0)) revert ZeroAddress();
        if (_ngnPerUsd == 0) revert ZeroAmount();

        usdc = IERC20(_usdc);
        treasury = _treasury;
        ngnPerUsd = _ngnPerUsd;
        interestRateBps = _interestRateBps;

        TERM_DURATIONS[0] = 90 days;
        TERM_DURATIONS[1] = 180 days;
        TERM_DURATIONS[2] = 365 days;
    }

    function depositAndBorrow(uint256 usdcAmount, uint256 ngnRequested, uint8 termChoice) external nonReentrant {
        Loan storage loan = loans[msg.sender];
        if (loan.active) revert LoanAlreadyActive();
        if (usdcAmount == 0 || ngnRequested == 0) revert ZeroAmount();
        require(termChoice < 3, "Invalid term choice");

        // Max borrowable NGN is 50% of the full deposit value
        uint256 maxNgn = (usdcAmount * ngnPerUsd) / (2 * 1e6);
        if (ngnRequested > maxNgn) revert ExceedsMaxBorrow(ngnRequested, maxNgn);

        // Interest is charged on the borrowed amount (converted to USDC), not the deposit
        uint256 interestUsdc = (ngnRequested * interestRateBps * 1e6) / (ngnPerUsd * 10_000);
        if (interestUsdc >= usdcAmount) revert InsufficientCollateralForInterest(usdcAmount, interestUsdc);

        uint256 collateralLocked = usdcAmount - interestUsdc;

        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        usdc.safeTransfer(treasury, interestUsdc);

        uint256 termExpiry = block.timestamp + TERM_DURATIONS[termChoice];
        uint256 graceDeadline = termExpiry + GRACE_PERIOD;

        loan.collateralUsdc = collateralLocked;
        loan.ngnDebt = ngnRequested;
        loan.termExpiry = termExpiry;
        loan.graceDeadline = graceDeadline;
        loan.active = true;
        loan.repaid = false;
        loan.liquidated = false;

        emit LoanOpened(msg.sender, collateralLocked, ngnRequested, interestUsdc, termExpiry);
    }

    /// @notice Borrower-callable: refinance own loan during grace period.
    function refinanceMyLoan(uint8 newTermChoice) external nonReentrant {
        _doRefinance(msg.sender, newTermChoice);
    }

    /// @notice Owner helper: refinance any loan (operational fallback).
    function refinanceLoan(address borrower, uint8 newTermChoice) external onlyOwner nonReentrant {
        _doRefinance(borrower, newTermChoice);
    }

    function _doRefinance(address borrower, uint8 newTermChoice) internal {
        Loan storage loan = loans[borrower];
        if (!loan.active) revert NoActiveLoan();
        require(newTermChoice < 3, "Invalid term choice");

        if (block.timestamp < loan.termExpiry) revert GracePeriodNotStarted();
        if (block.timestamp >= loan.graceDeadline) revert GracePeriodExpired();

        if ((loan.collateralUsdc * ngnPerUsd) <= (loan.ngnDebt * 1e6)) revert RefinanceNotEligible();

        uint256 interestUsdc = (loan.ngnDebt * interestRateBps * 1e6) / (ngnPerUsd * 10_000);
        if (loan.collateralUsdc <= interestUsdc) {
            revert InsufficientCollateralForInterest(loan.collateralUsdc, interestUsdc);
        }

        loan.collateralUsdc -= interestUsdc;
        usdc.safeTransfer(treasury, interestUsdc);

        uint256 newTermExpiry = block.timestamp + TERM_DURATIONS[newTermChoice];
        loan.termExpiry = newTermExpiry;
        loan.graceDeadline = newTermExpiry + GRACE_PERIOD;

        emit LoanRefinanced(borrower, interestUsdc, newTermExpiry, newTermChoice);
    }

    function markRepaid(address borrower) external onlyOwner nonReentrant {
        Loan storage loan = loans[borrower];
        if (!loan.active) revert NoActiveLoan();

        if (block.timestamp < loan.termExpiry) revert GracePeriodNotStarted();
        if (block.timestamp >= loan.graceDeadline) revert GracePeriodExpired();

        loan.repaid = true;
        loan.active = false;

        uint256 collateralToReturn = loan.collateralUsdc;
        loan.collateralUsdc = 0;

        usdc.safeTransfer(borrower, collateralToReturn);

        emit LoanRepaid(borrower, collateralToReturn);
    }

    function liquidate(address borrower) external onlyOwner nonReentrant {
        Loan storage loan = loans[borrower];
        if (!loan.active) revert NoActiveLoan();
        if (block.timestamp < loan.graceDeadline) revert LiquidationNotReady();

        uint256 deductUsdc = (loan.ngnDebt * 1e6) / ngnPerUsd;
        if (deductUsdc > loan.collateralUsdc) {
            deductUsdc = loan.collateralUsdc;
        }

        uint256 returnUsdc = loan.collateralUsdc - deductUsdc;

        loan.liquidated = true;
        loan.active = false;
        loan.collateralUsdc = 0;

        usdc.safeTransfer(treasury, deductUsdc);
        if (returnUsdc > 0) {
            usdc.safeTransfer(borrower, returnUsdc);
        }

        emit LoanLiquidated(borrower, deductUsdc, returnUsdc);
    }

    function topUpCollateral(uint256 additionalUsdc) external nonReentrant {
        Loan storage loan = loans[msg.sender];
        if (!loan.active) revert NoActiveLoan();
        if (additionalUsdc == 0) revert ZeroAmount();

        usdc.safeTransferFrom(msg.sender, address(this), additionalUsdc);
        loan.collateralUsdc += additionalUsdc;

        emit CollateralToppedUp(msg.sender, additionalUsdc);
    }

    /// @dev Max 20% deviation per update to prevent griefing via rate manipulation.
    uint256 public constant MAX_RATE_DEVIATION_BPS = 2000; // 20%

    function setNgnRate(uint256 _ngnPerUsd) external onlyOwner nonReentrant {
        if (_ngnPerUsd == 0) revert ZeroAmount();
        uint256 current = ngnPerUsd;
        if (current > 0) {
            uint256 maxAllowed = current + (current * MAX_RATE_DEVIATION_BPS / 10_000);
            uint256 minAllowed = current - (current * MAX_RATE_DEVIATION_BPS / 10_000);
            if (_ngnPerUsd > maxAllowed || _ngnPerUsd < minAllowed) {
                revert RateDeviationTooLarge(current, _ngnPerUsd);
            }
        }
        ngnPerUsd = _ngnPerUsd;
        emit NgnRateUpdated(_ngnPerUsd);
    }

    function setInterestRateBps(uint256 _bps) external onlyOwner nonReentrant {
        require(_bps < 10_000, "Interest too high");
        interestRateBps = _bps;
        emit InterestRateUpdated(_bps);
    }

    function setTreasury(address _treasury) external onlyOwner nonReentrant {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function getLoanPosition(address borrower)
        external
        view
        returns (Loan memory loan, uint8 loanState, bool refinanceEligible, uint256 currentInterestDueUsdc)
    {
        loan = loans[borrower];

        if (loan.liquidated) {
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
            if (refinanceEligible) {
                currentInterestDueUsdc = (loan.ngnDebt * interestRateBps * 1e6) / (ngnPerUsd * 10_000);
            }
        }
    }

    function getMaxBorrow(uint256 usdcAmount)
        external
        view
        returns (uint256 maxNgn, uint256 interestUsdc, uint256 collateralAfterInterest)
    {
        // Max NGN = 50% of deposit value
        maxNgn = (usdcAmount * ngnPerUsd) / (2 * 1e6);
        // Interest is on the borrowed amount (maxNgn), converted to USDC
        interestUsdc = (maxNgn * interestRateBps * 1e6) / (ngnPerUsd * 10_000);
        // Collateral locked = full deposit minus interest on the borrowed amount
        collateralAfterInterest = usdcAmount - interestUsdc;
    }
}
