// test/cache.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promptHash, isNewPrompt, readCache, writeCache } = require("../statusline.js");

const tmp = (n) => path.join(os.tmpdir(), `soulcache-${process.pid}-${n}`);

test("promptHash is stable and differs by input", () => {
  assert.strictEqual(promptHash("a"), promptHash("a"));
  assert.notStrictEqual(promptHash("a"), promptHash("b"));
});
test("isNewPrompt true when hash differs or no cache", () => {
  assert.strictEqual(isNewPrompt("hi", null), true);
  assert.strictEqual(isNewPrompt("hi", { promptHash: promptHash("hi") }), false);
  assert.strictEqual(isNewPrompt("hi", { promptHash: promptHash("bye") }), true);
});
test("isNewPrompt false for empty prompt", () => {
  assert.strictEqual(isNewPrompt(null, null), false);
});
test("write then read round-trips", () => {
  const p = tmp("rt.json");
  writeCache(p, { comment: "x", ts: 5, promptHash: "h", generating: 0 });
  assert.deepStrictEqual(readCache(p), { comment: "x", ts: 5, promptHash: "h", generating: 0 });
  fs.unlinkSync(p);
});
test("readCache missing → null", () => {
  assert.strictEqual(readCache(tmp("nope.json")), null);
});
