"""Rasterize the README SVGs with headless Chromium (Playwright) and build live.gif.

    python rasterize.py png  <in.svg> <out.png>        # preview one SVG
    python rasterize.py gif  <frames-dir> <out.gif>    # frames from build.js --frames

Needs Python with `playwright` (plus `playwright install chromium`) and Pillow.
The GIF shares one palette across frames, keeps the rounded corners transparent, and
lets Pillow store only the changed region of each frame, so the file stays small.
"""
import re
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

FPS = 15


def svg_size(svg: str):
    m = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg)
    return int(m.group(1)), int(m.group(2))


def shoot(page, svg_path: Path, png_path: Path):
    svg = svg_path.read_text(encoding="utf-8")
    w, h = svg_size(svg)
    page.set_viewport_size({"width": w, "height": h})
    page.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
    page.wait_for_timeout(50)
    page.screenshot(path=str(png_path), clip={"x": 0, "y": 0, "width": w, "height": h}, omit_background=True)


def to_gif(pngs, out: Path):
    frames = [Image.open(p).convert("RGBA") for p in pngs]
    # One shared palette (255 colours) built from a strip of sampled frames; index 255 = transparent.
    sample = frames[:: max(1, len(frames) // 8)]
    strip = Image.new("RGB", (sample[0].width, sample[0].height * len(sample)))
    for i, f in enumerate(sample):
        strip.paste(f.convert("RGB"), (0, i * f.height))
    pal_img = strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette = pal_img.getpalette()[: 255 * 3] + [0, 0, 0]
    pal_img.putpalette(palette)
    out_frames = []
    for f in frames:
        p = f.convert("RGB").quantize(palette=pal_img, dither=Image.Dither.NONE)
        mask = f.getchannel("A").point(lambda a: 255 if a < 128 else 0)
        p.paste(255, mask=mask)
        out_frames.append(p)
    out_frames[0].save(
        out, save_all=True, append_images=out_frames[1:], duration=int(1000 / FPS), loop=0,
        transparency=255, disposal=1, optimize=False,
    )


def main():
    mode, src, dst = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(device_scale_factor=1)
        if mode == "png":
            shoot(page, src, dst)
        else:
            pngs = []
            for svg in sorted(src.glob("frame-*.svg")):
                png = svg.with_suffix(".png")
                shoot(page, svg, png)
                pngs.append(png)
            to_gif(pngs, dst)
        browser.close()
    print(f"wrote {dst}")


if __name__ == "__main__":
    main()
