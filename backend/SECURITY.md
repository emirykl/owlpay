# OwlPay MVP security boundary

The contract and API are testnet software, not an audited production escrow.

## Contract controls

- one immutable allow-listed ERC-20 prevents arbitrary-token callbacks and accounting ambiguity
- immutable treasury and fee; fee is capped at 5% and deployed at 3%
- checks-effects-interactions plus OpenZeppelin `SafeERC20` and `ReentrancyGuard`
- settlement actions require a dedicated `SETTLEMENT_ROLE`; pause requires admin
- submission hashes cannot be reused; only the assigned wallet can submit
- only unassigned bounties can be cancelled; expired non-final bounties return the gross reward
- review purchases are outside escrow, so no agent or merchant can withdraw bounty funds

## Operational controls required before mainnet

- independent contract audit and invariant/fuzz testing
- multisig admin and treasury; isolated settlement signer with rotation and monitoring
- deployment bytecode and constructor verification on the explorer
- rate limits, durable job queue, webhook signature validation, and replay/idempotency monitoring
- sandboxed ephemeral runners before executing any untrusted repository command
- incident pause/runbook and tested signer-compromise recovery
