# -*- coding: utf-8 -*-
"""worker 机器人头像打包：源图 5 只精灵 → 21 帧资产表（4 形状 × 5 配色 + 团队章）。

源图 scripts/worker-avatars.source.png（1..64 列，y1..10）：
  sprite0..3 = 可变色的 4 种单体机器人，sprite4 = 团队章（自带三色，不重着色）。
产出 src/client/assets/bot-avatars.png：帧宽 10，帧号 = shape(0..3) × 5 + scheme(0..4)，团队 = 帧 20。

用法：
  python scripts/build-bot-avatars.py                # 产出资产表
  python scripts/build-bot-avatars.py --preview out  # 额外产出双底色放大预览（不入包）
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

FRAME = 13
SHAPES = 4
SCHEMES = 5
BASE = (102, 255, 227, 255)  # 新版 13×13 精灵唯一色 #66ffe3；眼睛是镂空透明像素

# 新版 13×13 精灵的左上角（源图第二行 y23；第一行 10×10 蓝色旧版不使用）
SPRITE_ORIGINS = [(14, 23), (30, 23), (45, 23), (61, 23), (76, 23)]

# 5 种固定配色：与 shape 顺序对齐，前 4 种即各形状的默认配色
SCHEME_HEX = ["#4da6ff", "#a78bfa", "#4ade80", "#fb923c", "#fb7185"]


def hex_rgba(text: str) -> tuple[int, int, int, int]:
    return (int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16), 255)


def load_source() -> tuple[list[Image.Image], Image.Image]:
    here = Path(__file__).resolve().parent
    src = Image.open(here / "worker-avatars.source.png").convert("RGBA")
    sprites: list[Image.Image] = []
    for x, y in SPRITE_ORIGINS:
        frame = src.crop((x, y, x + FRAME, y + FRAME)).copy()
        sprites.append(frame)
    return sprites[:SHAPES], sprites[SHAPES]


def recolor(sprite: Image.Image, target: tuple[int, int, int, int]) -> Image.Image:
    out = Image.new("RGBA", sprite.size, (0, 0, 0, 0))
    for y in range(sprite.height):
        for x in range(sprite.width):
            r, g, b, a = sprite.getpixel((x, y))
            out.putpixel((x, y), target if (r, g, b, a) == BASE else (r, g, b, a))
    return out


def build_sheet() -> tuple[Image.Image, int]:
    shapes, team = load_source()
    count = SHAPES * SCHEMES + 1
    sheet = Image.new("RGBA", (FRAME * count, FRAME), (0, 0, 0, 0))
    for shape_index, shape in enumerate(shapes):
        for scheme in range(SCHEMES):
            frame = recolor(shape, hex_rgba(SCHEME_HEX[scheme]))
            sheet.paste(frame, ((shape_index * SCHEMES + scheme) * FRAME, 0))
    sheet.paste(team, ((count - 1) * FRAME, 0))
    return sheet, count


def build_preview(sheet: Image.Image, count: int, out: Path) -> None:
    scale, pad, gap = 12, 8, 4
    cell = FRAME * scale
    bgs = [(24, 26, 31, 255), (238, 240, 244, 255)]
    width = pad * 2 + count * (cell + gap)
    img = Image.new("RGBA", (width, pad * 2 + len(bgs) * (cell + gap + 14)), (60, 62, 68, 255))
    draw = ImageDraw.Draw(img)
    for row, bg in enumerate(bgs):
        top = pad + row * (cell + gap + 14)
        draw.rectangle((pad, top, width - pad, top + cell), fill=bg)
        for i in range(count):
            frame = sheet.crop((i * FRAME, 0, (i + 1) * FRAME, FRAME)).resize((cell, cell), Image.NEAREST)
            x = pad + i * (cell + gap)
            img.paste(frame, (x, top), frame)
            draw.text((x + 14, top + cell + 1), str(i), fill=(210, 214, 222, 255))
    img.save(out)


def main() -> None:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", default="")
    args = parser.parse_args()
    sheet, count = build_sheet()
    out = here.parent / "src" / "client" / "assets" / "bot-avatars.png"
    sheet.save(out)
    print(f"sheet: {out} ({sheet.width}x{sheet.height}, {count} frames)")
    if args.preview:
        prev = Path(args.preview)
        build_preview(sheet, count, prev)
        print(f"preview: {prev}")


if __name__ == "__main__":
    main()
