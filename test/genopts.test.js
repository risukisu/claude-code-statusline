// test/genopts.test.js
// The react generator's `claude -p` child must be reaped hard on timeout so it can
// never linger. genExecOpts() builds the child_process options: a bounded timeout,
// SIGKILL (not the ignorable default SIGTERM), the recursion-guard env, and a silenced
// stderr. Timeout is env-overridable for tests/tuning.
const { test } = require("node:test");
const assert = require("node:assert");
const { genExecOpts } = require("../statusline.js");

test("force-kills on timeout with a bounded default", () => {
  const o = genExecOpts("hi");
  assert.strictEqual(o.killSignal, "SIGKILL");
  assert.strictEqual(typeof o.timeout, "number");
  assert.ok(o.timeout > 0 && o.timeout <= 20000);
});
test("carries the recursion-guard env and feeds the prompt via stdin", () => {
  const o = genExecOpts("my prompt");
  assert.strictEqual(o.env.CLAUDE_SOUL_GEN, "1");
  assert.strictEqual(o.input, "my prompt");
  assert.deepStrictEqual(o.stdio, ["pipe", "pipe", "ignore"]); // stderr ignored, never captured
});
test("timeout is env-overridable", () => {
  const prev = process.env.STATUSLINE_GEN_TIMEOUT_MS;
  process.env.STATUSLINE_GEN_TIMEOUT_MS = "500";
  try {
    assert.strictEqual(genExecOpts("x").timeout, 500);
  } finally {
    if (prev === undefined) delete process.env.STATUSLINE_GEN_TIMEOUT_MS;
    else process.env.STATUSLINE_GEN_TIMEOUT_MS = prev;
  }
});
