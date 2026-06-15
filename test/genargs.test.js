// test/genargs.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { buildGenArgs } = require("../statusline.js");

test("builds safe-mode haiku args pointing at the system-prompt file", () => {
  const args = buildGenArgs("/tmp/soul-sys.txt");
  assert.ok(args.includes("--safe-mode"));
  assert.ok(args.includes("--no-session-persistence"));
  assert.deepStrictEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "haiku"]);
  assert.strictEqual(args[args.indexOf("--append-system-prompt-file") + 1], "/tmp/soul-sys.txt");
});
