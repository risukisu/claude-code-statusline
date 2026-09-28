// test/look.test.js — themes, quiet mode, clickable links, and NO_COLOR, end to end.
const { test } = require("node:test");
const assert = require("node:assert");
const { THEMES } = require("../statusline.js");
const { render, plain, rgbCode, gitState, L3 } = require("./helpers.js");

const OSC = (url, text) => `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
const diff = { cost: { total_lines_added: 5, total_lines_removed: 2 } };

// ─── links ────────────────────────────────────────────────────────────────
test("the remote segment links to the repo's web page", () => {
  const line3 = L3(render({ git: gitState() }));
  assert.ok(line3.includes(OSC("https://github.com/you/my-app", "gh:you/my-app")), JSON.stringify(line3));
});
test("credentials in an https remote never reach the link", () => {
  const line3 = L3(render({ git: { ...gitState(), originUrl: "https://me:ghp_secret@github.com/you/my-app.git" } }));
  assert.ok(line3.includes(OSC("https://github.com/you/my-app", "gh:you/my-app")));
  assert.doesNotMatch(line3, /ghp_secret|me:/);
});
test("other hosts link to their own domain", () => {
  const line3 = L3(render({ git: { ...gitState(), originUrl: "git@gitlab.com:team/app.git" } }));
  assert.ok(line3.includes(OSC("https://gitlab.com/team/app", "gitlab.com:team/app")));
});
test("the PR badge links to the PR; a GitLab merge request reads MR !N", () => {
  const pr = { pr: { number: 12, url: "https://github.com/you/my-app/pull/12", review_state: "approved" } };
  assert.ok(L3(render({ git: gitState(), payload: pr })).includes(OSC("https://github.com/you/my-app/pull/12", "PR #12 approved")));
  const mr = { pr: { number: 7, url: "https://gitlab.com/team/app/-/merge_requests/7", kind: "mr", review_state: "pending" } };
  assert.match(plain(L3(render({ git: gitState(), payload: mr }))), /MR !7 pending/);
});
test("links: false prints plain text", () => {
  const line3 = L3(render({ git: gitState(), config: { links: false } }));
  assert.doesNotMatch(line3, /\x1b\]8;;/);
  assert.match(plain(line3), /gh:you\/my-app/);
});

// ─── quiet mode ───────────────────────────────────────────────────────────
test("quiet (default): healthy segments are dimmed, problems keep their colour", () => {
  const t = THEMES.default;
  const line3 = L3(render({ git: gitState() }));
  assert.ok(line3.includes(`${rgbCode(t.dim)}✓ synced`), "synced is healthy → dim");
  const dirty = L3(render({ git: gitState({ dirty: 3 }) }));
  assert.ok(dirty.includes(`${rgbCode(t.warn)}✚ 3`), "uncommitted work keeps its colour");
});
test("quiet: false restores the full colour", () => {
  const line3 = L3(render({ git: gitState(), config: { quiet: false } }));
  assert.ok(line3.includes(`${rgbCode(THEMES.default.good)}✓ synced`));
});

// ─── themes ───────────────────────────────────────────────────────────────
test("colorblind theme swaps green/red for blue/vermillion", () => {
  const out = render({ payload: diff, config: { theme: "colorblind" } })[0];
  const t = THEMES.colorblind;
  assert.ok(out.includes(`${rgbCode(t.good)}+5`) && out.includes(`${rgbCode(t.bad)}−2`), JSON.stringify(out));
  assert.notDeepStrictEqual(t.good, THEMES.default.good);
});
test("high-contrast theme lifts the dim greys", () => {
  const hc = THEMES["high-contrast"], def = THEMES.default;
  assert.ok(hc.dim[0] > def.dim[0] && hc.faint[0] > def.faint[0]);
});
test("NO_COLOR prints no escape codes at all", () => {
  const out = render({ git: gitState(), payload: diff, env: { NO_COLOR: "1" } }).join("\n");
  assert.doesNotMatch(out, /\x1b/);
  assert.match(out, /\+5 −2/);
});

// ─── hide ─────────────────────────────────────────────────────────────────
test("hide removes the named segments", () => {
  const out = render({ git: gitState(), payload: { ...diff, effort: { level: "high" } }, config: { hide: ["effort", "diff", "remote"] } }).map(plain);
  assert.doesNotMatch(out[0], /high|\+5/);
  assert.doesNotMatch(L3(out), /gh:/);
});
