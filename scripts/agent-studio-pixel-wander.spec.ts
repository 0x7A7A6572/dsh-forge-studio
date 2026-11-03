import { describe, expect, it } from 'vitest'
import {
  advanceWander,
  isFloorCell,
  pickTarget,
  planPath,
  TARGET_KIND_FLOOR,
  walkGrid,
} from '../packages/plugin-agent-studio/src/client/core/pixel/wander.ts'
import {
  WALK_GRID_CONNECTOR,
  WALK_GRID_CONNECTOR_COST,
  WALK_GRID_KIND,
} from '../packages/plugin-agent-studio/src/client/core/pixel/walk-grid.generated.ts'
import {
  composeStageModel,
  resolveAvoidance,
  type StudioRosterMember,
} from '../packages/plugin-agent-studio/src/client/core/pixel/studio-model.ts'
import { OFFICE_SCENE, SIT_FRAME_DROP, SIT_FRAME_SHIFT_WEST } from '../packages/plugin-agent-studio/src/client/core/pixel/scene-office.ts'
import type { StudioMemo, StudioWanderState } from '../packages/plugin-agent-studio/src/client/core/pixel/scene-types.ts'
import { labelAnchorOf } from '../packages/plugin-agent-studio/src/client/core/pixel/labels.ts'
import { drawStageFrame, planFrame } from '../packages/plugin-agent-studio/src/client/core/pixel/painter-frame.ts'
import { findAtlasEntry } from '../packages/plugin-agent-studio/src/client/core/pixel/atlas.ts'
import { composeAvatar } from '../packages/plugin-agent-studio/src/client/core/pixel/avatar-sprite.ts'
import type { StagePalette } from '../packages/plugin-agent-studio/src/client/core/pixel/stage-tokens.ts'

const grid = walkGrid()
const seatA1 = OFFICE_SCENE.slots.find((slot) => slot.id === 'seat-A1')!.anchor
const FRAME_MS = 1000 / 12

function member(overrides: Partial<StudioRosterMember> & { id: string }): StudioRosterMember {
  return { name: overrides.id, role: 'teammate', phase: 'active', running: false, ...overrides }
}

function palette(): StagePalette {
  return {
    lutTargets: [],
    fallbackColors: {},
    accents: [],
    ui: Object.fromEntries(
      ['lampRunning', 'lampIdle', 'lampError', 'lampDone', 'screenDark', 'screenOn',
        'screenText', 'snow', 'check', 'scan', 'star'].map((key) => [key, `test-${key}`]),
    ),
  } as unknown as StagePalette
}

function step(
  state: StudioWanderState | null,
  opts: { seat: { x: number; y: number }; idle: boolean; frame: number; seed?: string },
): ReturnType<typeof advanceWander> {
  return advanceWander(state, {
    memberId: 'm1',
    seed: opts.seed ?? 'm1',
    grid,
    seat: opts.seat,
    idle: opts.idle,
    now: opts.frame * FRAME_MS,
    dtMs: opts.frame === 0 ? 0 : FRAME_MS,
  })
}

describe('agent studio wander (卡16 core invariants)', () => {
  it('idle members leave their seat (carved exit, no P0 deadlock)', () => {
    const seatIndex = Math.floor(seatA1.y / grid.cell) * grid.cols +
      Math.floor(seatA1.x / grid.cell)
    // 座位 foot 格 = kind 3：可通行（WALK_GRID=0），但不是原始地板（不可作游走目标）。
    expect(grid.blocked[seatIndex]).toBe(0)
    expect(grid.kind[seatIndex]).toBe(3)
    const start = step(null, { seat: seatA1, idle: true, frame: 0 })
    expect(start.state).not.toBeNull()
    let state = start.state
    let foot = start.foot
    for (let frame = 1; frame <= 40; frame++) {
      const result = step(state, { seat: seatA1, idle: true, frame })
      state = result.state
      foot = result.foot
      // 逐帧：脚底所在格必须可走（出座通道 carve 已并入 WALK_GRID）。
      expect(grid.blocked[Math.floor(foot.y / grid.cell) * grid.cols +
        Math.floor(foot.x / grid.cell)]).toBe(0)
    }
    // 40 帧 × 10px/s ≈ 33px：确实离开座位。
    expect(state).not.toBeNull()
    expect(foot).not.toEqual(seatA1)
  })

  it('pickTarget only returns original floor cells in the same component (all 11 seats)', () => {
    const a = pickTarget('m1', 0, grid, seatA1)
    const b = pickTarget('m1', 0, grid, seatA1)
    expect(a).toEqual(b)
    expect(a).not.toBeNull()
    expect(Math.hypot(a!.x - seatA1.x, a!.y - seatA1.y)).toBeGreaterThanOrEqual(24)
    const aCol = Math.floor(a!.x / grid.cell)
    const aRow = Math.floor(a!.y / grid.cell)
    // 目标必须是原始地板（kind===0），不能是 carve（出座/连接通道）或 seat。
    expect(grid.kind[aRow * grid.cols + aCol]).toBe(TARGET_KIND_FLOOR)
    expect(isFloorCell(grid, aCol, aRow)).toBe(true)
    const path = planPath(grid, seatA1, a!)
    expect(path).not.toBeNull()
    expect(path!.length).toBeGreaterThan(0)
    for (const point of path!) {
      expect(grid.blocked[Math.floor(point.y / grid.cell) * grid.cols +
        Math.floor(point.x / grid.cell)]).toBe(0)
    }
    // 生成期门禁的运行时镜像：11 个座位/lead/overflow 都能选出同分量原始地板目标。
    const seats = OFFICE_SCENE.slots.flatMap((slot) =>
      slot.capacity > 1
        ? [slot.anchor, ...Array.from({ length: slot.capacity - 1 }, (_, i) => ({
            x: slot.anchor.x + (i + 1) * slot.anchorStep,
            y: slot.anchor.y,
          }))]
        : [slot.anchor])
    for (const seat of seats) {
      const target = pickTarget('probe-seat', 0, grid, seat)
      expect(target, `seat ${seat.x},${seat.y}`).not.toBeNull()
      const col = Math.floor(target!.x / grid.cell)
      const row = Math.floor(target!.y / grid.cell)
      expect(isFloorCell(grid, col, row), `seat ${seat.x},${seat.y} target kind`).toBe(true)
      expect(planPath(grid, seat, target!)).not.toBeNull()
    }
    // 连接通道正向断言：只允许 kind===2 的 carve 格，总代价 ≤3（暖沙地板单色判定后
    // 家具严格 blocked，连通工位边缘口袋需 3 格；超过预算的孤立口袋生成期降级为 blocked，
    // 不横穿工位内部——旧实现横穿 A/C 工位的问题仍然被卡住）。
    expect(WALK_GRID_CONNECTOR_COST).toBeLessThanOrEqual(3)
    for (const cell of WALK_GRID_CONNECTOR) {
      expect(grid.kind[cell]).toBe(2)
      expect(grid.blocked[cell]).toBe(0)
    }
    expect(WALK_GRID_KIND.length).toBe(grid.cols * grid.rows)
  })

  it('returns to seat along walkable cells when not idle (converges, no wall clipping)', () => {
    const away = pickTarget('m1', 0, grid, seatA1)!
    let state: StudioWanderState | null = {
      visitIndex: 0, target: away, path: [], foot: away, waitUntil: 0, returning: false,
    }
    let foot = away
    let ticks = 0
    for (; ticks < 400; ticks++) {
      const result = step(state, { seat: seatA1, idle: false, frame: ticks })
      state = result.state
      foot = result.foot
      // 逐帧断言：脚底所在格必须可走（归位不穿墙）。
      expect(grid.blocked[Math.floor(foot.y / grid.cell) * grid.cols +
        Math.floor(foot.x / grid.cell)]).toBe(0)
      if (state === null) break
    }
    expect(state).toBeNull()
    expect(foot).toEqual(seatA1)
    expect(ticks).toBeLessThan(400)
  })

  it('avoidance is deterministic: seated wins, larger memberId yields, fallback revalidates', () => {
    // 在座者（prevFoot 缺省）先登记：即使 memberId 更大，游走者也要让。
    const seated = { memberId: 'm9', foot: { x: 100, y: 150 }, seat: { x: 100, y: 150 } }
    const mover = {
      memberId: 'm2', foot: { x: 104, y: 150 }, seat: { x: 40, y: 160 }, prevFoot: { x: 80, y: 150 },
    }
    const first = resolveAvoidance([mover, seated])
    expect(first.get('m9')!.yielded).toBe(false)
    expect(first.get('m9')!.foot).toEqual({ x: 100, y: 150 })
    expect(first.get('m2')!.yielded).toBe(true)
    expect(first.get('m2')!.foot).toEqual({ x: 80, y: 150 })
    // 两个游走者靠近：memberId 大者退让（m10 让 m2）。
    const second = resolveAvoidance([
      { memberId: 'm10', foot: { x: 64, y: 150 }, seat: { x: 20, y: 160 }, prevFoot: { x: 5, y: 200 } },
      { memberId: 'm2', foot: { x: 60, y: 150 }, seat: { x: 10, y: 160 }, prevFoot: { x: 90, y: 200 } },
    ])
    expect(second.get('m2')!.yielded).toBe(false)
    expect(second.get('m10')!.yielded).toBe(true)
    expect(second.get('m10')!.foot).toEqual({ x: 5, y: 200 })
    // 退让后重验：上一帧 foot 仍冲突 → 继续退到自己的座位。
    const third = resolveAvoidance([
      { memberId: 'm1', foot: { x: 100, y: 150 }, seat: { x: 100, y: 150 } },
      { memberId: 'm2', foot: { x: 104, y: 150 }, seat: { x: 300, y: 300 }, prevFoot: { x: 106, y: 150 } },
    ])
    expect(third.get('m2')!.foot).toEqual({ x: 300, y: 300 })
    // 相同输入重复调用结果一致（确定性）。
    expect(resolveAvoidance([mover, seated]).get('m2')!.foot).toEqual(first.get('m2')!.foot)
  })

  it('reducedMotion keeps feet pinned to seat anchors (overflow keeps seat offset)', () => {
    const roster: StudioRosterMember[] = [
      member({ id: 'lead-1', role: 'lead' }),
      // 全员 working：非 idle 才认领工位（共享工位口径）。
      ...Array.from({ length: 10 }, (_, i) => member({ id: `m${i + 1}`, running: true })),
    ]
    const base = { roster, scene: OFFICE_SCENE, atlasAvailable: true, reducedMotion: true }
    let model = composeStageModel({ ...base, now: 0 })
    const overflow = model.overflowMembers.find((o) => o.memberId === 'm10')!
    expect(overflow.seat).toBe(1)
    expect(overflow.foot).toEqual({ x: 61, y: 151 })
    let memo: StudioMemo = model.memo
    for (let frame = 1; frame <= 12; frame++) {
      model = composeStageModel({ ...base, now: frame * FRAME_MS, memo })
      memo = model.memo
      for (const occupant of [...model.occupants, ...model.overflowMembers]) {
        expect(occupant.foot).toEqual({
          x: occupant.slot.anchor.x + occupant.seat * occupant.slot.anchorStep,
          y: occupant.slot.anchor.y,
        })
      }
    }
  })

  it('painter wiring: drawImage follows foot, chair crop only at seat, overflow seat offset', () => {
    const roster: StudioRosterMember[] = [
      member({ id: 'lead-1', role: 'lead' }),
      ...Array.from({ length: 10 }, (_, i) => member({ id: `m${i + 1}`, running: true })),
    ]
    // previousSlots 注入 A1..D2：让 m1 落在 chair 座位（默认就近会先占 B2..）。
    const seatIds = ['seat-A1', 'seat-A2', 'seat-B1', 'seat-B2', 'seat-C1', 'seat-C2', 'seat-D1', 'seat-D2']
    const memo = {
      previousSlots: Object.fromEntries(seatIds.map((id, i) => [`m${i + 1}`, id])),
    }
    const model = composeStageModel({ roster, scene: OFFICE_SCENE, atlasAvailable: false, now: 0, memo })
    const themeKey = 'test'
    const caches = {
      variant: new Map(),
      fallback: new Map(),
      tickStart: new Map<string, number>(),
    }
    // 预填 fallback 画布缓存（按 painter-frame 的 key 口径），避免测试触 DOM。
    // 相同精灵会共享同一缓存画布，故绘制项按 plan.characters 顺序对位，不按 source 身份。
    const spriteMarker = { tag: 'sprite' }
    for (const occupant of [...model.occupants, ...model.overflowMembers]) {
      const sprite = composeAvatar(occupant.memberId, occupant.memberId)
      const key = `${themeKey}:${sprite.width}x${sprite.height}:${[...sprite.data].join(',')}`
      caches.fallback.set(key, spriteMarker)
    }
    interface DrawOp {
      args: number[]
      spriteLeft: number
      spriteTop: number
    }
    const record = (target: typeof model): DrawOp[] => {
      const ops: DrawOp[] = []
      const transform = { tx: 0, ty: 0, sx: 1, sy: 1 }
      const stack: Array<typeof transform> = []
      const ctx = {
        clearRect: () => {},
        save: () => { stack.push({ ...transform }) },
        restore: () => {
          const saved = stack.pop()
          if (saved !== undefined) Object.assign(transform, saved)
        },
        translate: (x: number, y: number) => {
          transform.tx += transform.sx * x
          transform.ty += transform.sy * y
        },
        scale: (x: number, y: number) => {
          transform.sx *= x
          transform.sy *= y
        },
        drawImage: (_source: unknown, ...args: number[]) => {
          // 8 参 = 裁剪绘制：sx,sy,sw,sh,dx,dy,dw,dh；4 参 = dx,dy,dw,dh。
          const destX = args.length === 8 ? args[4] : args[0]
          const destY = args.length === 8 ? args[5] : args[1]
          const dw = args.length === 8 ? args[6] : args[2]
          ops.push({
            args,
            // 水平镜像时 x 轴反向：精灵左边界 = tx − (destX + dw)，否则 tx + sx × destX。
            spriteLeft: transform.sx < 0
              ? transform.tx - (destX + dw)
              : transform.tx + transform.sx * destX,
            spriteTop: transform.ty + transform.sy * destY,
          })
        },
        fillRect: () => {},
        set globalAlpha(_value: number) {},
        get globalAlpha() { return 1 },
        set fillStyle(_value: string) {},
        get fillStyle() { return '' },
      } as unknown as CanvasRenderingContext2D
      drawStageFrame(ctx, target, {
        tick: 0,
        now: 0,
        themeKey,
        palette: palette(),
        assets: { charsDecoded: undefined },
        reducedMotion: false,
        caches,
      })
      return ops
    }
    /** 绘制项按 z 序（foot.y）执行，计划项同样按 foot.y 排序后配对。 */
    const drawn = (target: typeof model) => {
      const plan = planFrame(target, 0, 0, palette(), false, new Map())
      const ops = record(target)
      expect(ops.length).toBe(plan.characters.length)
      const ordered = [...plan.characters].sort((a, b) => a.occupant.foot.y - b.occupant.foot.y)
      return new Map(ordered.map((character, index) => [
        character.occupant.memberId,
        { character, op: ops[index]! },
      ]))
    }
    const m1 = model.occupants.find((o) => o.memberId === 'm1')!
    const m1Pivot = findAtlasEntry(`${m1.character.entry}-sit`)!
    // 在位（foot = 座位）：坐姿帧；坐姿帧原生朝东 → 西椅不镜像（2 参）；
    // dx/dy 跟随 foot + 坐姿下移 + 西椅右移 5px。
    const seated = drawn(model).get('m1')!
    expect(seated.character.pose).toBe('sit')
    expect(seated.character.flip).toBe(false)
    expect(seated.character.debug.sitShift).toBe(SIT_FRAME_SHIFT_WEST)
    expect(seated.op.args.length).toBe(2)
    expect(seated.op.spriteLeft).toBe(m1.foot.x - m1Pivot.pivotX + SIT_FRAME_SHIFT_WEST)
    expect(seated.op.spriteTop).toBe(m1.foot.y - m1Pivot.pivotY + SIT_FRAME_DROP)
    // 偏离座位：drawImage 的 x/y 跟随新 foot（走路帧 2 参，朝向按 moveDx=0 保持默认）。
    const movedFoot = { x: 80, y: 164 }
    const moved = {
      ...model,
      occupants: model.occupants.map((occupant) =>
        occupant.memberId === 'm1'
          ? { ...occupant, foot: movedFoot, seated: false, moveDx: 0 }
          : occupant),
    }
    const m1WalkPivot = findAtlasEntry(`${m1.character.entry}-walk-1`)!
    const standing = drawn(moved).get('m1')!
    expect(standing.character.pose).toBe('walk-1')
    expect(standing.op.args.length).toBe(2)
    expect(standing.op.spriteLeft).toBe(movedFoot.x - m1WalkPivot.pivotX)
    expect(standing.op.spriteTop).toBe(movedFoot.y - m1WalkPivot.pivotY)
    // overflow 第 2 座：锚点 = 46 + 1×15 = 61，绘制跟随座位偏移。
    const m10 = model.overflowMembers.find((o) => o.memberId === 'm10')!
    const m10Pivot = findAtlasEntry(`${m10.character.entry}-sit`)!
    expect(m10.foot).toEqual({ x: 61, y: 151 })
    const overflow = drawn(model).get('m10')!
    expect(overflow.op.spriteLeft).toBe(61 - m10Pivot.pivotX)
    expect(overflow.op.spriteTop).toBe(151 - m10Pivot.pivotY + SIT_FRAME_DROP)
  })

  it('planPath returns null for unreachable targets or a blocked start cell', () => {
    const floor = { x: 130, y: 172 }
    // 目标必须是可走格；原始地板格（kind===0）才有资格做游走目标。
    expect(isFloorCell(grid, Math.floor(floor.x / grid.cell), Math.floor(floor.y / grid.cell))).toBe(true)
    expect(planPath(grid, floor, { x: 4, y: 4 })).toBeNull()
    // 起点在墙区/家具内：不再从墙里 BFS 穿出去。
    expect(planPath(grid, { x: 4, y: 4 }, floor)).toBeNull()
    // 目标格是 blocked（bg 非地板色 = 家具/隔断）：不可达。
    const desk = { x: 60, y: 90 }
    expect(grid.kind[Math.floor(desk.y / grid.cell) * grid.cols +
      Math.floor(desk.x / grid.cell)]).toBe(1)
    expect(planPath(grid, floor, desk)).toBeNull()
    // 同格：空路径（已经在座位格内）。
    expect(planPath(grid, floor, { x: floor.x + 2, y: floor.y + 2 })).toEqual([])
  })

  it('label anchor uses the core head-top formula and tracks foot', () => {
    const model = composeStageModel({
      roster: [member({ id: 'm1', running: true })],
      scene: OFFICE_SCENE,
      atlasAvailable: true,
      now: 0,
      // 注入 chair 座位：默认就近认领会先占 B2。
      memo: { previousSlots: { m1: 'seat-A1' } },
    })
    const occupant = model.occupants[0]
    // 在座非 idle = 坐姿帧：头部随 SIT_FRAME_DROP 下沉 9px，标签同步下移。
    const sitHeight = findAtlasEntry(`${occupant.character.entry}-sit`)!.h
    expect(occupant.seated).toBe(true)
    expect(occupant.visual).toBe('working')
    expect(occupant.foot).toEqual(seatA1)
    expect(labelAnchorOf(occupant)).toEqual({
      x: seatA1.x,
      y: seatA1.y - sitHeight + SIT_FRAME_DROP - 4,
    })
    // 离座 = 行走帧（比坐姿高 1-3px）：标签贴行走精灵顶。
    const moved = { ...occupant, foot: { x: 130, y: 172 }, seated: false }
    const walkHeight = findAtlasEntry(`${moved.character.entry}-walk-1`)!.h
    expect(labelAnchorOf(moved)).toEqual({ x: 130, y: 172 - walkHeight - 4 })
    // 在座 idle = 站姿帧（坐姿只在非 idle 生效，与 painter 口径一致）。
    const idleAtSeat = { ...occupant, visual: 'idle' as const }
    const idleHeight = findAtlasEntry(`${idleAtSeat.character.entry}-idle`)!.h
    expect(labelAnchorOf(idleAtSeat)).toEqual({ x: seatA1.x, y: seatA1.y - idleHeight - 4 })
  })
})
