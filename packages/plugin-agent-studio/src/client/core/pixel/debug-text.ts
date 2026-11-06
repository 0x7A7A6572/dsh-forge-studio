/**
 * 调试叠层的文本口径：坐标描述、面板行、快照。纯函数，node 可单测。
 * 命中测试与画布渲染同一套槽位几何，不给叠层单独造坐标。
 */
import { readDebugFrozen, type StudioDebugFrame } from './debug-bus.ts'
import { walkGrid } from './wander.ts'
import type { PixelPoint, StudioOccupant, StudioSlot, StudioVisualState } from './scene-types.ts'

/** 行走格分类文案（与 walk-grid.generated 的 kind 注释同口径）。 */
export const WALK_KIND_TEXT: readonly string[] = ['地板(可作目标)', '阻挡', 'carve(仅通行)', '座位格']

const round1 = (value: number): number => Math.round(value * 10) / 10

export interface WalkCellInfo {
  readonly col: number
  readonly row: number
  readonly walkable: boolean
  readonly kind: number
}

export function walkCellAt(point: PixelPoint): WalkCellInfo | null {
  const grid = walkGrid()
  const col = Math.floor(point.x / grid.cell)
  const row = Math.floor(point.y / grid.cell)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null
  const index = row * grid.cols + col
  return { col, row, walkable: grid.blocked[index] === 0, kind: grid.kind[index] }
}

/** 槽位的全部脚底锚点：溢出位按 capacity × anchorStep 展开。 */
export function slotAnchors(slot: StudioSlot): readonly PixelPoint[] {
  return Array.from({ length: Math.max(1, slot.capacity) }, (_, seat) => ({
    x: slot.anchor.x + seat * slot.anchorStep,
    y: slot.anchor.y,
  }))
}

export interface SlotHit {
  readonly slot: StudioSlot
  readonly what: string
  readonly anchor?: PixelPoint
}

/** 命中优先级：工位块 → 锚点近旁。 */
export function hitSlotsAt(point: PixelPoint, slots: readonly StudioSlot[]): readonly SlotHit[] {
  const hits: SlotHit[] = []
  for (const slot of slots) {
    const [sx, sy, sw, sh] = [slot.station.x, slot.station.y, slot.station.w, slot.station.h]
    if (point.x >= sx && point.x < sx + sw && point.y >= sy && point.y < sy + sh) {
      hits.push({ slot, what: '工位块' })
    }
    for (const anchor of slotAnchors(slot)) {
      if (Math.hypot(anchor.x - point.x, anchor.y - point.y) < 4) {
        hits.push({ slot, what: '脚底锚点', anchor })
      }
    }
  }
  return hits
}

export function describePoint(point: PixelPoint, frame: StudioDebugFrame | null): string {
  const x = round1(point.x)
  const y = round1(point.y)
  const parts = [`x=${x} y=${y}`]
  const cell = walkCellAt(point)
  if (cell !== null) {
    parts.push(`格(col ${cell.col},row ${cell.row})`)
    parts.push(cell.walkable ? '可走' : '不可走', WALK_KIND_TEXT[cell.kind] ?? '?')
  }
  if (frame !== null) {
    for (const hit of hitSlotsAt(point, frame.model.scene.slots)) {
      parts.push(`${hit.what}@${hit.slot.id}`)
      const anchor = hit.anchor ?? { x: hit.slot.anchor.x, y: hit.slot.anchor.y }
      parts.push(`相对锚点 dx=${round1(point.x - anchor.x)} dy=${round1(point.y - anchor.y)}`)
    }
  }
  return parts.join(' | ')
}

export interface DebugPanelLine {
  readonly text: string
  readonly state?: StudioVisualState
}

function visibleOccupants(frame: StudioDebugFrame): readonly StudioOccupant[] {
  const overflowCapacity = frame.model.overflowMembers[0]?.slot.capacity ?? 0
  return [
    ...frame.model.occupants,
    ...frame.model.overflowMembers.slice(0, overflowCapacity),
    ...frame.model.roamers,
  ]
}

/** 每位可见成员一行的实时取值：foot/座位差/帧几何/游走状态。 */
export function debugMemberLines(frame: StudioDebugFrame): readonly DebugPanelLine[] {
  const plannedBy = new Map(frame.plan.characters.map((c) => [c.occupant.memberId, c]))
  return visibleOccupants(frame).map((occupant) => {
    const planned = plannedBy.get(occupant.memberId)
    const debug = planned?.debug
    const wander = frame.model.memo.wander?.[occupant.memberId] ?? null
    const seat: PixelPoint = {
      x: occupant.slot.anchor.x + occupant.seat * occupant.slot.anchorStep,
      y: occupant.slot.anchor.y,
    }
    const parts = [
      `${occupant.name}[${occupant.slot.id}] ${occupant.visual}`,
      `foot(${round1(occupant.foot.x)},${round1(occupant.foot.y)})`,
      `dSeat(${round1(occupant.foot.x - seat.x)},${round1(occupant.foot.y - seat.y)})`,
    ]
    if (debug !== undefined) {
      parts.push(
        `f${debug.frameIndex}`,
        debug.flip ? 'flip' : '原生朝向',
        debug.sitting ? '坐' : '站',
        `draw(${round1(planned?.dx ?? 0)},${round1(planned?.dy ?? 0)})`,
      )
      const alpha = planned?.alpha ?? 1
      if (alpha < 1) parts.push(`α${round1(alpha)}`)
    }
    if (wander === null) {
      parts.push('在位')
    } else {
      const waitLeft = Math.max(0, wander.waitUntil - frame.now)
      parts.push(
        wander.returning ? '归位中' : '游走',
        `路径${wander.path.length}`,
        `v${wander.visitIndex}`,
        waitLeft > 0 ? `停${round1(waitLeft / 1000)}s` : '',
      )
    }
    return { text: parts.filter((part) => part !== '').join('  '), state: occupant.visual }
  })
}

export function debugGlobalLines(frame: StudioDebugFrame): readonly string[] {
  const visible = visibleOccupants(frame).length
  return [
    `tick=${frame.tick}  主题=${frame.themeKey}  减动效=${frame.reducedMotion ? '是' : '否'}` +
      `  图集=${frame.atlasAvailable ? '可用' : '缺失'}  冻结=${readDebugFrozen() ? '是' : '否'}`,
    `成员=${frame.model.occupants.length + frame.model.overflowMembers.length + frame.model.roamers.length}  可见=${visible}` +
      `  空位=${frame.model.emptySlots.length}  角色=${frame.plan.characters.length}  特效=${frame.plan.effects.length}`,
  ]
}

export function debugSnapshotText(frame: StudioDebugFrame): string {
  return [...debugGlobalLines(frame), ...debugMemberLines(frame).map((line) => line.text)].join('\n')
}

/** 实验沙盒的成员行：id/name/当前视觉/是否模拟（debug- 前缀）。 */
export interface DebugMemberRow {
  readonly id: string
  readonly name: string
  readonly visual: StudioVisualState
  readonly mock: boolean
}

export function debugMemberRows(frame: StudioDebugFrame | null): readonly DebugMemberRow[] {
  if (frame === null) return []
  return visibleOccupants(frame).map((occupant) => ({
    id: occupant.memberId,
    name: occupant.name,
    visual: occupant.visual,
    mock: occupant.memberId.startsWith('debug-'),
  }))
}
