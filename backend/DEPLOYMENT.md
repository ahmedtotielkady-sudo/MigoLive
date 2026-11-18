# MigoLive backend — deployment and game integration

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
All seven games are registered in `GET /api/games/catalog` and use the central `User.coins` balance, Wallet mirror, WalletTransaction ledger, and GameRound records.

| Game | Server endpoint | Catalog status |
|---|---|---|
| Slot 777 | `POST /api/games/slot-777/spin` | Active in catalog |
| Ocean Storm | `POST /api/games/ocean-storm/spin` | Active in catalog |
| Animal Wheel | `POST /api/games/wheel-animals/spin` | Disabled pending frontend wiring and DB integration tests |
| Cleopatra Gold | `POST /api/games/cleopatra-gold/spin` | Active in catalog |
| Fruit Luck | `POST /api/games/fruit-luck/spin` | Disabled pending frontend wiring and DB integration tests |
| Rocket Crash | start/state/cashout endpoints below | Disabled pending frontend wiring and DB integration tests |
| Big Warrior | `POST /api/games/big-warrior/play` | Active in catalog |

Every game action requires a Bearer token and a unique `Idempotency-Key`. The server decides outcomes and payouts; never accept client-supplied results, multipliers, balances, or payout amounts.

### Rocket Crash
- `POST /api/games/rocket-crash/start`
- `GET /api/games/rocket-crash/:roundId/state`
- `POST /api/games/rocket-crash/:roundId/cashout`

The crash point and elapsed multiplier are server-authoritative. Cashout after the crash is rejected.

## Local validation
From the `backend` directory:
```sh
npm install
npm test
```
GitHub Actions runs the same unit-test suite for this branch and pull requests. Unit tests do not replace MongoDB transaction/integration tests.

## Required before production activation
1. Wire the current seven game pages and the app login/session to the authenticated API. The three pages Animal Wheel, Fruit Luck and Rocket Crash currently contain local/client-side game behavior and must be changed to request server outcomes.
2. Test all game settlement flows against a dedicated MongoDB Atlas test database, including retries with the same idempotency key, insufficient funds, concurrent requests, and wallet ledger consistency.
3. Confirm that `User.coins` and the Wallet mirror remain equal after registration, recharge, transfers, game bets and rewards.
4. Validate game payout tables against the original game rules before activating the three pending catalog entries.
5. Only then merge and deploy to Railway after review and explicit approval.

Existing local-only accounts are not automatically migrated. No production balances are changed by this branch.