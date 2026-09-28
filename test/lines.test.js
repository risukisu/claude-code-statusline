// test/lines.test.js
// pickCanned() chooses line 4 from the soul by what's going on:
//   notable states (context, limits, behind, dirty, ahead) take two slots in three, taking turns
//   with the generic `work` lines (which also stand in for a missing section); ambient gets every third slot.
//   Calm states (night, norepo, synced, branch) share the rotation with ambient.
// A slot is AMBIENT_EVERY_MS (30s) of wall clock.
const { test } = require("node:test");
const assert = require("node:assert");
const { pickCanned, fillLine, truncate } = require("../statusline.js");

const S = 30_000; // one slot
const soul = { work: ["W0", "W1"], ambient: ["A0", "A1", "A2"] };
const idle = { hasRepo: true, dirty: 0, contextPct: 10 };

test("pickCanned uses work bucket when repo is dirty", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 3, contextPct: 0 }, 0), "W0");
});
test("pickCanned uses work bucket when context is high", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 80 }, 1 * S), "W1");
});
test("pickCanned uses ambient when nothing notable, rotating by clock", () => {
  assert.strictEqual(pickCanned(soul, idle, 0), "A0");
  assert.strictEqual(pickCanned(soul, idle, 1 * S), "A1");
  assert.strictEqual(pickCanned(soul, idle, 3 * S), "A0");
});
test("pickCanned falls back to work when ambient is empty, null when both are", () => {
  assert.strictEqual(pickCanned({ work: ["W0"], ambient: [] }, { hasRepo: false, dirty: 0, contextPct: 0 }, 0), "W0");
  assert.strictEqual(pickCanned({ work: [], ambient: [] }, { hasRepo: false, dirty: 0, contextPct: 0 }, 0), null);
});

test("a notable state leads with its own section", () => {
  const s = { ...soul, dirty: ["D0"] };
  assert.strictEqual(pickCanned(s, { hasRepo: true, dirty: 3, contextPct: 0 }, 0), "D0");
});
test("generic work lines take a turn beside the state lines", () => {
  const s = { work: ["W0"], dirty: ["D0"], ambient: ["A0"] };
  const busy = { hasRepo: true, dirty: 3, contextPct: 0 };
  assert.deepStrictEqual([0, 1, 2].map((i) => pickCanned(s, busy, i * S)), ["D0", "W0", "A0"]);
});
test("while busy, every third slot still belongs to ambient", () => {
  const s = { ambient: ["A0", "A1", "A2"], dirty: ["D0", "D1"] };
  const busy = { hasRepo: true, dirty: 3, contextPct: 0 };
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5].map((i) => pickCanned(s, busy, i * S)), ["D0", "D1", "A0", "D0", "D1", "A1"]);
});
test("two notable states take turns", () => {
  const s = { ...soul, dirty: ["D0"], ahead: ["H0"] };
  const ctx = { hasRepo: true, dirty: 2, ahead: 1, contextPct: 0, upstream: true };
  assert.strictEqual(pickCanned(s, ctx, 0), "D0");
  assert.strictEqual(pickCanned(s, ctx, 1 * S), "H0");
});
test("behind, ahead, limits and context each trigger their own section", () => {
  const s = { ambient: ["A"], behind: ["B"], ahead: ["H"], limits: ["L"], context: ["C"] };
  const base = { hasRepo: true, dirty: 0, contextPct: 0, upstream: true };
  assert.strictEqual(pickCanned(s, { ...base, behind: 4 }, 0), "B");
  assert.strictEqual(pickCanned(s, { ...base, ahead: 2 }, 0), "H");
  assert.strictEqual(pickCanned(s, { ...base, limitPct: 85 }, 0), "L");
  assert.strictEqual(pickCanned(s, { ...base, limitPct: 40, pace: 20 }, 0), "L");
  assert.strictEqual(pickCanned(s, { ...base, contextPct: 72 }, 0), "C");
});
test("calm states share the rotation with ambient", () => {
  const s = { ambient: ["A0", "A1"], synced: ["S0", "S1"] };
  const synced = { hasRepo: true, dirty: 0, ahead: 0, behind: 0, upstream: true, branch: "main", contextPct: 5 };
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => pickCanned(s, synced, i * S)), ["S0", "A0", "S1", "A1"]);
});
test("synced needs an upstream; a local-only repo is not 'synced'", () => {
  const s = { ambient: ["A"], synced: ["S"] };
  assert.strictEqual(pickCanned(s, { hasRepo: true, dirty: 0, upstream: false, branch: "main", contextPct: 0 }, 0), "A");
});
test("feature branch, no repo and the small hours each have a calm section", () => {
  const s = { ambient: ["A"], branch: ["on {branch}"], norepo: ["R"], night: ["N"] };
  assert.strictEqual(pickCanned(s, { hasRepo: true, dirty: 0, branch: "feat/x", contextPct: 0, hour: 14 }, 0), "on feat/x");
  assert.strictEqual(pickCanned(s, { hasRepo: false, dirty: 0, contextPct: 0, hour: 14 }, 0), "R");
  assert.strictEqual(pickCanned(s, { hasRepo: false, dirty: 0, contextPct: 0, hour: 2 }, 0), "N");
});
test("placeholders are filled from the live state", () => {
  const s = { ambient: ["A"], dirty: ["{dirty:file} loose"], context: ["{ctx}% gone"] };
  assert.strictEqual(pickCanned(s, { hasRepo: true, dirty: 1, contextPct: 0 }, 0), "1 file loose");
  assert.strictEqual(pickCanned(s, { hasRepo: true, dirty: 3, contextPct: 0 }, 0), "3 files loose");
  assert.strictEqual(pickCanned(s, { hasRepo: false, dirty: 0, contextPct: 71.6 }, 0), "72% gone");
});
test("a line whose placeholder has no value is skipped, never shown half-filled", () => {
  const s = { ambient: ["A"], context: ["5h at {limit}%", "ctx {ctx}%"] };
  const ctx = { hasRepo: false, dirty: 0, contextPct: 90 };
  for (const i of [0, 1, 3, 4]) assert.strictEqual(pickCanned(s, ctx, i * S), "ctx 90%");
});

test("fillLine: counts, plurals, unknown keys", () => {
  assert.strictEqual(fillLine("{ahead:commit} ahead", { ahead: 1 }), "1 commit ahead");
  assert.strictEqual(fillLine("{ahead:commit} ahead", { ahead: 2 }), "2 commits ahead");
  assert.strictEqual(fillLine("{behind} behind", { behind: 4 }), "4 behind");
  assert.strictEqual(fillLine("no braces", {}), "no braces");
  assert.strictEqual(fillLine("{dirty} dirty", {}), null);
  assert.strictEqual(fillLine("{mystery} here", { mystery: 1 }), null);
});
test("truncate respects width and adds ellipsis", () => {
  assert.strictEqual(truncate("hello world", 8), "hello w…");
  assert.strictEqual(truncate("short", 80), "short");
});
