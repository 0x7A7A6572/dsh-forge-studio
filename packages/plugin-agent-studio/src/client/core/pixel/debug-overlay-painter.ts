/**
 * 调试叠层的画布绘制：网格/槽位几何/行走网格/路径/命中区。
 * 只读 debug-bus 的帧快照，不自己推导任何坐标；缩放按显示盒对 256×224 拉伸。
 */
import { findAtlasEntry } from './atlas.ts'
import {
  readDebugFrame,
  readDebugFrozen,
  readDebugSettings,
  type StudioDebugLayerKey,
} from './debug-bus.ts'
import { labelAnchorOf } from './labels.ts'
import { walkGrid } from './wander.ts'
import type { PixelPoint, StudioOccupant, StudioVisualState } from './scene-types.ts'

const CANVAS_W = 256
const CANVAS_H = 224

const VISUAL_COLOR: Record<StudioVisualState, string> = {
  idle: '#9aa7b5',
  working: '#4da3ff',
  done: '#58d68d',
  error: '#ff6b6b',
  provisioning: '#ffd166',
}

const WALK_FILL: readonly string[] = [
  'rgba(60,220,140,.16)', 'rgba(255,60,60,.20)', 'rgba(90,170,255,.30)', 'rgba(255,190,60,.34)',
]

function seatPointOf(occupant: StudioOccupant): PixelPoint {
  return {
    x: occupant.slot.anchor.x + occupant.seat * occupant.slot.anchorStep,
    y: occupant.slot.anchor.y,
  }
}

function labelWithBackground(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  const width = ctx.measureText(text).width + 4
  ctx.fillStyle = 'rgba(8,12,18,.72)'
  ctx.fillRect(x, y, width, 12)
  ctx.fillStyle = 'rgba(235,244,252,.95)'
  ctx.fillText(text, x + 2, y + 9)
}

function crosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  radius: number,
): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - radius, y + 0.5)
  ctx.lineTo(x + radius, y + 0.5)
  ctx.moveTo(x + 0.5, y - radius)
  ctx.lineTo(x + 0.5, y + radius)
  ctx.stroke()
}

export function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  size: { readonly width: number; readonly height: number },
  hover: PixelPoint | null,
): void {
  ctx.clearRect(0, 0, size.width, size.height)
  const frame = readDebugFrame()
  const settings = readDebugSettings()
  if (frame === null) {
    ctx.fillStyle = 'rgba(215,228,240,.8)'
    ctx.font = '11px Consolas, monospace'
    ctx.fillText('等待第一帧渲染…', 10, 18)
    return
  }
  const kx = size.width / CANVAS_W
  const ky = size.height / CANVAS_H
  const draw = (layer: StudioDebugLayerKey, paint: () => void): void => {
    if (!settings[layer]) return
    paint()
  }

  draw('showWalk', () => {
    const grid = walkGrid()
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const index = row * grid.cols + col
        const kind = grid.kind[index]
        const walkable = grid.blocked[index] === 0
        ctx.fillStyle = walkable ? WALK_FILL[kind] ?? WALK_FILL[0] : WALK_FILL[1]
        ctx.fillRect(col * grid.cell * kx, row * grid.cell * ky, grid.cell * kx, grid.cell * ky)
      }
    }
  })

  draw('showGrid', () => {
    ctx.lineWidth = 1
    for (let gx = 0; gx <= CANVAS_W; gx += 8) {
      ctx.strokeStyle = gx % 32 === 0 ? 'rgba(90,200,255,.30)' : 'rgba(255,255,255,.10)'
      ctx.beginPath()
      ctx.moveTo(gx * kx + 0.5, 0)
      ctx.lineTo(gx * kx + 0.5, size.height)
      ctx.stroke()
    }
    for (let gy = 0; gy <= CANVAS_H; gy += 8) {
      ctx.strokeStyle = gy % 32 === 0 ? 'rgba(90,200,255,.30)' : 'rgba(255,255,255,.10)'
      ctx.beginPath()
      ctx.moveTo(0, gy * ky + 0.5)
      ctx.lineTo(size.width, gy * ky + 0.5)
      ctx.stroke()
    }
    ctx.font = '9px Consolas, monospace'
    ctx.fillStyle = 'rgba(200,235,255,.75)'
    for (let gx = 0; gx <= CANVAS_W; gx += 32) ctx.fillText(String(gx), gx * kx + 2, 9)
    for (let gy = 32; gy <= CANVAS_H; gy += 32) ctx.fillText(String(gy), 2, gy * ky - 2)
  })

  draw('showSlots', () => {
    ctx.font = '9px Consolas, monospace'
    for (const slot of frame.model.scene.slots) {
      ctx.strokeStyle = 'rgba(0,225,255,.65)'
      ctx.strokeRect(
        slot.station.x * kx + 0.5, slot.station.y * ky + 0.5,
        slot.station.w * kx - 1, slot.station.h * ky - 1,
      )
      crosshair(ctx, slot.anchor.x * kx, slot.anchor.y * ky, 'rgba(255,70,70,.95)', 4)
      labelWithBackground(ctx, slot.id.replace('seat-', ''), slot.station.x * kx, slot.station.y * ky + 1)
    }
  })

  const plannedBy = new Map(frame.plan.characters.map((c) => [c.occupant.memberId, c]))
  const overflowCapacity = frame.model.overflowMembers[0]?.slot.capacity ?? 0
  const visible = [
    ...frame.model.occupants,
    ...frame.model.overflowMembers.slice(0, overflowCapacity),
    ...frame.model.roamers,
  ]

  draw('showPath', () => {
    ctx.font = '9px Consolas, monospace'
    for (const occupant of visible) {
      const wander = frame.model.memo.wander?.[occupant.memberId] ?? null
      if (wander === null) continue
      const color = VISUAL_COLOR[occupant.visual]
      const seat = seatPointOf(occupant)
      ctx.strokeStyle = 'rgba(255,255,255,.35)'
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(occupant.foot.x * kx, occupant.foot.y * ky)
      ctx.lineTo(seat.x * kx, seat.y * ky)
      ctx.stroke()
      ctx.setLineDash([])
      if (wander.path.length > 0) {
        ctx.strokeStyle = color
        ctx.beginPath()
        ctx.moveTo(wander.foot.x * kx, wander.foot.y * ky)
        for (const waypoint of wander.path) ctx.lineTo(waypoint.x * kx, waypoint.y * ky)
        ctx.stroke()
      }
      if (wander.target !== null) {
        ctx.strokeStyle = color
        ctx.strokeRect(
          wander.target.x * kx - 3, wander.target.y * ky - 3, 6, 6,
        )
      }
      ctx.fillStyle = 'rgba(255,255,255,.5)'
      ctx.fillRect(seat.x * kx - 2, seat.y * ky - 2, 4, 4)
    }
  })

  draw('showHitbox', () => {
    ctx.font = '9px Consolas, monospace'
    for (const occupant of visible) {
      const planned = plannedBy.get(occupant.memberId)
      const entry = findAtlasEntry(
        planned !== undefined ? `${occupant.character.entry}-${planned.pose}` : occupant.character.entry,
      )
      const w = (entry?.w ?? 16) * kx
      const h = (entry?.h ?? 24) * ky
      ctx.strokeStyle = 'rgba(120,220,255,.8)'
      if (planned !== undefined) {
        ctx.strokeRect(planned.dx * kx + 0.5, planned.dy * ky + 0.5, w - 1, h - 1)
      } else {
        ctx.strokeRect(
          (occupant.foot.x - w / 2) * kx + 0.5, (occupant.foot.y - h) * ky + 0.5,
          w - 1, h - 1,
        )
      }
      ctx.strokeStyle = 'rgba(255,255,255,.55)'
      ctx.strokeRect(
        (occupant.foot.x - 9) * kx + 0.5, (occupant.foot.y - 28) * ky + 0.5,
        18 * kx - 1, 28 * ky - 1,
      )
      const wander = frame.model.memo.wander?.[occupant.memberId] ?? null
      if (wander !== null) {
        ctx.strokeStyle = 'rgba(255,120,120,.4)'
        ctx.beginPath()
        ctx.arc(occupant.foot.x * kx, occupant.foot.y * ky, 12 * ((kx + ky) / 2), 0, Math.PI * 2)
        ctx.stroke()
      }
      const label = labelAnchorOf(occupant)
      ctx.fillStyle = 'rgba(255,255,255,.8)'
      ctx.fillRect(label.x * kx - 1, label.y * ky - 1, 3, 3)
    }
  })

  for (const occupant of visible) {
    const color = VISUAL_COLOR[occupant.visual]
    crosshair(ctx, occupant.foot.x * kx, occupant.foot.y * ky, color, 5)
  }

  if (hover !== null) {
    ctx.strokeStyle = 'rgba(255,255,255,.85)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hover.x * kx, 0)
    ctx.lineTo(hover.x * kx, size.height)
    ctx.moveTo(0, hover.y * ky)
    ctx.lineTo(size.width, hover.y * ky)
    ctx.stroke()
  }
  if (readDebugFrozen()) {
    ctx.font = '10px Consolas, monospace'
    labelWithBackground(ctx, '已冻结 · 步进+1', 6, size.height - 16)
  }
}
