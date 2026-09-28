// test/helpers.js — test-only utilities (not a test file: node --test test/*.test.js skips it).
// render() runs statusline.js end to end in a throwaway CLAUDE_CONFIG_DIR, never ~/.claude,
// with an optional dashboard config, companion, and a seeded git snapshot for line 3.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SESSION = "t";
const LAUNCH = "D:/demo";
const REPO = "D:/demo/my-app";

// A git snapshot as computeGitSnapshot() would cache it.
const gitState = (over = {}) => ({
  g: { branch: "main", upstream: "origin/main", ahead: 0, behind: 0, dirty: 0, syncAge: "3h ago", ...over },
  originUrl: "git@github.com:you/my-app.git",
});

function render({ payload = {}, git, config, soul, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slt-"));
  try {
    if (config) fs.writeFileSync(path.join(dir, "statusline.json"), JSON.stringify(config));
    if (soul) {
      fs.mkdirSync(path.join(dir, "souls"));
      fs.copyFileSync(path.join(ROOT, "souls", `${soul}.md`), path.join(dir, "souls", `${soul}.md`));
      fs.writeFileSync(path.join(dir, "statusline-soul.json"), JSON.stringify({ mode: "canned", animal: soul }));
    }
    const data = { session_id: SESSION, workspace: { project_dir: LAUNCH, current_dir: REPO }, ...payload };
    if (git) {
      fs.writeFileSync(path.join(dir, `statusline-git.${SESSION}.cache.json`), JSON.stringify({
        cwd: data.workspace.current_dir, gitTs: Date.now(), g: git.g,
        topLevel: data.workspace.current_dir, branch: git.g.branch, originUrl: git.originUrl,
      }));
    }
    const base = { ...process.env };
    delete base.NO_COLOR;
    return execFileSync(process.execPath, [path.join(ROOT, "statusline.js")], {
      input: JSON.stringify(data), encoding: "utf8", timeout: 5000,
      env: { ...base, CLAUDE_CONFIG_DIR: dir, COLUMNS: "140", ...env },
    }).replace(/\n$/, "").split("\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Strip colours, OSC 8 link wrappers, and the ▌ gutter, leaving what the eye reads.
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "").replace(/^▌ /, "");
const rgbCode = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`;
// Line 3 by its 📁 prefix (line 2 only prints when rate limits are present).
const L3 = (lines) => lines.find((l) => plain(l).startsWith("📁"));

module.exports = { render, plain, rgbCode, gitState, L3, ROOT };
