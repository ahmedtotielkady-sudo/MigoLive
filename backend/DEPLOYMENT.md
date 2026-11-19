# MigoLive backend — deployment and seven-game integration

## Current working branch
`work/migolive-server-seven-games-mainline-2026-11-18`

The backend is restored on a branch based on the current `main`. Review PR #27 before merging. This branch is not deployed to production.

## Railway service
- Repository: `ahmedtotielkady-sudo/MigoLive`
- Root directory: `/backend`
- Start command: `npm start`
- Health check: `/api/health`
- Required private variables:
  - `MONGODB_URI`: MongoDB Atlas connection string for the `migolive` database. Atlas must support transactions (replica set).
  - `JWT_SECRET`: unique random secret, at least 32 characters.
  - `CORS_ORIGINS`: exact browser origins, comma-separated.
  - `NODE_ENV=production`
- Optional private voice variables: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and TURN credentials as documented in the room voice setup.
- Never commit real credentials or put secrets in the Android app or browser files.

## Core API
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `GET /api/wallet` (Bearer token)
- `GET /api/wallet/transactions` (Bearer token)
- `POST /api/wallet/transfer` (Bearer token + Idempotency-Key)

## Seven game catalog entries
All seven games are registered and visible in `GET /api/games/catalog`. Each has a server-side engine and authenticated settlement endpoint. Every game uses the same `User.coins` balance, Wallet mirror, WalletTransaction ledger, and GameRound records.

| Game | Server endpoint | Current state |
|---|---|---|
| Slot 777 | `POST /api/games/slot-777/spin` | Server API ready; client wiring pending |
| Ocean Storm | `POST /api/games/ocean-storm/spin` | Server API ready; client wiring pending |
| Animal Wheel | `POST /api/games/wheel-animals/spin` | Server API ready; client wiring pending |
| Cleopatra Gold | `POST /api/games/cleopatra-gold/spin` | Server API ready; client wiring pending |
| Fruit Luck | `POST /api/games/fruit-luck/spin` | Server API ready; client wiring pending |
| Rocket Crash | start/state/cashout endpoints below | Server API ready; client wiring pending |
| Big Warrior | `POST /api/games/big-warrior/play` | Server API ready; client wiring pending |

The catalog keeps all seven visible but `active:false` until the current game pages call these APIs and database integration tests pass. Do not activate or deploy them yet.

All game actions require a Bearer token and a unique `Idempotency-Key`. The server decides outcomes and payouts; never accept client-supplied results, multipliers, balances, or payout amounts.

### Animal Wheel and Fruit Luck request formats
- Animal Wheel: `POST /api/games/wheel-animals/spin`, body `{ "bets": [500,0,0,0,0,0,0,0] }`. The array has eight bet positions matching the original animal wheel; chip increments are 500 coins.
- Fruit Luck: `POST /api/games/fruit-luck/spin`, body `{ "bets": { "m": 100, "77": 0, "o": 100 } }`. Bet increments are 10 coins.
- Both requests require `Authorization: Bearer <token>` and `Idempotency-Key: <stable-unique-key>`. A retry must reuse the same key and identical bet payload.

### Rocket Crash
- `POST /api/games/rocket-crash/start` with body `{ "bet": 100 }`
- `GET /api/games/rocket-crash/:roundId/state`
- `POST /api/games/rocket-crash/:roundId/cashout` with an Idempotency-Key header

The server enforces the original 5-second pre-launch delay and 0.13 exponential growth rate. The server crash point is capped at 100x for safe, bounded settlement. Cashout after the crash is rejected.

## Local validation
From the `backend` directory:
```sh
npm install
npm test
```
GitHub Actions currently runs the backend unit suite successfully (41 tests). Unit tests do not replace MongoDB transaction/integration tests.

## Required before production activation
1. Connect the current app login/session to the authenticated API and persist the returned token securely.
2. Replace local/client-side betting and payout in all seven game pages with the matching server endpoints. The pages must display wallet balances returned by the API only; they must never send a new balance to the parent app.
3. Test all seven settlement flows against a dedicated MongoDB Atlas test database, including retries with the same idempotency key, insufficient funds, concurrent requests, crash/cashout races, and wallet ledger consistency.
4. Confirm that `User.coins` and the Wallet mirror remain equal after registration, recharge, transfers, game bets and rewards.
5. Validate every payout table against the original game rules before activating the catalog.
6. Only then merge and deploy to Railway after review and explicit approval.

Existing local-only accounts are not automatically migrated. No production balances are changed by this branch.

## Legacy profile migration (new, partial)

- `GET /api/migration/status` returns migration records for the authenticated account.
- `POST /api/migration/legacy` accepts an idempotency identifier and an allowlisted profile object containing only `displayName` and/or an HTTPS `avatar` URL.
- The API authenticates the current server account, stores a unique migration record per account + migration ID, and updates the profile in a MongoDB transaction.
- The app bridge attempts this only when it finds a legacy local profile with the same numeric UID as the authenticated server account.
- Client-supplied coins, wallet values, roles, IDs, passwords, password hashes, status, sessions and transactions are ignored. The server wallet remains authoritative.
- The frontend removes the locally cached password hash from server-backed user records. The bearer token and a migration retry identifier remain client-side for the current web session implementation.
- This is not a full local-data migration. It does not import local-only accounts, rooms, members, private messages, gifts, agencies or game history. Those require verified ownership/account mapping and separate migration paths.
- Do not delete or clear local records based on this partial migration response. Keep a backup until all required data classes are migrated and independently verified.

