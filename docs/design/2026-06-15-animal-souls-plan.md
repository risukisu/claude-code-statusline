# Animal Souls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give line 4 of the status line an optional animal companion (squirrel/fox/turtle) with three modes — off / canned / react — fully self-contained, default behavior unchanged.

**Architecture:** All logic stays in the single `statusline.js`: pure helpers are exported for tests, and execution is guarded behind `require.main === module`. `off`/`canned` modes touch no transcript; `react` mode tails the transcript Claude already provides, and on a new prompt spawns `node statusline.js --gen` detached, which runs `claude -p --safe-mode --model haiku` (~2.8s, reuses login, no API key) and writes a cache file the render path reads. No `settings.json` edits, no hooks. See spec: `docs/design/2026-06-15-animal-souls.md`.

**Tech Stack:** Node.js (no runtime deps); `node:test` + `node:assert` for tests (built-in, zero deps); `claude -p` CLI for react generation.

---

## Decisions to confirm before execution

- **Testing:** `node:test` (built-in). Run with `node --test test/`. If you'd rather skip tests entirely, drop the test steps — the impl steps stand alone.
- **Commits:** earlier in the session, Bash git ops were denied at the permission prompt. Each task below ends with a commit step; at execution time either approve them, or batch and run them yourself. They never block the next task.

## File structure

| Path | Responsibility | Action |
|---|---|---|
| `statusline.js` | render path + new pure helpers + `--gen` generator | modify |
| `souls/squirrel.md`, `souls/fox.md`, `souls/turtle.md` | the three personalities (stub content; expanded later) | create |
| `commands/animal.md` | `/animal` slash command | create |
| `test/*.test.js` | unit tests (node:test) | create |
| `test/fixtures/*` | sample config / soul / transcript | create |
| `README.md` | document the companion + honesty fix on "no transcript parsing" | modify |

**Runtime files** (created by the user/command at runtime, not shipped):
`~/.claude/statusline-soul.json` (config), `~/.claude/statusline-soul.cache.json` (react cache), `~/.claude/souls/<animal>.md` (installed copy of the souls).

**Shared constants & shapes** (defined in Task 2, referenced throughout):

```js
const EMOJI = { squirrel: "🐿️", fox: "🦊", turtle: "🐢" };
const ANIMALS = ["squirrel", "fox", "turtle"];
const MODES = ["off", "canned", "react"];
const IDLE_AFTER_MS = 90_000;   // react: after this, the last comment yields to ambient
const AMBIENT_EVERY_MS = 30_000; // rotate canned/ambient line this often
const GEN_LOCK_MS = 30_000;     // a "generating" stamp older than this is treated as stale
const PROMPT_MAX = 500;         // chars of the user prompt sent to haiku
```

- `loadConfig(file) -> { mode, animal }`
- `parseSoul(md) -> { voice, rules, work: string[], ambient: string[], react: string }`
- `pickCanned(soul, ctx, now) -> string|null` and `pickAmbient(soul, now) -> string|null`
- `truncate(text, cols) -> string`
- `renderLine4(cfg, soul, ctx, now) -> string`
- `latestUserPrompt(transcriptPath) -> string|null`
- `promptHash(text) -> string`
- `isNewPrompt(prompt, cache) -> boolean`
- `readCache(file) -> object|null`, `writeCache(file, obj) -> void`
- `buildGenArgs(soul, prompt) -> string[]`

`ctx` shape passed to `renderLine4`: `{ hasConfig: bool, hasRepo: bool, dirty: number, contextPct: number, cols: number, cache: object|null }`.

---

### Task 1: Test scaffold + characterization test (lock lines 1–3)

Locks current rendered behavior with a black-box test so the Task 2 refactor can't regress it.

**Files:**
- Create: `test/characterization.test.js`
- Existing fixture reused: `examples/sample-input.json`

- [ ] **Step 1: Write the characterization test**

```js
// test/characterization.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SAMPLE = fs.readFileSync(path.join(ROOT, "examples/sample-input.json"), "utf8");

function run(stdin) {
  return execFileSync("node", ["statusline.js"], { cwd: ROOT, input: stdin, encoding: "utf8" });
}

test("renders the session line with the model name", () => {
  const out = run(SAMPLE);
  assert.match(out, /Claude/);            // model.display_name from the sample
  assert.match(out, /█|░/);               // the context bar glyphs
});

test("emits at least three lines for the sample", () => {
  const out = run(SAMPLE).replace(/\n$/, "");
  assert.ok(out.split("\n").length >= 3, "expected >=3 lines");
});
```

- [ ] **Step 2: Run it against the current script — expect PASS**

Run: `node --test test/`
Expected: 2 tests pass (the current script already renders this). If the sample's model name differs, adjust the `/Claude/` match to a stable substring from `examples/sample-input.json`.

- [ ] **Step 3: Commit**

```bash
git add test/characterization.test.js
git commit -m "test: characterize current status line output"
```

---

### Task 2: Refactor statusline.js for testability (no output change)

Wrap execution behind `require.main` and add the requires + constants + a growing `module.exports`. Lines 1–3 logic is moved verbatim into `main()`.

**Files:**
- Modify: `statusline.js` (top requires; wrap the `process.stdin` block in `main()`; bottom guard + exports)

- [ ] **Step 1: Add requires + constants near the top (after `const { execSync } = require("child_process");`)**

```js
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const EMOJI = { squirrel: "🐿️", fox: "🦊", turtle: "🐢" };
const ANIMALS = ["squirrel", "fox", "turtle"];
const MODES = ["off", "canned", "react"];
const IDLE_AFTER_MS = 90_000;
const AMBIENT_EVERY_MS = 30_000;
const GEN_LOCK_MS = 30_000;
const PROMPT_MAX = 500;

const claudeDir = () => path.join(os.homedir(), ".claude");
const CONFIG_FILE = () => path.join(claudeDir(), "statusline-soul.json");
const CACHE_FILE = () => path.join(claudeDir(), "statusline-soul.cache.json");
const SOUL_FILE = (animal) => path.join(claudeDir(), "souls", `${animal}.md`);

module.exports = {}; // extended by later tasks
```

- [ ] **Step 2: Wrap the existing stdin/render block in `main()`**

Find the block starting `let raw = "";` and ending at the close of `process.stdin.on("end", () => { ... });`. Wrap it:

```js
function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => {
    // ... existing body unchanged ...
  });
}
```

- [ ] **Step 3: Add the guard at the very bottom of the file**

```js
if (require.main === module) main();
```

- [ ] **Step 4: Run the characterization test — expect PASS (behavior unchanged)**

Run: `node --test test/`
Expected: Task 1's tests still pass. `require("../statusline.js")` now loads without reading stdin.

- [ ] **Step 5: Commit**

```bash
git add statusline.js
git commit -m "refactor: guard execution behind require.main, export helpers"
```

---

### Task 3: Config loader

**Files:**
- Modify: `statusline.js` (add `loadConfig` + export)
- Create: `test/config.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/config.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadConfig } = require("../statusline.js");

const tmp = (name) => path.join(os.tmpdir(), `soul-${process.pid}-${name}`);

test("missing file → off/squirrel", () => {
  assert.deepStrictEqual(loadConfig(tmp("nope.json")), { mode: "off", animal: "squirrel" });
});
test("reads mode and animal", () => {
  const p = tmp("ok.json");
  fs.writeFileSync(p, JSON.stringify({ mode: "react", animal: "fox" }));
  assert.deepStrictEqual(loadConfig(p), { mode: "react", animal: "fox" });
  fs.unlinkSync(p);
});
test("invalid values fall back", () => {
  const p = tmp("bad.json");
  fs.writeFileSync(p, JSON.stringify({ mode: "loud", animal: "dragon" }));
  assert.deepStrictEqual(loadConfig(p), { mode: "off", animal: "squirrel" });
  fs.unlinkSync(p);
});
test("malformed json → off/squirrel", () => {
  const p = tmp("junk.json");
  fs.writeFileSync(p, "{not json");
  assert.deepStrictEqual(loadConfig(p), { mode: "off", animal: "squirrel" });
  fs.unlinkSync(p);
});
```

- [ ] **Step 2: Run — expect FAIL** (`loadConfig is not a function`)

Run: `node --test test/config.test.js`

- [ ] **Step 3: Implement (add to statusline.js, before the guard)**

```js
function loadConfig(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      mode: MODES.includes(c.mode) ? c.mode : "off",
      animal: ANIMALS.includes(c.animal) ? c.animal : "squirrel",
    };
  } catch {
    return { mode: "off", animal: "squirrel" };
  }
}
module.exports.loadConfig = loadConfig;
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/config.test.js`

- [ ] **Step 5: Commit**

```bash
git add statusline.js test/config.test.js
git commit -m "feat: soul config loader with safe fallbacks"
```

---

### Task 4: Soul markdown parser + three soul files

**Files:**
- Modify: `statusline.js` (add `parseSoul` + export)
- Create: `souls/squirrel.md`, `souls/fox.md`, `souls/turtle.md`
- Create: `test/soul.test.js`, `test/fixtures/sample-soul.md`

- [ ] **Step 1: Create the fixture**

```md
<!-- test/fixtures/sample-soul.md -->
# Fox 🦊
voice: clever, sly, lightly sassy
rules: one line, <= 80 chars

## work
- 14 files dirty and no commit. living dangerously.
- that's a lot of context for one function.

## ambient
- the henhouse can wait. i'm comfortable.
- left no tracks. as usual.

## react
You are Fox. Reply with ONE short witty line (<= 80 chars), in character.
```

- [ ] **Step 2: Write the failing test**

```js
// test/soul.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { parseSoul } = require("../statusline.js");

const md = fs.readFileSync(path.join(__dirname, "fixtures/sample-soul.md"), "utf8");

test("parses sections into arrays + react string", () => {
  const s = parseSoul(md);
  assert.strictEqual(s.work.length, 2);
  assert.strictEqual(s.ambient.length, 2);
  assert.match(s.react, /ONE short witty line/);
  assert.match(s.voice, /sly/);
});
test("missing sections become empty, never throws", () => {
  const s = parseSoul("# Bare\nvoice: x\n");
  assert.deepStrictEqual(s.work, []);
  assert.deepStrictEqual(s.ambient, []);
  assert.strictEqual(s.react, "");
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `node --test test/soul.test.js`

- [ ] **Step 4: Implement `parseSoul`**

```js
function parseSoul(md) {
  const out = { voice: "", rules: "", work: [], ambient: [], react: "" };
  if (typeof md !== "string") return out;
  let section = null;
  const reactLines = [];
  for (const raw of md.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const h = line.match(/^##\s+(\w+)/);
    if (h) { section = h[1].toLowerCase(); continue; }
    const v = line.match(/^voice:\s*(.+)$/i); if (v) { out.voice = v[1].trim(); continue; }
    const r = line.match(/^rules:\s*(.+)$/i); if (r) { out.rules = r[1].trim(); continue; }
    if ((section === "work" || section === "ambient") && line.trim().startsWith("-")) {
      const item = line.replace(/^\s*-\s+/, "").trim();
      if (item) out[section].push(item);
    } else if (section === "react") {
      reactLines.push(line);
    }
  }
  out.react = reactLines.join("\n").trim();
  return out;
}
module.exports.parseSoul = parseSoul;
```

> Note: the parser is line-based (no fragile multiline regex) and tolerates CRLF line endings.

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/soul.test.js`

- [ ] **Step 6: Create the three shipped soul files (stub content — expanded later)**

Each must contain `voice:`, `rules:`, `## work`, `## ambient`, `## react`. Minimum ~4 lines per list so rotation has variety. Example for `souls/squirrel.md`:

```md
# Squirrel 🐿️
voice: manic, enthusiastic, scattered — a cheerful hoarder
rules: one line, <= 80 chars, never mean, no emoji (the 🐿️ is added)

## work
- branch buried somewhere? dig one up before you forget.
- that diff is a big pile of nuts. commit some.
- ooh, uncommitted changes. don't lose those!
- so many files open. squirrel brain approves.

## ambient
- buried 47 acorns this morning. forgot where 31 are.
- winter's coming. must hoard more.
- twitchy tail, twitchy commits.
- was that a— nevermind. where was i?

## react
You are Squirrel, a manic and enthusiastic terminal companion watching a developer work.
Given their latest prompt, reply with ONE short line (<= 80 chars), in character, lowercase-ish.
Mostly react to what they're doing; occasionally let your hoarding squirrel nature show. Never mean.
```

Create `souls/fox.md` (clever, **lightly sassy**; ambient about dens/henhouses/no tracks) and `souls/turtle.md` (slow, patient, gently chides rushing; ambient about shells/longevity/"slow is smooth") in the same shape.

- [ ] **Step 7: Add a test that every shipped soul parses non-empty**

```js
// append to test/soul.test.js
test("shipped souls all parse with content", () => {
  for (const a of ["squirrel", "fox", "turtle"]) {
    const s = parseSoul(fs.readFileSync(path.join(__dirname, "..", "souls", `${a}.md`), "utf8"));
    assert.ok(s.work.length >= 2 && s.ambient.length >= 2 && s.react.length > 0, `${a} content`);
  }
});
```

Run: `node --test test/soul.test.js` → expect PASS.

- [ ] **Step 8: Commit**

```bash
git add statusline.js souls/ test/soul.test.js test/fixtures/sample-soul.md
git commit -m "feat: soul markdown parser + squirrel/fox/turtle stubs"
```

---

### Task 5: Line-selection helpers + truncation

**Files:**
- Modify: `statusline.js` (`pickAmbient`, `pickCanned`, `truncate` + exports)
- Create: `test/lines.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/lines.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { pickAmbient, pickCanned, truncate } = require("../statusline.js");

const soul = { work: ["W0", "W1"], ambient: ["A0", "A1", "A2"], react: "" };

test("pickAmbient rotates deterministically by clock", () => {
  assert.strictEqual(pickAmbient(soul, 0), "A0");
  assert.strictEqual(pickAmbient(soul, 30_000), "A1");
  assert.strictEqual(pickAmbient(soul, 90_000), "A0");
});
test("pickCanned uses work bucket when repo is dirty", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 3, contextPct: 0 }, 0), "W0");
});
test("pickCanned uses work bucket when context is high", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 80 }, 30_000), "W1");
});
test("pickCanned uses ambient when nothing notable", () => {
  assert.strictEqual(pickCanned(soul, { hasRepo: true, dirty: 0, contextPct: 10 }, 0), "A0");
});
test("truncate respects width and adds ellipsis", () => {
  assert.strictEqual(truncate("hello world", 8), "hello w…");
  assert.strictEqual(truncate("short", 80), "short");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/lines.test.js`

- [ ] **Step 3: Implement**

```js
function pickAmbient(soul, now) {
  const list = soul.ambient.length ? soul.ambient : soul.work;
  if (!list.length) return null;
  return list[Math.floor(now / AMBIENT_EVERY_MS) % list.length];
}
function pickCanned(soul, ctx, now) {
  const notable = (ctx.hasRepo && ctx.dirty > 0) || ctx.contextPct >= 70;
  const list = notable && soul.work.length ? soul.work
    : soul.ambient.length ? soul.ambient : soul.work;
  if (!list.length) return null;
  return list[Math.floor(now / AMBIENT_EVERY_MS) % list.length];
}
function truncate(text, cols) {
  const max = Math.max(8, (cols || 120) - 4);
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
module.exports.pickAmbient = pickAmbient;
module.exports.pickCanned = pickCanned;
module.exports.truncate = truncate;
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test test/lines.test.js`

- [ ] **Step 5: Commit**

```bash
git add statusline.js test/lines.test.js
git commit -m "feat: canned/ambient line selection + truncation"
```

---

### Task 6: `renderLine4` dispatcher + wire into main() (off + canned modes)

**Files:**
- Modify: `statusline.js` (`renderLine4` + export; replace the two `console.log("🐿️")` calls)
- Create: `test/render-line4.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/render-line4.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { renderLine4 } = require("../statusline.js");

const soul = { work: ["W0"], ambient: ["A0", "A1"], react: "", voice: "", rules: "" };
const base = { hasRepo: true, dirty: 0, contextPct: 0, cols: 120, cache: null };

test("no config → first-run nudge", () => {
  const out = renderLine4({ mode: "off", animal: "squirrel" }, null, { ...base, hasConfig: false }, 0);
  assert.match(out, /\/animal to pick a companion/);
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
    { ...base, hasConfig: true, cache }, 1000 + 1000);
  assert.match(out, /^🐢 ~ live one$/);
});
test("react falls back to ambient when comment is stale", () => {
  const cache = { comment: "old", ts: 0, promptHash: "x" };
  const out = renderLine4({ mode: "react", animal: "turtle" }, soul,
    { ...base, hasConfig: true, cache }, IDLE_AFTER_FOR_TEST(), 0);
  assert.match(out, /~ A/); // an ambient line, not "old"
});
function IDLE_AFTER_FOR_TEST() { return 90_000 + 1; }
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/render-line4.test.js`

- [ ] **Step 3: Implement `renderLine4`**

```js
function renderLine4(cfg, soul, ctx, now) {
  const emoji = EMOJI[cfg.animal] || EMOJI.squirrel;
  if (cfg.mode === "off") {
    if (!ctx.hasConfig) return `${DIM}${emoji} · /animal to pick a companion${RESET}`;
    return emoji;
  }
  if (!soul) return emoji; // soul file missing → degrade gracefully
  let text = null;
  if (cfg.mode === "react") {
    const c = ctx.cache;
    text = c && c.comment && now - c.ts < IDLE_AFTER_MS ? c.comment : pickAmbient(soul, now);
  } else {
    text = pickCanned(soul, ctx, now);
  }
  return text ? truncate(`${emoji} ~ ${text}`, ctx.cols) : emoji;
}
module.exports.renderLine4 = renderLine4;
```

> The first-run nudge test only checks for the substring, so the `DIM`/`RESET` ANSI wrappers (already defined at the top of statusline.js) don't break it.

- [ ] **Step 4: Wire into `main()` — replace BOTH `console.log("🐿️")` calls**

In `main()`, after parsing `d`, compute the line-4 context and config once. Replace the no-repo branch line (`console.log("🐿️")`) and the final line (`console.log("🐿️")`) with a shared call. Add near the top of the `stdin.on("end")` body:

```js
const cfgFile = CONFIG_FILE();
const hasConfig = fs.existsSync(cfgFile);
const cfg = loadConfig(cfgFile);
let soul = null;
try { soul = cfg.mode === "off" ? null : parseSoul(fs.readFileSync(SOUL_FILE(cfg.animal), "utf8")); } catch {}
```

Then build a helper inside `main()`'s end-handler to avoid duplicating the ctx at both exit points:

```js
const line4 = (hasRepo, dirty) => renderLine4(cfg, soul, {
  hasConfig, hasRepo, dirty,
  contextPct: (d.context_window && d.context_window.used_percentage) || 0,
  cols, cache: cfg.mode === "react" ? readCache(CACHE_FILE()) : null,
}, Date.now());
```

Replace the no-repo branch's `console.log("🐿️")` with `console.log(line4(false, 0));` and the final `console.log("🐿️")` with `console.log(line4(true, g.dirty));`.

> `readCache` is added in Task 8; until then stub it as `const readCache = () => null;` at the top and remove the stub when Task 8 lands. (Tracked again in Task 8 Step 4.)

- [ ] **Step 5: Run all tests + manual check**

Run: `node --test test/`
Manual: `node statusline.js < examples/sample-input.json` → line 4 shows the nudge (no config yet). Create `~/.claude/statusline-soul.json` = `{"mode":"canned","animal":"fox"}`, copy `souls/` to `~/.claude/souls/`, re-run → line 4 shows `🦊 ~ …`.

- [ ] **Step 6: Commit**

```bash
git add statusline.js test/render-line4.test.js
git commit -m "feat: line-4 dispatcher with off + canned modes and first-run nudge"
```

---

### Task 7: Transcript tail → latest user prompt

**Files:**
- Modify: `statusline.js` (`latestUserPrompt` + export)
- Create: `test/transcript.test.js`, `test/fixtures/sample-transcript.jsonl`

- [ ] **Step 1: VERIFY the real schema first**

Run against a real transcript to confirm field names (do NOT skip — the parser depends on this):

```bash
# find a recent transcript and print the last user message object's keys
node -e "const fs=require('fs');const p=process.argv[1];const ls=fs.readFileSync(p,'utf8').trim().split('\n');for(let i=ls.length-1;i>=0;i--){const o=JSON.parse(ls[i]);if((o.type==='user')||(o.message&&o.message.role==='user')){console.log(JSON.stringify(o,null,2).slice(0,800));break;}}" "$(ls -t ~/.claude/projects/*/*.jsonl | head -1)"
```

Expected: an object with `type: "user"` and `message: { role: "user", content: <string | array of {type:"text", text}> }`. If field names differ, adjust the fixture and parser below to match.

- [ ] **Step 2: Create the fixture (mirror the verified schema)**

```jsonl
{"type":"summary","summary":"x"}
{"type":"user","message":{"role":"user","content":"first prompt"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"second prompt please"}]}}
```

- [ ] **Step 3: Write failing tests**

```js
// test/transcript.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { latestUserPrompt } = require("../statusline.js");

const FIX = path.join(__dirname, "fixtures/sample-transcript.jsonl");

test("returns the last user message (array content)", () => {
  assert.strictEqual(latestUserPrompt(FIX), "second prompt please");
});
test("missing file → null, never throws", () => {
  assert.strictEqual(latestUserPrompt(path.join(__dirname, "nope.jsonl")), null);
});
```

- [ ] **Step 4: Run — expect FAIL**

Run: `node --test test/transcript.test.js`

- [ ] **Step 5: Implement (read only the tail; handle string or block content)**

```js
function latestUserPrompt(transcriptPath) {
  try {
    const buf = fs.readFileSync(transcriptPath, "utf8");
    const lines = buf.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      let o; try { o = JSON.parse(lines[i]); } catch { continue; }
      const msg = o.message || o;
      const isUser = o.type === "user" || (msg && msg.role === "user");
      if (!isUser || !msg) continue;
      const c = msg.content;
      if (typeof c === "string") return c.trim() || null;
      if (Array.isArray(c)) {
        const text = c.filter((b) => b && b.type === "text").map((b) => b.text).join(" ").trim();
        if (text) return text;
      }
    }
    return null;
  } catch {
    return null;
  }
}
module.exports.latestUserPrompt = latestUserPrompt;
```

- [ ] **Step 6: Run — expect PASS**

Run: `node --test test/transcript.test.js`

- [ ] **Step 7: Commit**

```bash
git add statusline.js test/transcript.test.js test/fixtures/sample-transcript.jsonl
git commit -m "feat: read latest user prompt from transcript tail"
```

---

### Task 8: Prompt hashing, new-prompt detection, cache I/O

**Files:**
- Modify: `statusline.js` (`promptHash`, `isNewPrompt`, `readCache`, `writeCache` + exports; remove the Task 6 `readCache` stub)
- Create: `test/cache.test.js`

- [ ] **Step 1: Write failing tests**

```js
// test/cache.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promptHash, isNewPrompt, readCache, writeCache } = require("../statusline.js");

const tmp = (n) => path.join(os.tmpdir(), `soulcache-${process.pid}-${n}`);

test("promptHash is stable and differs by input", () => {
  assert.strictEqual(promptHash("a"), promptHash("a"));
  assert.notStrictEqual(promptHash("a"), promptHash("b"));
});
test("isNewPrompt true when hash differs or no cache", () => {
  assert.strictEqual(isNewPrompt("hi", null), true);
  assert.strictEqual(isNewPrompt("hi", { promptHash: promptHash("hi") }), false);
  assert.strictEqual(isNewPrompt("hi", { promptHash: promptHash("bye") }), true);
});
test("isNewPrompt false for empty prompt", () => {
  assert.strictEqual(isNewPrompt(null, null), false);
});
test("write then read round-trips", () => {
  const p = tmp("rt.json");
  writeCache(p, { comment: "x", ts: 5, promptHash: "h", generating: 0 });
  assert.deepStrictEqual(readCache(p), { comment: "x", ts: 5, promptHash: "h", generating: 0 });
  fs.unlinkSync(p);
});
test("readCache missing → null", () => {
  assert.strictEqual(readCache(tmp("nope.json")), null);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/cache.test.js`

- [ ] **Step 3: Implement (atomic write via temp + rename)**

```js
const crypto = require("node:crypto");
function promptHash(text) {
  return crypto.createHash("sha1").update(String(text)).digest("hex").slice(0, 16);
}
function isNewPrompt(prompt, cache) {
  if (!prompt) return false;
  if (!cache || !cache.promptHash) return true;
  return cache.promptHash !== promptHash(prompt);
}
function readCache(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function writeCache(file, obj) {
  try {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch { /* never throw from the status line */ }
}
module.exports.promptHash = promptHash;
module.exports.isNewPrompt = isNewPrompt;
module.exports.readCache = readCache;
module.exports.writeCache = writeCache;
```

- [ ] **Step 4: Remove the Task 6 stub**

Delete the temporary `const readCache = () => null;` line added in Task 6 Step 4 (the real one is now defined). Add `const crypto = require("node:crypto");` to the top requires.

- [ ] **Step 5: Run — expect PASS**

Run: `node --test test/`

- [ ] **Step 6: Commit**

```bash
git add statusline.js test/cache.test.js
git commit -m "feat: prompt hashing, new-prompt detection, atomic cache I/O"
```

---

### Task 9: The generator (`--gen`) + detached spawn + wire react trigger

**Files:**
- Modify: `statusline.js` (`buildGenArgs` + export; `generate()`; `maybeSpawnGenerator()`; argv branch in the guard; trigger in `main()`)
- Create: `test/genargs.test.js`

- [ ] **Step 1: Write failing test for the pure command builder**

```js
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/genargs.test.js`

- [ ] **Step 3: Implement the builder + generator + spawn**

```js
function buildGenArgs(sysPromptFile) {
  return [
    "-p", "--safe-mode", "--no-session-persistence",
    "--model", "haiku", "--append-system-prompt-file", sysPromptFile,
  ];
}
module.exports.buildGenArgs = buildGenArgs;

// Runs in the detached --gen child: generate one comment, write the cache, exit.
// Cross-platform-safe: the multi-line soul goes via a temp file (--append-system-prompt-file)
// and the user prompt via stdin, so neither is ever a shell-quoted argument.
function generate() {
  let sysFile;
  try {
    const cfg = loadConfig(CONFIG_FILE());
    if (cfg.mode !== "react") return;
    const soul = parseSoul(fs.readFileSync(SOUL_FILE(cfg.animal), "utf8"));
    const prompt = latestUserPrompt(process.env.SOUL_TRANSCRIPT || "");
    if (!prompt) return;
    sysFile = path.join(os.tmpdir(), `soul-sys-${process.pid}.txt`);
    fs.writeFileSync(sysFile, soul.react || "Reply with ONE short witty line (<= 80 chars).");
    const { execFileSync } = require("node:child_process");
    const out = execFileSync("claude", buildGenArgs(sysFile), {
      input: String(prompt).slice(0, PROMPT_MAX),
      timeout: 20000, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
      shell: process.platform === "win32", // resolve a claude.cmd shim on Windows; every arg is fixed/safe
    }).trim();
    const comment = (out.split("\n").filter(Boolean).pop() || "").trim();
    writeCache(CACHE_FILE(), { comment, ts: Date.now(), promptHash: promptHash(prompt), generating: 0 });
  } catch {
    // generation failed — clear the lock so the next prompt retries; keep the old comment
    const c = readCache(CACHE_FILE());
    if (c) { c.generating = 0; writeCache(CACHE_FILE(), c); }
  } finally {
    try { if (sysFile) fs.unlinkSync(sysFile); } catch {}
  }
}

// Runs in the render process: fire the detached child at most once per new prompt.
function maybeSpawnGenerator(transcriptPath) {
  const cacheFile = CACHE_FILE();
  const cache = readCache(cacheFile);
  const prompt = latestUserPrompt(transcriptPath);
  if (!isNewPrompt(prompt, cache)) return;
  if (cache && cache.generating && Date.now() - cache.generating < GEN_LOCK_MS) return; // in flight
  // Claim the work so repeated refreshes don't double-spawn.
  writeCache(cacheFile, {
    comment: cache ? cache.comment : "", ts: cache ? cache.ts : 0,
    promptHash: promptHash(prompt), generating: Date.now(),
  });
  const { spawn } = require("node:child_process");
  const child = spawn(process.execPath, [__filename, "--gen"], {
    detached: true, stdio: "ignore", env: { ...process.env, SOUL_TRANSCRIPT: transcriptPath },
  });
  child.unref();
}
```

> Cross-platform note: the `claude` call uses `execFileSync` with an args array — no shell command string to quote. The soul goes via `--append-system-prompt-file` and the prompt via stdin, so neither is ever shell-escaped. `shell: true` on Windows lets Node resolve a `claude.cmd` shim (safe here — every arg is a fixed flag or a temp-file path); if your `claude` is a native `.exe`, prefer `shell: false`, which also tolerates paths with spaces. The detached `spawn(process.execPath, …).unref()` is uniform across platforms.
>
> **Verify first:** run `claude --help` and confirm `--append-system-prompt-file` exists (the `--bare` help references it). If it doesn't, prepend the soul text to the stdin prompt and drop the flag.

- [ ] **Step 4: Add the argv branch + react trigger**

Change the bottom guard:

```js
if (require.main === module) {
  if (process.argv.includes("--gen")) generate();
  else main();
}
```

In `main()`'s `stdin.on("end")` body, after `cfg`/`soul` are computed and before printing line 4, add:

```js
if (cfg.mode === "react" && d.transcript_path) maybeSpawnGenerator(d.transcript_path);
```

(The `line4(...)` helper already reads the cache via `readCache(CACHE_FILE())`, so it shows whatever the last generation produced.)

- [ ] **Step 5: Run unit tests + manual end-to-end**

Run: `node --test test/` → all pass.
Manual: set `~/.claude/statusline-soul.json` to `{"mode":"react","animal":"fox"}`, ensure `~/.claude/souls/fox.md` exists, then:
```bash
echo '{"model":{"display_name":"Claude"},"transcript_path":"<a real transcript .jsonl>","workspace":{"current_dir":"."}}' | node statusline.js
# wait ~3s, run the same line again → line 4 shows a fox reaction to the transcript's last prompt
```

- [ ] **Step 6: Commit**

```bash
git add statusline.js test/genargs.test.js
git commit -m "feat: react mode — detached generator via claude -p --safe-mode"
```

---

### Task 10: `/animal` slash command

**Files:**
- Create: `commands/animal.md`

- [ ] **Step 1: Write the command**

```md
---
description: Pick or change your status-line animal companion (squirrel/fox/turtle)
argument-hint: "[squirrel|fox|turtle] [canned|react|off]"
---
The user wants to configure their status-line animal companion. Argument: "$ARGUMENTS".

Config file: `~/.claude/statusline-soul.json` with shape `{"mode":"off|canned|react","animal":"squirrel|fox|turtle"}`.
Soul files must exist at `~/.claude/souls/<animal>.md` — if missing, copy them from this repo's `souls/` folder.

Do this:
1. If no argument: read the current config (if any) and report it, then list the three animals
   (🐿️ squirrel, 🦊 fox, 🐢 turtle) and the three modes, and ask which they want.
2. If an animal is given (e.g. `fox`): set `animal` to it. Default `mode` to `canned` unless a mode is also given.
3. If mode `react` is requested: BEFORE writing, explain that react mode runs a `claude -p --safe-mode --model haiku`
   call (~3s) on every prompt you submit, using their own Claude Code login and counting toward their rate limits,
   and that their latest prompt text is sent to Haiku. Confirm, then write the config.
4. If `off`: set `mode` to `off` (companion becomes a quiet emoji).
5. Write `~/.claude/statusline-soul.json`, ensure `~/.claude/souls/` is populated, and confirm the new setting.
```

- [ ] **Step 2: Manual verification**

In a Claude Code session: `/animal fox` → confirms config written; `/animal fox react` → explains cost, then writes; `/animal off` → quiet emoji. Check `~/.claude/statusline-soul.json` contents after each.

- [ ] **Step 3: Commit**

```bash
git add commands/animal.md
git commit -m "feat: /animal slash command to pick mode + companion"
```

---

### Task 11: Docs — README companion section + honesty fix

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the line-4 description**

Replace the line in "What it shows" that calls line 4 "a deliberate placeholder, room to grow your own widget" with a short pointer to the optional companion (see new section).

- [ ] **Step 2: Add an "Animal companion (optional)" section**

Document: the three modes (off/canned/react) with one line-4 example each; install (`souls/` → `~/.claude/souls/`, `commands/animal.md` → `~/.claude/commands/`); the `/animal` command; that **react mode** sends your prompt to Haiku via your own login and counts toward limits (~3s, `--safe-mode`); and that you can edit any `souls/*.md`.

- [ ] **Step 3: Honesty fix on "no transcript parsing"**

Find the claims in the intro / "How it works" that say "no transcript parsing." Add the nuance: the default and canned modes read no transcript; **only react mode** reads the prompt tail. State it plainly.

- [ ] **Step 4: Update the project-structure tree**

Add `souls/`, `commands/animal.md`, and `test/` to the tree in README.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document the optional animal companion + transcript-read nuance"
```

---

### Task 12: Final manual end-to-end verification

No code; a checklist proving the whole feature across modes. Run each and confirm.

- [ ] **Off (default):** remove `~/.claude/statusline-soul.json`; `node statusline.js < examples/sample-input.json` → line 4 = `🐿️ · /animal to pick a companion`.
- [ ] **Off (chosen):** write `{"mode":"off","animal":"turtle"}` → line 4 = `🐢` only.
- [ ] **Canned:** `{"mode":"canned","animal":"fox"}` + souls installed → line 4 = `🦊 ~ …`; dirty the repo and confirm a `work` line appears; leave it idle and confirm the line rotates over ~30s.
- [ ] **React:** `{"mode":"react","animal":"squirrel"}` → submit a prompt in a real session; within ~3s line 4 shows a squirrel reaction; confirm only ONE `claude` process spawns per prompt (no storm).
- [ ] **Degradation:** delete `~/.claude/souls/fox.md` while in canned/react → line 4 falls back to the bare emoji, lines 1–3 unaffected.
- [ ] **Tests green:** `node --test test/` → all pass.
- [ ] **Commit** any final tweaks.

---

## Self-review (run before handing off to execution)

- **Spec coverage:** off/canned/react ✔ (Tasks 6, 9); souls as editable md ✔ (Task 4); hybrid cadence ✔ (Tasks 5–6); in-character ambient ✔ (Task 4 `## ambient` + Tasks 5–6); `--safe-mode` keyless gen ✔ (Task 9); `/animal` + cost explainer ✔ (Task 10); self-contained first-run nudge ✔ (Task 6); upgrade path = drop files + `/animal` ✔ (Tasks 10–11); privacy/no-transcript honesty ✔ (Task 11).
- **Spec reconciliation:** spec §3 says "no config = today's behavior byte-for-byte" while §7 adds a first-run nudge — resolved here as: **no config → nudge; `mode:off` → bare emoji**. (Tighten the spec wording to match if desired.)
- **Out of scope (per spec):** Stop-hook "reacts to completed work," API-key fast path, LLM-generated ambient lines — not in this plan.
