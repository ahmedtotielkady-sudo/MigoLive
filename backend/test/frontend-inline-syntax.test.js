const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("all inline JavaScript in the main app page parses", () => {
  const htmlPath = path.resolve(__dirname, "../../index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const inlineScripts = scripts.filter(([, attrs, body]) =>
    !/\bsrc\s*=/.test(attrs) && body.trim()
  );
  assert.ok(inlineScripts.length > 0, "expected at least one inline app script");
  for (let i = 0; i < inlineScripts.length; i++) {
    const [, , source] = inlineScripts[i];
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: "index.html:inline-script-" + (i + 1) }),
      "inline script " + (i + 1) + " should parse"
    );
  }
});
