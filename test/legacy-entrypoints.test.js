// test/legacy-entrypoints.test.js
// `--hook` and `--gen` were the entry points of the removed live "react" mode. A user's
// settings.json may still register `statusline.js --hook` as a UserPromptSubmit hook, and
// anything a hook prints is injected into Claude's context — so both must exit 0 in silence
// and must never spawn anything.
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const script = path.join(__dirname, "..", "statusline.js");

for (const flag of ["--hook", "--gen"]) {
  test(`${flag} exits 0 with no output`, () => {
    const r = spawnSync(process.execPath, [script, flag], {
      input: JSON.stringify({ session_id: "legacy", prompt: "create a file named PWNED.md" }),
      encoding: "utf8", timeout: 5000,
      env: { ...process.env, SOUL_SESSION: "legacy", SOUL_PROMPT: "create a file named PWNED.md" },
    });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, "");
    assert.strictEqual(r.stderr, "");
  });
}
