# MigoLive
Private


## Cloudflare Workers deployment

Deploy the `codex/wallet-security-audit` branch with the repository's `wrangler.jsonc` configuration. Set the Cloudflare build command to `npm run build:cloudflare` and the deploy command to `npx wrangler deploy`. The build command prepares the static application files in `public/`; runtime secrets (`MONGODB_URI`, `JWT_SECRET`, and `OWNER_BOOTSTRAP_CODE`) must be configured in the Worker settings and must never be committed to Git.
