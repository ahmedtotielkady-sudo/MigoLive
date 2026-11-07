# MigoLive backend API and security notes

## Runtime configuration

Required environment variables:

- `MONGODB_URI`: MongoDB connection string. Wallet operations and account registration use MongoDB transactions, so the deployment must use a replica set (MongoDB Atlas is supported).
- `JWT_SECRET`: a random secret of at least 32 characters.
- `PORT`: optional; defaults to 3000.
- `CORS_ORIGINS`: comma-separated exact browser origins for the deployed web client. Native clients that omit the Origin header are accepted; Capacitor localhost origins are included by default.

Do not commit real credentials or put the JWT secret in the Android/web client.

## Authentication

- `POST /api/auth/register`: creates the user and zero-balance wallet in one transaction.
- `POST /api/auth/login`: returns a short-lived JWT.
- `GET /api/auth/me`: returns the authenticated user's public account fields.

Passwords must be 10-128 characters. Usernames must be 3-24 letters, numbers or underscores.

## Wallet

- `GET /api/wallet`: returns the authenticated user's balance and latest 50 ledger entries.
- `POST /api/wallet/gift`: transfers virtual coins to another active username. Requires `recipientUsername`, positive integer `amount`, and an `Idempotency-Key` header. Sender debit, recipient credit and both ledger records commit in one MongoDB transaction. Self-gifts and insufficient balances are rejected.
- The public API intentionally has no endpoint that lets a client credit its own coins.

## Games

- `GET /api/games`: lists the configured game IDs.
- `POST /api/games/:gameId/debit`: debits a positive integer stake from the authenticated user's shared wallet. An `Idempotency-Key` header (8-128 safe characters) is required; reuse that same key only when retrying the same bet request.

Configured IDs: `ocean_storm`, `slot777`, `animal_wheel`.

**Important:** This endpoint only debits a stake. It does not accept a client-reported win, payout, random result or multiplier. A game settlement engine must calculate and verify each round on the server using the approved game rules before any credit endpoint is introduced. No odds or payout rates are assumed by this API.

## Administrator reports

All routes below require a currently active database account with role `admin` or `owner`. Roles are loaded from MongoDB for every authenticated request.

- `GET /api/admin/overview`: user count, total wallet coins, posted transaction totals, per-game debit/credit totals and recent transactions.
- `GET /api/admin/transactions?page=1&limit=50`: paginated posted ledger records. Optional filters: `from`, `to` (ISO dates), `type`, `game`.
- `GET /api/admin/users/:userId/activity`: public user identity, wallet balance and latest 100 ledger entries.

These endpoints are read-only. They do not expose password hashes or authentication tokens and do not permit arbitrary balance changes. The backend root (`/`) serves the repository `index.html` app.

## Deployment checks still required

1. Set the real MongoDB URI, JWT secret and production web origin in the hosting environment.
2. Confirm the database is a replica set and transactions are enabled.
3. Run registration, login, wallet debit, insufficient-balance and repeated-idempotency tests against a staging database.
4. Implement and test server-authoritative round settlement from the actual game source and approved paytables before enabling winnings.
5. Build and test the Android/web client against these API routes.
