// test/cache.test.js
// readCache/writeCache back the per-session git-snapshot cache: atomic (temp file + rename),
// never throwing, and returning null for anything missing or malformed.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readCache, writeCache } = require("../statusline.js");

const tmp = (n) => path.join(os.tmpdir(), `gitcache-${process.pid}-${n}`);

test("write then read round-trips", () => {
  const f = tmp("rt.json");
  writeCache(f, { cwd: "D:/x", gitTs: 123, g: { dirty: 2 } });
  assert.deepStrictEqual(readCache(f), { cwd: "D:/x", gitTs: 123, g: { dirty: 2 } });
  assert.strictEqual(fs.existsSync(`${f}.${process.pid}.tmp`), false); // temp file renamed away
  fs.unlinkSync(f);
});
test("readCache missing → null", () => {
  assert.strictEqual(readCache(tmp("missing.json")), null);
});
test("readCache malformed → null, never throws", () => {
  const f = tmp("bad.json");
  fs.writeFileSync(f, "{nope");
  assert.strictEqual(readCache(f), null);
  fs.unlinkSync(f);
});
test("writeCache to an unwritable path never throws", () => {
  assert.doesNotThrow(() => writeCache(path.join(tmp("no-such-dir"), "x", "y.json"), { a: 1 }));
});
