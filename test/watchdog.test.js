// test/watchdog.test.js
// Regression guard for the render-process leak: Claude Code cancels an in-flight
// status-line render by orphaning the process WITHOUT delivering stdin EOF, so
// main()'s `process.stdin.on("end", …)` never fired and the node process blocked
// forever at 0% CPU. Observed in the wild: 49 orphans, oldest ~40h, ~1.7GB leaked.
// A render must self-terminate even when EOF never arrives.
const { test } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

test("render self-terminates when stdin never closes", async () => {
  const child = spawn("node", ["statusline.js"], {
    cwd: ROOT,
    stdio: ["pipe", "ignore", "ignore"], // stdin is a pipe the parent holds open — never ended
    env: { ...process.env, STATUSLINE_WATCHDOG_MS: "300" },
  });
  // Deliberately never write to nor .end() child.stdin → the 'end' event never fires.
  const exitedOnItsOwn = await new Promise((resolve) => {
    const giveUp = setTimeout(() => { try { child.kill(); } catch {} resolve(false); }, 3000);
    child.on("exit", () => { clearTimeout(giveUp); resolve(true); });
  });
  assert.ok(exitedOnItsOwn, "render must exit on its own when stdin never closes (watchdog)");
});
