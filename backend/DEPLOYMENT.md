# MigoLive API deployment checklist

## Railway service
- Repository: `ahmedtotielkady-sudo/MigoLive`
- Branch: `feature/mongodb-primary-integration`
- Root directory: `/backend`
- Build command: leave empty (Railway installs dependencies from backend/package.json)
- Start command: `npm start`
- Required variables:
  - `MONGODB_URI`: MongoDB Atlas URI for the existing `migolive` database. Keep the password private.
  - `JWT_SECRET`: generate a unique random secret with at least 32 characters.
  - `CORS_ORIGINS`: include every actual browser origin, comma-separated. For the current Railway frontend and Cloudflare Pages, use `https://migolive-production.up.railway.app,https://migolive.pages.dev` (add any custom domain actually used). The Android app's native requests may omit Origin, but web builds must match exactly.
  - `NODE_ENV`: `production`
- Health check path: `/api/health`

## Cloudflare Pages
Set this Pages project environment variable for Production (and Preview only if needed):
- `MIGOLIVE_API_ORIGIN`: the public Railway HTTPS origin, for example `https://your-service.up.railway.app` (origin only; no trailing slash and no `/api` suffix).

The Pages Function at `/api/*` forwards requests to Railway on the same origin. The current `index.html` integration also uses `https://migolive-api-production.up.railway.app/api` directly, so its browser origin must be included in `CORS_ORIGINS`. If switching the frontend to the Pages proxy later, change `API_BASE` to `/api` in the same deployment.

## Implemented API routes
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token required)
- `GET /api/wallet` (Bearer token required)
- `GET /api/wallet/transactions` (Bearer token required)
- `POST /api/wallet/transfer` (Bearer token and Idempotency-Key required)

Wallet transfers use a MongoDB transaction and an atomic balance check. MongoDB Atlas supports transactions on replica-set clusters.


- `GET /api/rooms`: list open rooms for the authenticated user.
- `POST /api/rooms`: create a room; body supports `name`, optional `description`, `isPrivate`, `password`, and `capacity`.
- `POST /api/rooms/:roomCode/join`: join an open room; private rooms require `password`.
- `POST /api/rooms/:roomCode/leave`: leave a room; the owner closing it closes the room.
- `GET /api/users/:uid`: authenticated public profile lookup by numeric user ID.
- `GET /api/messages/:uid`: load a direct conversation with a user numeric ID; supports `limit` and `before`.
- `POST /api/messages/:uid`: send a direct message; body `{ "text": "..." }`.

- `GET /api/users/:uid`: authenticated public user lookup by numeric account ID.

The wallet screen and direct-message search/send/history now call the server APIs when the user is signed in. Other existing local-only features must not be treated as synchronized.

## Important rollout notes
- Existing local-only accounts are not automatically migrated to server accounts.
- Do not grant owner/admin roles through public registration.
- Room create/join/leave and direct-message lookup/history/send are connected in the current web integration branch. Realtime room presence and voice signaling are implemented but still require multi-device and network testing. Room text-chat fan-out, authoritative gift catalog/pricing alignment with the client, game settlement, recharge approval, agency commissions, and secure admin actions still need server-side implementation before those features can be considered production-ready.
- Never expose database credentials or JWT secrets in frontend code or Git.
