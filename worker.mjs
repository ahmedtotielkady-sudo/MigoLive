import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Cloudflare secrets are injected at runtime. Populate process.env before
// loading the existing CommonJS Express application so its configuration
// is read from the Worker environment, never from the browser bundle.
for (const key of [
  "MONGODB_URI",
  "JWT_SECRET",
  "OWNER_BOOTSTRAP_CODE",
  "CORS_ORIGINS",
  "PAYMENT_WALLET_NUMBER"
]) {
  if (typeof env[key] === "string" && env[key].length > 0) {
    process.env[key] = env[key];
  }
}
process.env.CLOUDFLARE_WORKERS = "1";

const app = require("./backend/server.js");
const server = app.listen(3000);

export default httpServerHandler(server);
