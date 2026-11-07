const fs = require("fs");
const path = require("path");
const vm = require("vm");

const htmlPath = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
let checked = 0;

function checkInlineScripts(source, label) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(source))) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    const code = match[2].trim();
    if (!code) continue;
    new vm.Script(code, { filename: label + ":inline-" + (++checked) });
  }
}

checkInlineScripts(html, "index.html");

const gameRe = /\b(slot|wheel|slot777)\s*:\s*"([A-Za-z0-9+/=]+)"/g;
let game;
let games = 0;
while ((game = gameRe.exec(html))) {
  const gameHtml = Buffer.from(game[2], "base64").toString("utf8");
  checkInlineScripts(gameHtml, "game-" + game[1]);
  games++;
}

if (games !== 3) throw new Error("Expected 3 embedded games; found " + games);
console.log("HTML syntax check passed: " + checked + " inline scripts, " + games + " embedded games.");
