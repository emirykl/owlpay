# OwlPay MVP security boundary

The contract and API are testnet software, not an audited production escrow.

## Contract controls

- one immutable allow-listed ERC-20 prevents arbitrary-token callbacks and accounting ambiguity
- immutable treasury and fee; fee is capped at 5% and deployed at 3%
- checks-effects-interactions plus OpenZeppelin `SafeERC20` and `ReentrancyGuard`
- settlement actions require a dedicated `SETTLEMENT_ROLE`; pause requires admin
- submission hashes cannot be reused; only the assigned wallet can submit
- only unassigned bounties can be cancelled; expired non-final bounties return the gross reward
- the API limits each account to five pending applications; accepted assignments and completed bounty history are intentionally uncapped
- review purchases are outside escrow, so no agent or merchant can withdraw bounty funds
- historical review transaction and order IDs use indexed replay lookups; unique
  database constraints remain the final guard for each active payment record

## Concurrency and data integrity

- lifecycle writes are compare-and-set: a transition is stored only while the
  bounty still holds the status its checks ran against, so an approval, a refund
  and a scheduled resolution can never overwrite one another
- the review purchase writes only the columns it owns. That flow spans several
  gateway round trips, and writing the whole row back would undo a submission or
  an assignment that landed while it was waiting
- a billable agent review claims the bounty before the model call, so concurrent
  requests cannot each spend the one purchased review

## Accepted risks

Deliberate for a testnet MVP. Each names what would make it unacceptable.

- **Admin role concentration.** One key holds `DEFAULT_ADMIN_ROLE`,
  `SETTLEMENT_ROLE` and the treasury address, and it signs routine settlements
  from the backend environment. Losing it means the escrow can be paused
  indefinitely and the roles re-granted, though funds still only ever move to a
  bounty owner or its assigned developer. *Fix before: mainnet, a second
  maintainer, or escrow worth more than it costs to redeploy.* The treasury is
  immutable, so separating it needs a fresh deployment — do both at once.
- **Rate limits are per instance.** Serverless instances keep their own
  counters, so the published limit is a ceiling per instance rather than per
  caller. The cost this protects — the billable review — is additionally held by
  a database-level claim that does not depend on instance count. *Fix before:
  real traffic, or any limit that has to hold globally.*
- **`style-src 'unsafe-inline'`.** The UI sets style attributes directly and a
  nonce cannot cover those. Script injection is already closed by the nonce on
  `script-src`. *Fix before: mainnet, or move those styles into classes.*
- **Daily resolution cadence.** The scheduled resolver runs once a day on the
  hosting plan's free tier, so a refund can land up to 24 hours late. *Fix
  before: users who notice. A scheduled workflow can call the endpoint more
  often at no cost.*
- **Submission hashes are globally unique.** Someone holding an assignment can
  burn a hash another contributor intends to use. Per-bounty uniqueness would be
  worse: it would let one pull request collect from several bounties. The hash
  includes the commit SHA, so the blocked contributor moves past it with one
  more commit.

## Operational controls required before mainnet

- independent contract audit; property tests cover escrow accounting and
  settle-once behaviour locally but are not a substitute for one
- multisig admin and treasury; isolated settlement signer with rotation and monitoring
- deployment bytecode and constructor verification on the explorer
- rate limits, durable job queue, webhook signature validation, and replay/idempotency monitoring
- sandboxed ephemeral runners before executing any untrusted repository command
- incident pause/runbook and tested signer-compromise recovery
- chain-confirmation depth monitoring before treating testnet transfers as final
