const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SAMPLE = fs.readFileSync(path.join(ROOT, "examples/sample-input.json"), "utf8");

function run(stdin) {
  return execFileSync("node", ["statusline.js"], { cwd: ROOT, input: stdin, encoding: "utf8", timeout: 5000 });
}

test("renders the session line with the model name", () => {
  const out = run(SAMPLE);
  // Strip ANSI escape sequences before asserting so colour codes don't break character-level regexes.
  const plain = out.replace(/\x1B\[[0-9;]*m/g, "");
  assert.match(plain, /Claude Opus 4\.8/);  // model.display_name from the sample
  assert.match(plain, /█{2,}/);             // the context bar glyphs (61% sample → many filled blocks)
});

test("emits at least three lines for the sample", () => {
  const out = run(SAMPLE).replace(/\n$/, "");
  assert.ok(out.split("\n").length >= 4, "expected >=4 lines");
});
