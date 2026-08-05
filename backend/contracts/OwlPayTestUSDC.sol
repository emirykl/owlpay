// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Testnet-only stablecoin used by the OwlPay MVP. It has no real-world value.
contract OwlPayTestUSDC is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1_000 * 10 ** 6;
    uint256 public constant FAUCET_COOLDOWN = 1 days;
    mapping(address account => uint256 lastClaimAt) public lastClaimAt;

    error FaucetCooldown();

    constructor(address initialOwner) ERC20("OwlPay Test USDC", "otUSDC") Ownable(initialOwner) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function claim() external {
        if (lastClaimAt[msg.sender] != 0 && block.timestamp < lastClaimAt[msg.sender] + FAUCET_COOLDOWN) {
            revert FaucetCooldown();
        }
        lastClaimAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address account, uint256 amount) external onlyOwner {
        _mint(account, amount);
    }
}
