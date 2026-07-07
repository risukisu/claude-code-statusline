// test/gitcache-write.test.js
// Integration guard for the git-cache wiring: the first render writes a per-session
// git snapshot; a second render within the TTL reuses it (does NOT recompute), which
// is what removes the per-render git-subprocess storm. Hermetic via CLAUDE_CONFIG_DIR.
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SAMPLE = fs.readFileSync(path.join(ROOT, "examples/sample-input.json"), "utf8");

function runWith(cfgDir) {
  execFileSync("node", ["statusline.js"], {
    cwd: ROOT, input: SAMPLE, encoding: "utf8", timeout: 5000,
    env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir },
  });
}

test("render caches the git snapshot per session and reuses it within TTL", () => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "slgit-"));
  try {
    runWith(cfgDir);
    const cacheFile = path.join(cfgDir, "statusline-git.default.cache.json");
    assert.ok(fs.existsSync(cacheFile), "first render must write a per-session git cache");
    const first = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.strictEqual(typeof first.gitTs, "number", "cache must carry a timestamp");
    assert.ok("cwd" in first, "cache must record the cwd it describes");

    runWith(cfgDir); // second render, well within the TTL
    const second = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    assert.strictEqual(second.gitTs, first.gitTs, "second render within TTL must reuse the cache, not recompute git");
  } finally {
    fs.rmSync(cfgDir, { recursive: true, force: true });
  }
});
