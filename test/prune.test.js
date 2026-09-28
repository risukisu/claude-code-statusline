// test/prune.test.js
// Every session writes its own git snapshot cache, and a failed atomic write on Windows
// (rename over a file another render has open) used to leave its temp file behind. Nothing
// ever removed either, so ~/.claude filled with hundreds of statusline-git.* files.
// pruneStaleCaches() sweeps only this project's own files and never touches anything else.
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pruneStaleCaches } = require("../statusline.js");

const HOUR = 3600_000;
const ROOT = path.join(__dirname, "..");
const SAMPLE = fs.readFileSync(path.join(ROOT, "examples/sample-input.json"), "utf8");

function touch(dir, name, ageMs, now) {
  const f = path.join(dir, name);
  fs.writeFileSync(f, "{}");
  const t = (now - ageMs) / 1000;
  fs.utimesSync(f, t, t);
  return f;
}

test("removes stale caches and orphaned temp files, keeps fresh ones and everything else", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slprune-"));
  const now = Date.now();
  try {
    touch(dir, "statusline-git.fresh.cache.json", 1 * HOUR, now);
    touch(dir, "statusline-git.stale.cache.json", 25 * HOUR, now);
    touch(dir, "statusline-git.stale.cache.json.4242.tmp", 10 * 60_000, now);
    touch(dir, "statusline-git.inflight.cache.json.777.tmp", 1_000, now);
    // Not ours, or not a cache: must survive no matter how old.
    touch(dir, "settings.json", 400 * HOUR, now);
    touch(dir, "statusline-soul.json", 400 * HOUR, now);
    touch(dir, "statusline.js", 400 * HOUR, now);
    touch(dir, "statusline-git.notes.txt", 400 * HOUR, now);
    touch(dir, "my-statusline-git.old.cache.json", 400 * HOUR, now);

    pruneStaleCaches(dir, now);

    assert.deepStrictEqual(fs.readdirSync(dir).sort(), [
      "my-statusline-git.old.cache.json",
      "settings.json",
      "statusline-git.fresh.cache.json",
      "statusline-git.inflight.cache.json.777.tmp",
      "statusline-git.notes.txt",
      "statusline-soul.json",
      "statusline.js",
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing directory never throws", () => {
  assert.doesNotThrow(() => pruneStaleCaches(path.join(os.tmpdir(), "slprune-does-not-exist"), Date.now()));
});

test("the first render of a new session sweeps stale caches left by old sessions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slprune-int-"));
  try {
    const stale = touch(dir, "statusline-git.old-session.cache.json", 48 * HOUR, Date.now());
    execFileSync("node", ["statusline.js"], {
      cwd: ROOT, input: SAMPLE, encoding: "utf8", timeout: 5000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    });
    assert.strictEqual(fs.existsSync(stale), false, "stale cache from an old session must be swept");
    assert.ok(fs.existsSync(path.join(dir, "statusline-git.default.cache.json")), "own cache still written");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
