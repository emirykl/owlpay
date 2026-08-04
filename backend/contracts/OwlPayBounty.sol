// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract OwlPayBounty is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");

    enum Status {
        None,
        Open,
        Submitted,
        RevisionRequired,
        HumanReview,
        Approved,
        Paid,
        Refunded,
        Cancelled
    }

    struct Bounty {
        address owner;
        address developer;
        IERC20 paymentToken;
        uint128 rewardAmount;
        uint128 verificationBudget;
        uint128 verificationSpent;
        uint64 deadline;
        bytes32 taskHash;
        bytes32 submissionHash;
        bytes32 verificationHash;
        Status status;
    }

    uint256 public nextBountyId = 1;
    mapping(uint256 bountyId => Bounty bounty) private _bounties;
    mapping(bytes32 submissionHash => bool used) public usedSubmissionHashes;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        address indexed paymentToken,
        uint256 rewardAmount,
        uint256 verificationBudget,
        uint256 deadline,
        bytes32 taskHash
    );
    event WorkSubmitted(uint256 indexed bountyId, address indexed developer, bytes32 indexed submissionHash);
    event VerificationSpendRecorded(uint256 indexed bountyId, bytes32 indexed paymentReference, uint256 amount);
    event RevisionRequested(uint256 indexed bountyId, bytes32 indexed verificationHash);
    event HumanReviewRequested(uint256 indexed bountyId, bytes32 indexed verificationHash);
    event SubmissionApproved(uint256 indexed bountyId, bytes32 indexed verificationHash);
    event PaymentReleased(uint256 indexed bountyId, address indexed developer, uint256 amount);
    event BountyRefunded(uint256 indexed bountyId, address indexed owner, uint256 amount);
    event BountyCancelled(uint256 indexed bountyId);

    error InvalidAmount();
    error InvalidDeadline();
    error InvalidAddress();
    error InvalidState(Status current);
    error NotBountyOwner();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error SubmissionAlreadyUsed();
    error VerificationBudgetExceeded();

    constructor(address admin, address settlementAgent) {
        if (admin == address(0) || settlementAgent == address(0)) revert InvalidAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLEMENT_ROLE, settlementAgent);
    }

    function createBounty(
        address paymentToken,
        uint128 rewardAmount,
        uint128 verificationBudget,
        uint64 deadline,
        bytes32 taskHash
    ) external whenNotPaused nonReentrant returns (uint256 bountyId) {
        if (paymentToken == address(0)) revert InvalidAddress();
        if (rewardAmount == 0) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (taskHash == bytes32(0)) revert InvalidAmount();

        bountyId = nextBountyId++;
        _bounties[bountyId] = Bounty({
            owner: msg.sender,
            developer: address(0),
            paymentToken: IERC20(paymentToken),
            rewardAmount: rewardAmount,
            verificationBudget: verificationBudget,
            verificationSpent: 0,
            deadline: deadline,
            taskHash: taskHash,
            submissionHash: bytes32(0),
            verificationHash: bytes32(0),
            status: Status.Open
        });

        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), rewardAmount);
        emit BountyCreated(bountyId, msg.sender, paymentToken, rewardAmount, verificationBudget, deadline, taskHash);
    }

    function submitWork(uint256 bountyId, bytes32 submissionHash) external whenNotPaused {
        Bounty storage bounty = _requireBounty(bountyId);
        if (bounty.status != Status.Open && bounty.status != Status.RevisionRequired) revert InvalidState(bounty.status);
        if (block.timestamp > bounty.deadline) revert DeadlinePassed();
        if (submissionHash == bytes32(0)) revert InvalidAmount();
        if (usedSubmissionHashes[submissionHash]) revert SubmissionAlreadyUsed();

        if (bounty.developer == address(0)) {
            bounty.developer = msg.sender;
        } else if (bounty.developer != msg.sender) {
            revert InvalidAddress();
        }

        usedSubmissionHashes[submissionHash] = true;
        bounty.submissionHash = submissionHash;
        bounty.verificationHash = bytes32(0);
        bounty.status = Status.Submitted;
        emit WorkSubmitted(bountyId, msg.sender, submissionHash);
    }

    /// @notice Records an off-chain GOAT Flow/x402 verification payment for audit and cap enforcement.
    /// The settlement wallet pays the verifier; this contract never grants arbitrary token transfers.
    function recordVerificationSpend(uint256 bountyId, uint128 amount, bytes32 paymentReference)
        external
        onlyRole(SETTLEMENT_ROLE)
    {
        Bounty storage bounty = _requireBounty(bountyId);
        if (bounty.status != Status.Submitted) revert InvalidState(bounty.status);
        if (paymentReference == bytes32(0) || amount == 0) revert InvalidAmount();
        uint256 newSpent = uint256(bounty.verificationSpent) + amount;
        if (newSpent > bounty.verificationBudget) revert VerificationBudgetExceeded();
        bounty.verificationSpent = uint128(newSpent);
        emit VerificationSpendRecorded(bountyId, paymentReference, amount);
    }

    function requestRevision(uint256 bountyId, bytes32 verificationHash) external onlyRole(SETTLEMENT_ROLE) {
        Bounty storage bounty = _requireSubmitted(bountyId);
        bounty.verificationHash = verificationHash;
        bounty.status = Status.RevisionRequired;
        emit RevisionRequested(bountyId, verificationHash);
    }

    function requestHumanReview(uint256 bountyId, bytes32 verificationHash) external onlyRole(SETTLEMENT_ROLE) {
        Bounty storage bounty = _requireSubmitted(bountyId);
        bounty.verificationHash = verificationHash;
        bounty.status = Status.HumanReview;
        emit HumanReviewRequested(bountyId, verificationHash);
    }

    function approveSubmission(uint256 bountyId, bytes32 verificationHash) external onlyRole(SETTLEMENT_ROLE) {
        Bounty storage bounty = _requireSubmitted(bountyId);
        if (verificationHash == bytes32(0)) revert InvalidAmount();
        bounty.verificationHash = verificationHash;
        bounty.status = Status.Approved;
        emit SubmissionApproved(bountyId, verificationHash);
    }

    function releasePayment(uint256 bountyId) external onlyRole(SETTLEMENT_ROLE) whenNotPaused nonReentrant {
        Bounty storage bounty = _requireBounty(bountyId);
        if (bounty.status != Status.Approved) revert InvalidState(bounty.status);
        address developer = bounty.developer;
        uint256 reward = bounty.rewardAmount;
        bounty.status = Status.Paid;
        bounty.paymentToken.safeTransfer(developer, reward);
        emit PaymentReleased(bountyId, developer, reward);
    }

    function refundExpiredBounty(uint256 bountyId) external whenNotPaused nonReentrant {
        Bounty storage bounty = _requireBounty(bountyId);
        if (msg.sender != bounty.owner) revert NotBountyOwner();
        if (block.timestamp <= bounty.deadline) revert DeadlineNotPassed();
        if (
            bounty.status == Status.Approved || bounty.status == Status.Paid || bounty.status == Status.Refunded
                || bounty.status == Status.Cancelled
        ) revert InvalidState(bounty.status);
        bounty.status = Status.Refunded;
        bounty.paymentToken.safeTransfer(bounty.owner, bounty.rewardAmount);
        emit BountyRefunded(bountyId, bounty.owner, bounty.rewardAmount);
    }

    function cancelUnassignedBounty(uint256 bountyId) external whenNotPaused nonReentrant {
        Bounty storage bounty = _requireBounty(bountyId);
        if (msg.sender != bounty.owner) revert NotBountyOwner();
        if (bounty.status != Status.Open || bounty.developer != address(0)) revert InvalidState(bounty.status);
        bounty.status = Status.Cancelled;
        bounty.paymentToken.safeTransfer(bounty.owner, bounty.rewardAmount);
        emit BountyCancelled(bountyId);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return _requireBounty(bountyId);
    }

    function _requireBounty(uint256 bountyId) private view returns (Bounty storage bounty) {
        bounty = _bounties[bountyId];
        if (bounty.status == Status.None) revert InvalidState(Status.None);
    }

    function _requireSubmitted(uint256 bountyId) private view returns (Bounty storage bounty) {
        bounty = _requireBounty(bountyId);
        if (bounty.status != Status.Submitted) revert InvalidState(bounty.status);
    }
}

