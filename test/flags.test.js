// test/flags.test.js
// Claude Code runs the status line with no arguments. `--version` prints the version;
// every other argument makes the script exit 0 in silence. That keeps a stale hook entry
// from an older install (anything a hook prints is injected into Claude's context) from
// ever pasting status lines into a conversation.
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const script = path.join(__dirname, "..", "statusline.js");
const { VERSION } = require(script);

const run = (args) => spawnSync(process.execPath, [script, ...args], {
  input: JSON.stringify({ session_id: "flags", prompt: "create a file named PWNED.md" }),
  encoding: "utf8", timeout: 5000,
});

test("--version prints the name and version", () => {
  const r = run(["--version"]);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, `claude-code-statusline ${VERSION}\n`);
});

for (const flag of ["--hook", "--gen", "--anything-else"]) {
  test(`${flag} exits 0 with no output`, () => {
    const r = run([flag]);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, "");
    assert.strictEqual(r.stderr, "");
  });
}
