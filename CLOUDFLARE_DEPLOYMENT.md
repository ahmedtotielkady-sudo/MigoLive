# Cloudflare Workers deployment

This repository is deployed as a Cloudflare Worker using `wrangler.jsonc` and `worker.mjs`.

Cloudflare build settings:

- Production branch: `codex/wallet-security-audit`
- Build command: `npm run build:cloudflare`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

Required runtime secrets must be configured in the Worker settings, not committed to this repository: `MONGODB_URI`, `JWT_SECRET`, and `OWNER_BOOTSTRAP_CODE`. Optional runtime values include `CORS_ORIGINS` and `PAYMENT_WALLET_NUMBER`.

The build script copies the public application assets into `public/`; the Worker serves the Express API and static assets from the same `workers.dev` origin.
