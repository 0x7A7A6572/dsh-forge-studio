# -*- coding: utf-8 -*-
"""地板层生成器：输出 .agents/tmp/pixel-assets/worker/地板.png（256×224 整幅）。

版式（自上而下）：
  y ∈ [0, WALL_END)        纯白墙（#f4f4f4）
  y == WALL_END - 1        墙脚线 1px（#566c86）
  y ∈ [WALL_END, FLOOR_END) 暖沙水磨石地板（#ffcd75 底 + 白/橙碎点）
  y ∈ [FLOOR_END, 224)     底部收白（#f4f4f4）

改完分界线/配色后重跑管线（顺序不能反，walk-grid 依赖新 bg）：
  python packages/plugin-agent-studio/scripts/pixel-office-floor.py
  node  packages/plugin-agent-studio/scripts/build-pixel-atlas.mjs --all
  pnpm  --filter ./packages/plugin-agent-studio run build
"""
from PIL import Image
import os

W, H = 256, 224
WALL_END = 36      # 白墙到 y=WALL_END-1；地板从 y=WALL_END 开始
FLOOR_END = 176    # 地板到 y=FLOOR_END-1；以下收白

WALL = (0xF4, 0xF4, 0xF4, 255)
BASEBOARD = (0x56, 0x6C, 0x86, 255)
SAND = (0xFF, 0xCD, 0x75, 255)
FLECK_WHITE = (0xF4, 0xF4, 0xF4, 255)
FLECK_ORANGE = (0xEF, 0x7D, 0x57, 255)

HERE = os.path.dirname(os.path.abspath(__file__))
# worker 目录在仓库根（与 build-pixel-atlas.mjs 的 resolveWorkerDir 同口径，向上找）
OUT = None
_dir = HERE
for _ in range(12):
    cand = os.path.join(_dir, '.agents', 'tmp', 'pixel-assets', 'worker')
    if os.path.isdir(cand):
        OUT = os.path.join(cand, '地板.png')
        break
    parent = os.path.dirname(_dir)
    if parent == _dir:
        break
    _dir = parent
if OUT is None:
    raise SystemExit('worker dir not found: .agents/tmp/pixel-assets/worker')

im = Image.new('RGBA', (W, H), WALL)
px = im.load()
for y in range(WALL_END, FLOOR_END):
    for x in range(W):
        h = (x * 73856093 ^ y * 19349663) & 0xFFFFFFFF   # 确定性碎点（重跑不变）
        if h % 47 == 0:
            px[x, y] = FLECK_WHITE
        elif h % 71 == 0:
            px[x, y] = FLECK_ORANGE
        else:
            px[x, y] = SAND
for x in range(W):
    px[x, WALL_END - 1] = BASEBOARD

os.makedirs(os.path.dirname(OUT), exist_ok=True)
im.save(OUT)
print('wrote', os.path.normpath(OUT), im.size)
