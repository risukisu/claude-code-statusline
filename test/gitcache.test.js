// test/gitcache.test.js
// The render shells out to git 4–5× per invocation (status, rev-parse, config, log).
// At ~3 renders/sec across sessions that's a subprocess storm. gitCacheFresh() decides
// whether a per-session cached git snapshot may be reused, so most renders skip git.
const { test } = require("node:test");
const assert = require("node:assert");
const { gitCacheFresh } = require("../statusline.js");

const CWD = "D:/AI_WORKSPACE_Personal";

test("fresh: same cwd, within TTL → reuse", () => {
  assert.strictEqual(gitCacheFresh({ cwd: CWD, gitTs: 1000 }, CWD, 2000, 3000), true);
});
test("stale: age >= TTL → recompute", () => {
  assert.strictEqual(gitCacheFresh({ cwd: CWD, gitTs: 1000 }, CWD, 4500, 3000), false);
});
test("cd'd elsewhere: different cwd → recompute (never show the wrong repo)", () => {
  assert.strictEqual(gitCacheFresh({ cwd: CWD, gitTs: 1000 }, "D:/other", 1500, 3000), false);
});
test("no cache → recompute", () => {
  assert.strictEqual(gitCacheFresh(null, CWD, 1500, 3000), false);
});
test("cache without a timestamp → recompute", () => {
  assert.strictEqual(gitCacheFresh({ cwd: CWD }, CWD, 1500, 3000), false);
});
