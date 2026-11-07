# MigoLive backend API and security notes

## Runtime configuration

Required environment variables:

- `MONGODB_URI`: MongoDB connection string. Wallet operations, account migration and owner claiming use MongoDB transactions, so deployment must use a replica set (MongoDB Atlas is supported).
- `JWT_SECRET`: random secret of at least 32 characters.
- `OWNER_BOOTSTRAP_CODE`: one-time owner activation secret, at least 32 characters. Store it only in the hosting provider's server-side environment/secrets. Never put it in index.html, JavaScript, Git, or the Android APK.
- `PORT`: optional; defaults to 3000.
- `CORS_ORIGINS`: comma-separated exact browser origins for the deployed web client. Native clients that omit the Origin header are accepted; Capacitor localhost origins are included by default.

Do not commit real credentials or put JWT/owner bootstrap secrets in the Android/web client.

## Authentication

- `POST /api/auth/register`: creates a new username/password account and zero-balance wallet in one transaction.
- `POST /api/auth/login`: returns a short-lived JWT for a canonical username account.
- `POST /api/auth/legacy-login`: securely migrates/authenticates an account from the old localStorage client using its legacy numeric ID, password and optional phone. The server hashes the password with bcrypt and creates the canonical wallet. Client-supplied balances, roles and account privileges are ignored. The first-time legacy migration starts with the documented 100-coin signup grant; existing local balances are not trusted or imported.
- `GET /api/auth/me`: returns the authenticated user's public account fields.

Legacy IDs must be 5-10 digits. Legacy passwords must be 6-128 characters to preserve compatibility with existing accounts; new canonical registrations require 10-128 characters. Canonical usernames must be 3-24 letters, numbers or underscores.

## Owner bootstrap

- `POST /api/auth/claim-owner`: requires a valid user JWT and the one-time `OWNER_BOOTSTRAP_CODE` in the request body. The server compares the code in constant time and records a single immutable primary-owner claim in MongoDB. Rate limited to five attempts per 15 minutes.
- Only the first successful claim can establish the primary owner. A second account cannot claim ownership. The bootstrap secret is not shipped to clients.

## Wallet

- `GET /api/wallet`: returns the authenticated user's balance and latest 50 ledger entries.
- `POST /api/wallet/gift`: transfers virtual coins to another active username. Requires `recipientUsername`, positive integer `amount`, and an `Idempotency-Key` header. Sender debit, recipient credit and both ledger records commit in one MongoDB transaction.
- The public API intentionally has no endpoint that lets a client credit its own coins.

## Top-ups and owner adjustments


- `POST /api/wallet/topups`: creates a pending request with a positive integer `amount` and optional payment reference. It does not credit the wallet.
- `GET /api/admin/topups/pending`: lists pending requests for manual verification.
- `POST /api/admin/topups/:reference/approve` or `/reject`: records the reviewer and review note. Approval credits the wallet and posts the ledger row in the same MongoDB transaction; rejection does not credit coins.
- `POST /api/admin/wallet/adjust`: primary-owner-only manual credit/debit. Requires `userId`, positive integer `amount`, `direction`, a non-empty `reason`, and an `Idempotency-Key`. Every adjustment is written to the ledger.

## Games

- `GET /api/games`: lists the configured game IDs.
- `POST /api/games/:gameId/debit`: debits a positive integer stake from the authenticated user's shared wallet. An `Idempotency-Key` header (8-128 safe characters) is required.

Configured IDs: `ocean_storm`, `slot777`, `animal_wheel`.

**Important:** The debit endpoint only debits a stake. It does not accept a client-reported win, payout, random result or multiplier. The uploaded game source currently calculates outcomes and payouts in the browser and sends a `set` message to the parent app. Those messages must not be trusted. Server-authoritative round engines must reproduce each game's actual rules and approved paytables before winnings can be credited or the games can safely use the central wallet. No odds or payout rates are assumed by this API.

## Administrator reports

All routes below require a currently active database account with role `admin` or `owner`. Roles are loaded from MongoDB for every authenticated request.

- `GET /api/admin/overview`: user count, total wallet coins, posted transaction totals, per-game debit/credit totals and recent transactions.
- `GET /api/admin/users?page=1&limit=50`: paginated user directory with current role, status and wallet balance.
- `GET /api/admin/transactions?page=1&limit=50`: paginated posted ledger records. Optional filters: `from`, `to`, `type`, `game`.
- `GET /api/admin/users/:userId/activity`: public user identity, wallet balance and latest 100 ledger entries.

These endpoints are read-only and do not expose password hashes or authentication tokens.

## Deployment checks still required

1. Set MongoDB URI, JWT secret, owner bootstrap code and production web origin in the hosting environment.
2. Confirm the database is a replica set and transactions are enabled.
3. Run registration, legacy migration, login, owner-claim race, wallet debit, insufficient-balance and repeated-idempotency tests against a staging database.
4. Implement and test server-authoritative settlement from the actual game source before enabling winnings.
5. Integrate the HTML client with these API routes and test Android/web end-to-end.
