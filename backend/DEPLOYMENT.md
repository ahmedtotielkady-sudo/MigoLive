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
  - `CORS_ORIGINS`: `https://migolive.pages.dev`
  - `NODE_ENV`: `production`
- Health check path: `/api/health`

## Cloudflare Pages
Set this Pages project environment variable for Production (and Preview only if needed):
- `MIGOLIVE_API_ORIGIN`: the public Railway HTTPS origin, for example `https://your-service.up.railway.app` (origin only; no trailing slash and no `/api` suffix).

The Pages Function at `/api/*` forwards requests to Railway on the same origin, so the web app calls `/api/auth/*` and `/api/wallet/*`.

## Implemented API routes
- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token required)
- `GET /api/wallet` (Bearer token required)
- `GET /api/wallet/transactions` (Bearer token required)
- `POST /api/wallet/transfer` (Bearer token and Idempotency-Key required)

Wallet transfers use a MongoDB transaction and an atomic balance check. MongoDB Atlas supports transactions on replica-set clusters.

## Important rollout notes
- Existing local-only accounts are not automatically migrated to server accounts.
- Do not grant owner/admin roles through public registration.
- Gift, game, rooms, messaging, moderation, and admin actions still need dedicated server APIs before those features can be considered multi-user or production-ready.
- Never expose database credentials or JWT secrets in frontend code or Git.
