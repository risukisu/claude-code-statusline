// test/breaker.test.js — circuit breaker that caps machine-wide generation bursts
const { test } = require("node:test");
const assert = require("node:assert");
const { evaluateBudget } = require("../statusline.js");

const WIN = 120_000; // BURST_WINDOW_MS
const now = 1_000_000_000;

test("empty/missing budget allows and records the call", () => {
  const r = evaluateBudget(null, now);
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.state, "ok");
  assert.strictEqual(r.budget.events.length, 1);
});

test("under the cap allows and appends (19 → 20)", () => {
  const events = Array.from({ length: 19 }, (_, i) => now - i * 100);
  const r = evaluateBudget({ events, tripUntil: 0 }, now);
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.budget.events.length, 20);
});

test("hitting the cap (20 in window) trips the breaker + starts cooldown", () => {
  const events = Array.from({ length: 20 }, (_, i) => now - i * 100);
  const r = evaluateBudget({ events, tripUntil: 0 }, now);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.state, "tripped");
  assert.ok(r.budget.tripUntil > now, "cooldown deadline set in the future");
});

test("while cooling down, every call is blocked", () => {
  const r = evaluateBudget({ events: [], tripUntil: now + 10_000 }, now);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.state, "cooldown");
});

test("stale events outside the window don't count toward the burst", () => {
  const events = Array.from({ length: 25 }, () => now - WIN - 1); // all older than the window
  const r = evaluateBudget({ events, tripUntil: 0 }, now);
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.budget.events.length, 1, "old events pruned, only the new one remains");
});

test("cooldown auto-expires", () => {
  const r = evaluateBudget({ events: [], tripUntil: now - 1 }, now);
  assert.strictEqual(r.allowed, true);
});
