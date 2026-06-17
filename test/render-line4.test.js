// test/render-line4.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { renderLine4 } = require("../statusline.js");

const soul = { work: ["W0"], ambient: ["A0", "A1"], react: "", voice: "", rules: "" };
const base = { hasRepo: true, dirty: 0, contextPct: 0, cols: 120, cache: null };

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
test("canned mode renders emoji + line", () => {
  const out = renderLine4({ mode: "canned", animal: "fox" }, soul, { ...base, hasConfig: true }, 0);
  assert.match(out, /^🦊 ~ A0$/);
});
test("react shows fresh cached comment", () => {
  const cache = { comment: "live one", ts: 1000, promptHash: "x" };
  const out = renderLine4({ mode: "react", animal: "turtle" }, soul,
    { ...base, hasConfig: true, cache }, 2000);
  assert.match(out, /^🐢 ~ live one$/);
});
test("react falls back to ambient when comment is stale", () => {
  const cache = { comment: "old", ts: 0, promptHash: "x" };
  const out = renderLine4({ mode: "react", animal: "turtle" }, soul,
    { ...base, hasConfig: true, cache }, 90_001);
  assert.match(out, /~ A/); // an ambient line, not "old"
});
test("react shows a resting note when the breaker is tripped (paused) and no fresh comment", () => {
  const out = renderLine4({ mode: "react", animal: "squirrel" }, soul,
    { ...base, hasConfig: true, cache: null, paused: true }, 0);
  assert.match(out, /resting/);
});
