# OwlPay HTTP API

The development base URL is `http://localhost:4000`. JSON request bodies are
limited to 1 MB. Every response includes `x-request-id` and `x-response-time`.

## Authentication

- **Public** endpoints accept no credentials. Bounty reads optionally use a
  Supabase access token to reveal the caller's own draft and private fields.
- **User** endpoints require `Authorization: Bearer <supabase-access-token>`.
- Bounty creation and repository listing additionally require the signed-in
  user's short-lived GitHub provider token in `X-GitHub-Token`.
- The verification callback requires `X-Agent-Key`; the scheduled resolver
  requires `Authorization: Bearer <CRON_SECRET>`.

Wallet-sensitive mutations also verify that the submitted address was linked
to the authenticated account through the challenge/signature endpoints.

## Endpoints

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Public | Process health and runtime mode |
| GET | `/api/network` | Public | Chain, token, contract and review-price configuration |
| GET | `/api/me` | User | Authenticated user and linked-wallet status |
| GET | `/api/github/repositories` | User + GitHub token | Repositories the user can manage |
| POST | `/api/wallet/challenge` | User | Create a wallet-linking message (`address`) |
| POST | `/api/wallet/verify` | User | Verify one challenge (`challengeId`, `signature`) |
| GET | `/api/bounties` | Public/optional user | List published bounties and the caller's drafts |
| POST | `/api/bounties` | User + GitHub token + wallet | Create a draft bounty |
| GET | `/api/bounties/:id` | Public/optional user | Read one visible bounty |
| POST | `/api/bounties/:id/funded` | Owner | Record `onchainId` and `fundingTxHash` |
| POST | `/api/bounties/:id/refunded` | Owner | Record an eligible escrow refund |
| POST | `/api/bounties/:id/applications` | User + wallet | Apply with `message` and `developerAddress` |
| GET | `/api/bounties/:id/applications` | Owner | List applications to one bounty |
| POST | `/api/bounties/:id/applications/:applicationId/assign` | Owner | Accept one application |
| GET | `/api/applications/me` | User | List the caller's applications |
| GET | `/api/applications/slots` | User | Read the caller's pending-application quota (maximum 5) |
| POST | `/api/applications/:applicationId/withdraw` | User | Withdraw a pending application |
| POST | `/api/bounties/:id/submissions/prepare` | Assigned user + wallet | Validate a PR and obtain its submission hash |
| POST | `/api/bounties/:id/submissions` | Assigned user + wallet | Persist the validated PR submission |
| GET | `/api/bounties/:id/submission-report-evidence` | Owner | Read commit-pinned report evidence |
| POST | `/api/bounties/:id/review-payment` | Owner | Create a GOAT Flow order; returns HTTP 402 |
| POST | `/api/bounties/:id/review-payment/confirm` | Owner | Verify and consume an order payment |
| POST | `/api/bounties/:id/review/run` | Owner | Run a purchased Owl Agent review |
| POST | `/api/bounties/:id/verification` | Agent key | Submit a validated verification result |
| POST | `/api/bounties/:id/approve` | Owner | Approve work and release escrow |
| POST | `/api/bounties/:id/request-revision` | Owner | Request a bounded revision (`message`) |
| POST | `/api/bounties/:id/resolution-appeal` | Assigned user | Appeal a pending timeout resolution |
| GET | `/api/cron/resolve-due` | Cron secret | Resolve elapsed contributor/review/appeal windows |

The canonical field constraints live in
[`src/domain/schemas.ts`](src/domain/schemas.ts). Addresses are 20-byte EVM
hex strings, transaction hashes are 32-byte hex strings, repository and pull
request URLs must be HTTPS GitHub URLs, and all mutation bodies are parsed with
strict size and length limits.

## Errors

Domain and validation failures use a stable JSON envelope:

```json
{
  "code": "PAYMENT_ALREADY_USED",
  "message": "This transaction has already purchased a review",
  "requestId": "request-id"
}
```

Validation errors return HTTP 400. Authentication and authorization failures
return 401 or 403; conflicts return 409; missing resources return 404. In
production, unexpected errors return a generic HTTP 500 response while the
detailed error is written only to server logs.
