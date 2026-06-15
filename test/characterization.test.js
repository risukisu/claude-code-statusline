// test/characterization.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SAMPLE = fs.readFileSync(path.join(ROOT, "examples/sample-input.json"), "utf8");

function run(stdin) {
  return execFileSync("node", ["statusline.js"], { cwd: ROOT, input: stdin, encoding: "utf8" });
}

test("renders the session line with the model name", () => {
  const out = run(SAMPLE);
  assert.match(out, /Claude/);            // model.display_name from the sample
  assert.match(out, /█|░/);               // the context bar glyphs
});

test("emits at least three lines for the sample", () => {
  const out = run(SAMPLE).replace(/\n$/, "");
  assert.ok(out.split("\n").length >= 3, "expected >=3 lines");
});
