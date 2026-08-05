// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice GOAT Testnet3 bounty escrow. Review purchases are paid separately through x402.
contract OwlPayBounty is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_PLATFORM_FEE_BPS = 500;

    enum Status {
        None,
        Open,
        Assigned,
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
        uint128 rewardAmount;
        uint64 deadline;
        bytes32 taskHash;
        bytes32 submissionHash;
        bytes32 verificationHash;
        Status status;
    }

    IERC20 public immutable paymentToken;
    address public immutable treasury;
    uint16 public immutable platformFeeBps;
    uint256 public nextBountyId = 1;

    mapping(uint256 bountyId => Bounty bounty) private _bounties;
    mapping(bytes32 submissionHash => bool used) public usedSubmissionHashes;

    event BountyCreated(
        uint256 indexed bountyId,
        address indexed owner,
        address indexed paymentToken,
        uint256 rewardAmount,
        uint256 deadline,
        bytes32 taskHash
    );
    event DeveloperAssigned(uint256 indexed bountyId, address indexed developer);
    event WorkSubmitted(uint256 indexed bountyId, address indexed developer, bytes32 indexed submissionHash);
    event RevisionRequested(uint256 indexed bountyId, bytes32 indexed verificationHash);
    event HumanReviewRequested(uint256 indexed bountyId, bytes32 indexed verificationHash);
    event SubmissionApproved(uint256 indexed bountyId, bytes32 indexed verificationHash);
    event PaymentReleased(
        uint256 indexed bountyId,
        address indexed developer,
        uint256 grossReward,
        uint256 platformFee,
        uint256 developerPayout
    );
    event BountyRefunded(uint256 indexed bountyId, address indexed owner, uint256 amount);
    event BountyCancelled(uint256 indexed bountyId, address indexed owner, uint256 amount);

    error InvalidAmount();
    error InvalidDeadline();
    error InvalidAddress();
    error InvalidFee();
    error InvalidState(Status current);
    error NotBountyOwner();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error SubmissionAlreadyUsed();

    constructor(
        address admin,
        address settlementAgent,
        address paymentTokenAddress,
        address treasuryAddress,
        uint16 feeBps
    ) {
        if (
            admin == address(0) || settlementAgent == address(0) || paymentTokenAddress == address(0)
                || treasuryAddress == address(0)
        ) revert InvalidAddress();
        if (feeBps > MAX_PLATFORM_FEE_BPS) revert InvalidFee();

        paymentToken = IERC20(paymentTokenAddress);
        treasury = treasuryAddress;
        platformFeeBps = feeBps;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SETTLEMENT_ROLE, settlementAgent);
    }

    function createBounty(uint128 rewardAmount, uint64 deadline, bytes32 taskHash)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 bountyId)
    {
        if (rewardAmount == 0 || taskHash == bytes32(0)) revert InvalidAmount();
        if (deadline <= block.timestamp) revert InvalidDeadline();

        bountyId = nextBountyId++;
        _bounties[bountyId] = Bounty({
            owner: msg.sender,
            developer: address(0),
            rewardAmount: rewardAmount,
            deadline: deadline,
            taskHash: taskHash,
            submissionHash: bytes32(0),
            verificationHash: bytes32(0),
            status: Status.Open
        });

        paymentToken.safeTransferFrom(msg.sender, address(this), rewardAmount);
        emit BountyCreated(bountyId, msg.sender, address(paymentToken), rewardAmount, deadline, taskHash);
    }

    function assignDeveloper(uint256 bountyId, address developer) external whenNotPaused {
        Bounty storage bounty = _requireBounty(bountyId);
        if (msg.sender != bounty.owner) revert NotBountyOwner();
        if (bounty.status != Status.Open) revert InvalidState(bounty.status);
        if (developer == address(0)) revert InvalidAddress();
        bounty.developer = developer;
        bounty.status = Status.Assigned;
        emit DeveloperAssigned(bountyId, developer);
    }

    function submitWork(uint256 bountyId, bytes32 submissionHash) external whenNotPaused {
        Bounty storage bounty = _requireBounty(bountyId);
        if (bounty.status != Status.Assigned && bounty.status != Status.RevisionRequired) revert InvalidState(bounty.status);
        if (block.timestamp > bounty.deadline) revert DeadlinePassed();
        if (submissionHash == bytes32(0)) revert InvalidAmount();
        if (usedSubmissionHashes[submissionHash]) revert SubmissionAlreadyUsed();
        if (bounty.developer != msg.sender) revert InvalidAddress();

        usedSubmissionHashes[submissionHash] = true;
        bounty.submissionHash = submissionHash;
        bounty.verificationHash = bytes32(0);
        bounty.status = Status.Submitted;
        emit WorkSubmitted(bountyId, msg.sender, submissionHash);
    }

    function requestRevision(uint256 bountyId, bytes32 verificationHash) external onlyRole(SETTLEMENT_ROLE) {
        Bounty storage bounty = _requireSubmitted(bountyId);
        if (verificationHash == bytes32(0)) revert InvalidAmount();
        bounty.verificationHash = verificationHash;
        bounty.status = Status.RevisionRequired;
        emit RevisionRequested(bountyId, verificationHash);
    }

    function requestHumanReview(uint256 bountyId, bytes32 verificationHash) external onlyRole(SETTLEMENT_ROLE) {
        Bounty storage bounty = _requireSubmitted(bountyId);
        if (verificationHash == bytes32(0)) revert InvalidAmount();
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

        uint256 grossReward = bounty.rewardAmount;
        uint256 platformFee = grossReward * platformFeeBps / BPS_DENOMINATOR;
        uint256 developerPayout = grossReward - platformFee;
        address developer = bounty.developer;
        bounty.status = Status.Paid;

        if (platformFee != 0) paymentToken.safeTransfer(treasury, platformFee);
        paymentToken.safeTransfer(developer, developerPayout);
        emit PaymentReleased(bountyId, developer, grossReward, platformFee, developerPayout);
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
        paymentToken.safeTransfer(bounty.owner, bounty.rewardAmount);
        emit BountyRefunded(bountyId, bounty.owner, bounty.rewardAmount);
    }

    function cancelUnassignedBounty(uint256 bountyId) external whenNotPaused nonReentrant {
        Bounty storage bounty = _requireBounty(bountyId);
        if (msg.sender != bounty.owner) revert NotBountyOwner();
        if (bounty.status != Status.Open || bounty.developer != address(0)) revert InvalidState(bounty.status);
        bounty.status = Status.Cancelled;
        paymentToken.safeTransfer(bounty.owner, bounty.rewardAmount);
        emit BountyCancelled(bountyId, bounty.owner, bounty.rewardAmount);
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

    function previewPayout(uint256 grossReward) external view returns (uint256 platformFee, uint256 developerPayout) {
        platformFee = grossReward * platformFeeBps / BPS_DENOMINATOR;
        developerPayout = grossReward - platformFee;
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
