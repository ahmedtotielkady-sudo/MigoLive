const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "public");
const files = [
  "index.html",
  "api-config.js",
  "slot-777.html",
  "slot-ocean-storm.html",
  "wheel-animals.html"
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const relative of files) {
  const source = path.join(root, relative);
  if (fs.existsSync(source) && fs.statSync(source).isFile()) {
    fs.copyFileSync(source, path.join(output, relative));
  }
}

function copyPublicGameFiles(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyPublicGameFiles(source, target);
    } else if (/\.(?:html|js|css|png|jpe?g|webp|svg|woff2?)$/i.test(entry.name)) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }
}

copyPublicGameFiles(path.join(root, "games"), path.join(output, "games"));

if (!fs.existsSync(path.join(output, "index.html"))) {
  throw new Error("index.html was not copied to the Cloudflare public directory");
}

console.log("Cloudflare assets prepared in ./public");
