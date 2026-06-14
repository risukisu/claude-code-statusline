# shimmer.ps1 — sweeps a cyan→mint gradient across text in the terminal,
# the same effect the status line uses for the launch-root name.
#
# Technique (ported from a CSS text-gradient animation): colour each character
# with a 24-bit ANSI code along the gradient
#   0% #06b6d4 · 40% #4ade80 · 60% #06b6d4 · 100% #4ade80
# then shift the phase every frame and redraw the line in place (`r), one full
# sweep every ~3s.
#
# Requires a truecolor terminal (Windows Terminal / VS Code — works in PS 5.1 and 7).
# Usage:  .\shimmer.ps1                      # 15s of "Feedback"
#         .\shimmer.ps1 -Text "risu.pl" -Seconds 30
# Any keypress (or Ctrl+C) stops it early.

param(
    [string]$Text = "Feedback",
    [double]$Seconds = 15
)

$esc  = [char]27
$cyan = 6, 182, 212    # #06b6d4
$mint = 74, 222, 128   # #4ade80

try { [Console]::CursorVisible = $false } catch { }
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$t  = 0.0

try {
    while ($sw.Elapsed.TotalSeconds -lt $Seconds) {
        try { if ([Console]::KeyAvailable) { break } } catch { }

        $sb = [System.Text.StringBuilder]::new()
        for ($i = 0; $i -lt $Text.Length; $i++) {
            # Position along the gradient, sweeping right like the CSS animation
            $phase = (($i / [double]$Text.Length) - $t) % 1
            if ($phase -lt 0) { $phase += 1 }

            # CSS stops: 0% cyan -> 40% mint -> 60% cyan -> 100% mint
            if     ($phase -lt 0.4) { $f = $phase / 0.4 }
            elseif ($phase -lt 0.6) { $f = 1 - (($phase - 0.4) / 0.2) }
            else                    { $f = ($phase - 0.6) / 0.4 }

            $r = [int][math]::Round($cyan[0] + ($mint[0] - $cyan[0]) * $f)
            $g = [int][math]::Round($cyan[1] + ($mint[1] - $cyan[1]) * $f)
            $b = [int][math]::Round($cyan[2] + ($mint[2] - $cyan[2]) * $f)

            [void]$sb.Append("$esc[38;2;$r;$g;${b}m$($Text[$i])")
        }
        [void]$sb.Append("$esc[0m")

        Write-Host -NoNewline ("`r" + $sb.ToString())

        # 0.011/frame at ~30fps ≈ one full sweep every 3s, matching the CSS timing
        $t = ($t + 0.011) % 1
        Start-Sleep -Milliseconds 33
    }
}
finally {
    try { [Console]::CursorVisible = $true } catch { }
    Write-Host "$esc[0m"
}
