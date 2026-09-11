// test/lines.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { pickCanned, truncate } = require("../statusline.js");

const soul = { work: ["W0", "W1"], ambient: ["A0", "A1", "A2"] };

test("pickCanned uses work bucket when repo is dirty", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 3, contextPct: 0 }, 0), "W0");
});
test("pickCanned uses work bucket when context is high", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 80 }, 30_000), "W1");
});
test("pickCanned uses ambient when nothing notable, rotating by clock", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 10 }, 0), "A0");
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 10 }, 30_000), "A1");
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 10 }, 90_000), "A0");
});
test("pickCanned falls back to work when ambient is empty, null when both are", () => {
  assert.strictEqual(pickCanned({ work: ["W0"], ambient: [] }, { hasRepo: false, dirty: 0, contextPct: 0 }, 0), "W0");
  assert.strictEqual(pickCanned({ work: [], ambient: [] }, { hasRepo: false, dirty: 0, contextPct: 0 }, 0), null);
});
test("truncate respects width and adds ellipsis", () => {
  assert.strictEqual(truncate("hello world", 8), "hello w…");
  assert.strictEqual(truncate("short", 80), "short");
});
