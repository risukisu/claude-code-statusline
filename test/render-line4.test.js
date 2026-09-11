// test/render-line4.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { renderLine4 } = require("../statusline.js");

const soul = { work: ["W0"], ambient: ["A0", "A1"], voice: "", rules: "" };
const base = { hasRepo: true, dirty: 0, contextPct: 0, cols: 120 };

test("no config + command installed → restart-and-pick nudge", () => {
  const out = renderLine4({ mode: "off", animal: "squirrel" }, null,
    { ...base, hasConfig: false, hasCommand: true }, 0);
  assert.match(out, /restart Claude Code, then \/animal/);
});
test("no config + command NOT installed → bare emoji (no dead nudge)", () => {
  const out = renderLine4({ mode: "off", animal: "squirrel" }, null,
    { ...base, hasConfig: false, hasCommand: false }, 0);
  assert.strictEqual(out, "🐿️");
});
test("mode off with config → bare emoji", () => {
  const out = renderLine4({ mode: "off", animal: "fox" }, null, { ...base, hasConfig: true }, 0);
  assert.strictEqual(out, "🦊");
});
test("canned mode renders emoji + an ambient line when nothing is notable", () => {
  const out = renderLine4({ mode: "canned", animal: "fox" }, soul, { ...base, hasConfig: true }, 0);
  assert.match(out, /^🦊 ~ A0$/);
});
test("canned mode picks a work line when the repo is dirty", () => {
  const out = renderLine4({ mode: "canned", animal: "turtle" }, soul, { ...base, hasConfig: true, dirty: 3 }, 0);
  assert.match(out, /^🐢 ~ W0$/);
});
test("canned mode with a missing soul degrades to the emoji", () => {
  const out = renderLine4({ mode: "canned", animal: "squirrel" }, null, { ...base, hasConfig: true }, 0);
  assert.strictEqual(out, "🐿️");
});
