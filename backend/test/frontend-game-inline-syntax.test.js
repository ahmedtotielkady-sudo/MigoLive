"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("all inline JavaScript in every game page parses", () => {
  const gamesDir = path.resolve(__dirname, "../../games");
  const gameFiles = fs.readdirSync(gamesDir)
    .filter(name => name.toLowerCase().endsWith(".html"))
    .sort();

  assert.ok(gameFiles.length > 0, "expected game HTML files in games/");
  for (const gameFile of gameFiles) {
    const html = fs.readFileSync(path.join(gamesDir, gameFile), "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
    const inlineScripts = scripts.filter(([, attrs, body]) =>
      !/\bsrc\s*=/.test(attrs) && body.trim()
    );

    assert.ok(inlineScripts.length > 0, gameFile + " should contain inline game logic");
    for (let i = 0; i < inlineScripts.length; i++) {
      const [, , source] = inlineScripts[i];
      assert.doesNotThrow(
        () => new vm.Script(source, { filename: gameFile + ":inline-script-" + (i + 1) }),
        gameFile + " inline script " + (i + 1) + " should parse"
      );
    }
  }
});
