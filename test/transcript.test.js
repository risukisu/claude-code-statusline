// test/transcript.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { latestUserPrompt } = require("../statusline.js");

const FIX = path.join(__dirname, "fixtures/sample-transcript.jsonl");

test("returns the last user message (array content)", () => {
  assert.strictEqual(latestUserPrompt(FIX), "second prompt please");
});
test("missing file → null, never throws", () => {
  assert.strictEqual(latestUserPrompt(path.join(__dirname, "nope.jsonl")), null);
});
