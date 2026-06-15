// test/lines.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { pickAmbient, pickCanned, truncate } = require("../statusline.js");

const soul = { work: ["W0", "W1"], ambient: ["A0", "A1", "A2"], react: "" };

test("pickAmbient rotates deterministically by clock", () => {
  assert.strictEqual(pickAmbient(soul, 0), "A0");
  assert.strictEqual(pickAmbient(soul, 30_000), "A1");
  assert.strictEqual(pickAmbient(soul, 90_000), "A0");
});
test("pickCanned uses work bucket when repo is dirty", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 3, contextPct: 0 }, 0), "W0");
});
test("pickCanned uses work bucket when context is high", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 80 }, 30_000), "W1");
});
test("pickCanned uses ambient when nothing notable", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 10 }, 0), "A0");
});
test("truncate respects width and adds ellipsis", () => {
  assert.strictEqual(truncate("hello world", 8), "hello w…");
  assert.strictEqual(truncate("short", 80), "short");
});
