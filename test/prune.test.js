// test/prune.test.js
// pruneStaleCaches must sweep BOTH per-session cache families so neither accumulates:
// the react-comment caches (statusline-soul.<key>.cache.json) and the new git-snapshot
// caches (statusline-git.<key>.cache.json). Guarded by a pure name predicate.
const { test } = require("node:test");
const assert = require("node:assert");
const { prunableCacheName } = require("../statusline.js");

test("matches react-comment per-session caches", () => {
  assert.strictEqual(prunableCacheName("statusline-soul.abc123.cache.json"), true);
});
test("matches git-snapshot per-session caches", () => {
  assert.strictEqual(prunableCacheName("statusline-git.default.cache.json"), true);
});
test("does NOT match the shared config/budget files", () => {
  assert.strictEqual(prunableCacheName("statusline-soul.json"), false);
  assert.strictEqual(prunableCacheName("statusline-soul.budget.json"), false);
});
test("does NOT match unrelated files", () => {
  assert.strictEqual(prunableCacheName("statusline.js"), false);
  assert.strictEqual(prunableCacheName("settings.json"), false);
});
