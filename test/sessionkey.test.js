// test/sessionkey.test.js — per-session cache key isolates sessions from each other
const { test } = require("node:test");
const assert = require("node:assert");
const { sessionKey } = require("../statusline.js");

test("distinct session ids produce distinct keys", () => {
  assert.notStrictEqual(sessionKey("abc-123"), sessionKey("def-456"));
});

test("keys are filename-safe (path separators stripped)", () => {
  assert.match(sessionKey("a/b\\c:d.e"), /^[a-zA-Z0-9_-]+$/);
});

test("missing/empty id falls back to a stable default", () => {
  assert.strictEqual(sessionKey(""), "default");
  assert.strictEqual(sessionKey(null), "default");
  assert.strictEqual(sessionKey(undefined), "default");
});

test("a real uuid-style id is preserved", () => {
  assert.strictEqual(sessionKey("2f1c9e7a-1b2c-4d5e-8f90-abcdef012345"), "2f1c9e7a-1b2c-4d5e-8f90-abcdef012345");
});
