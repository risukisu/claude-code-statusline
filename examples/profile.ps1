# ── Dual-workspace Claude Code launchers ────────────────────────────────────
# Add to your PowerShell $PROFILE  (open it with:  notepad $PROFILE).
#
# `ccp` launches Claude Code in your personal workspace, `cca` in your work
# workspace. The status line colour-codes each launch root via ROOT_PALETTES
# in statusline.js — so a glance at line 3 tells you which world you're in.
#
# This mirrors the author's setup: one personal root, one for work (Appsilon).
# Point the paths at your own roots, rename the functions, add as many as you want.

function ccp {
    Set-Location 'D:\AI_WORKSPACE_Personal'
    claude @args
}

function cca {
    Set-Location 'D:\AI_WORKSPACE_Appsilon'
    claude @args
}

# Add another workspace the same way, then give it a palette in ROOT_PALETTES:
# function ccX { Set-Location 'D:\path\to\workspace'; claude @args }
