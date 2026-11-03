/**
 * roster + 场景包 → StudioStageModel（§6.4）：纯函数，不 import react。
 * 工位共享口径：非 idle 才占工位（工位数 = 并发干活上限），idle 自由游走不占位；
 * 同一次干活期间不挪窝，新一次干活就近取空闲工位，满了进候客区。
 * binding 只决定空态文案，由视图层处理；avatarSeed 解析由 hooks 层完成后传入。
 */
import type {
  CharacterSprite,
  PixelPoint,
  StudioMemo,
  StudioOccupant,
  StudioScenePack,
  StudioSlot,
  StudioStageModel,
  StudioVisualState,
  StudioWanderState,
} from './scene-types.ts'
import { advanceVisualState, type StudioMemberPhase } from './state-machine.ts'
import {
  assignCharacters,
  composeAvatar,
  BUILTIN_AVATAR_THEME,
  type AvatarThemeSpec,
} from './avatar-sprite.ts'
import { advanceWander, walkGrid } from './wander.ts'

/** 模型输入的成员行：投影字段 + hooks 层解析好的 avatarSeed。 */
export interface StudioRosterMember {
  readonly id: string
  readonly name: string
  readonly role: 'lead' | 'teammate'
  readonly phase: StudioMemberPhase
  readonly running?: boolean
  readonly error?: string
  readonly model?: string
  readonly avatarSeed?: string
}

export interface StudioModelInput {
  readonly roster: readonly StudioRosterMember[]
  readonly scene: StudioScenePack
  readonly atlasAvailable: boolean
  readonly now: number
  readonly theme?: AvatarThemeSpec
  /** 上一帧的 model.memo 原样传回；首帧不传。 */
  readonly memo?: StudioMemo
  /** 减动效：完全不游走（foot = 座位锚点，常坐）。 */
  readonly reducedMotion?: boolean
}

function effectiveSeed(member: StudioRosterMember): string {
  const seed = member.avatarSeed ?? ''
  return seed !== 'default' && seed.trim() !== '' ? seed : member.id
}

/** 空闲游走成员的伪槽位：无工位无坐姿区域；不进 scene.slots。 */
export const ROAMING_SLOT: StudioSlot = {
  id: 'roaming',
  role: 'member',
  anchor: { x: 0, y: 0 },
  station: { x: 0, y: 0, w: 0, h: 0 },
  capacity: 1,
  anchorStep: 0,
  order: Number.MAX_SAFE_INTEGER,
}

/** 槽位脚底锚点（seat 序号用于 overflow 多座位平移）。 */
function seatPointOfSlot(slot: StudioSlot, seat = 0): PixelPoint {
  return { x: slot.anchor.x + seat * slot.anchorStep, y: slot.anchor.y }
}

function visualFor(
  member: StudioRosterMember,
  memo: StudioMemo,
  scene: StudioScenePack,
  now: number,
): { visual: StudioVisualState; doneUntil?: number } {
  const prev = {
    visual: memo.previousVisuals?.[member.id] ?? 'idle',
    doneUntil: memo.doneUntil?.[member.id],
  }
  return advanceVisualState(
    prev,
    { phase: member.phase, running: member.running },
    now,
    scene.states,
    scene.clips.done.holdMs,
  )
}

/** leader 固定形象 = 白胡子（char-3），不参与 seed 分配。 */
const LEADER_ENTRY = 'char-3'

function characterFor(
  member: StudioRosterMember,
  assignment: { charIndex: number; accent: number; reused: boolean },
  theme: AvatarThemeSpec,
  atlasAvailable: boolean,
): CharacterSprite {
  if (member.role === 'lead') {
    return {
      sheet: 'chars',
      entry: LEADER_ENTRY,
      accent: 0,
      ...(atlasAvailable ? {} : { fallback: composeAvatar(effectiveSeed(member), member.id) }),
    }
  }
  const entry = theme.characters[assignment.charIndex % theme.characters.length]
  const fallback = atlasAvailable ? undefined : composeAvatar(effectiveSeed(member), member.id)
  return {
    sheet: 'chars',
    entry,
    accent: assignment.accent,
    ...(assignment.reused ? { reused: true } : {}),
    ...(fallback !== undefined ? { fallback } : {}),
  }
}

function toOccupant(
  member: StudioRosterMember,
  visual: StudioVisualState,
  character: CharacterSprite,
  slot: StudioSlot,
  seat: number,
  foot: PixelPoint,
): StudioOccupant {
  return {
    memberId: member.id,
    name: member.name,
    role: member.role === 'lead' ? 'lead' : 'member',
    visual,
    character,
    slot,
    seat,
    foot,
    seated: false,
    moveDx: 0,
    ...(member.error !== undefined ? { error: member.error } : {}),
    ...(member.model !== undefined ? { model: member.model } : {}),
  }
}

/** 避让半径（脚距 <12px 视为冲突）与退让后的等待时长。 */
const AVOID_RADIUS_PX = 12
const AVOID_WAIT_MS = 400

/** 脚底是否落在座位锚点上（与 painter 的同位判定同口径）。 */
function atSeat(foot: PixelPoint, seat: PixelPoint): boolean {
  return Math.abs(foot.x - seat.x) < 0.5 && Math.abs(foot.y - seat.y) < 0.5
}

/** 避让候选：本帧候选脚底 + 座位锚点 + 上一帧脚底（缺省 = 上一帧已在座）。 */
export interface AvoidanceCandidate {
  readonly memberId: string
  readonly foot: PixelPoint
  readonly seat: PixelPoint
  /** 上一帧 foot；undefined = 上一帧在座（先占位者优先登记）。 */
  readonly prevFoot?: PixelPoint
}

export interface AvoidanceOutcome {
  readonly foot: PixelPoint
  /** true = 本帧发生退让（foot 不再是候选位置）。 */
  readonly yielded: boolean
}

/** memberId 自然序：m2 < m10（数字后缀参与比较），其余按字典序（避让判定用）。 */
function compareMemberIds(a: string, b: string): number {
  const numeric = /^(.*?)(\d+)$/
  const left = numeric.exec(a)
  const right = numeric.exec(b)
  if (left !== null && right !== null && left[1] === right[1]) {
    const diff = Number(left[2]) - Number(right[2])
    if (diff !== 0) return diff
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * 两两避让（确定性，卡 16）：
 * - 先占位者优先：上一帧在座（prevFoot 缺省）的成员先登记，游走者后判；
 * - 同组内 memberId 大者后判 → 大者退让；
 * - 退让顺序：上一帧 foot → 自己的座位锚点；每退一步都重新校验，仍冲突继续退；
 * - 无路可退则保持候选位置（原地停，由调用方加 waitUntil）。
 */
export function resolveAvoidance(
  candidates: readonly AvoidanceCandidate[],
): Map<string, AvoidanceOutcome> {
  const group = (candidate: AvoidanceCandidate): number =>
    candidate.prevFoot === undefined ? 0 : 1
  const order = [...candidates].sort((a, b) =>
    group(a) - group(b) || compareMemberIds(a.memberId, b.memberId))
  const accepted: PixelPoint[] = []
  const outcomes = new Map<string, AvoidanceOutcome>()
  const clashes = (point: PixelPoint): boolean =>
    accepted.some((a) => Math.hypot(a.x - point.x, a.y - point.y) < AVOID_RADIUS_PX)
  for (const candidate of order) {
    if (!clashes(candidate.foot)) {
      accepted.push(candidate.foot)
      outcomes.set(candidate.memberId, { foot: candidate.foot, yielded: false })
      continue
    }
    // 退让：先回上一帧位置，仍冲突再回自己的座位；每步都重验。
    let chosen = candidate.foot
    const fallbacks: PixelPoint[] = []
    if (candidate.prevFoot !== undefined) fallbacks.push(candidate.prevFoot)
    fallbacks.push(candidate.seat)
    for (const fallback of fallbacks) {
      if (!clashes(fallback)) {
        chosen = fallback
        break
      }
    }
    accepted.push(chosen)
    outcomes.set(candidate.memberId, { foot: chosen, yielded: true })
  }
  return outcomes
}

/** 组装一帧要画的全部事实；返回 memo 供渲染层下一帧原样传回。 */
export function composeStageModel(input: StudioModelInput): StudioStageModel {
  const { roster, scene, atlasAvailable, now, memo = {} } = input
  const theme = input.theme ?? BUILTIN_AVATAR_THEME
  const byOrder = [...scene.slots].sort((a, b) => a.order - b.order)
  const leadSlot = byOrder.find((s) => s.role === 'lead')
  const workstations = byOrder.filter((s) => s.role === 'member' && s.capacity === 1)
  const overflowSlot = byOrder.find((s) => s.role === 'member' && s.capacity > 1)
  // overflow 'hide'：超出工位的成员不显示（只留 DOM 计数）；'queue' 进溢出列表。
  const queueOverflow = scene.overflow === 'queue' && overflowSlot !== undefined
  const stationById = new Map(workstations.map((s) => [s.id, s]))
  const historySlots = memo.previousSlots ?? {}
  const sessionSlots = memo.sessionSlots ?? {}
  const sofaAnchor: PixelPoint = overflowSlot !== undefined
    ? seatPointOfSlot(overflowSlot)
    : { x: scene.canvas.width / 2, y: scene.canvas.height / 2 }

  // 视觉状态先行：谁占工位只看状态，不看位置。
  const visuals = new Map<string, StudioVisualState>()
  const doneUntils: Record<string, number> = {}
  const previousVisuals: Record<string, StudioVisualState> = {}
  for (const member of roster) {
    const state = visualFor(member, memo, scene, now)
    visuals.set(member.id, state.visual)
    if (state.doneUntil !== undefined) doneUntils[member.id] = state.doneUntil
    previousVisuals[member.id] = state.visual
  }

  const assignments = new Map(
    assignCharacters(
      roster.map((m) => ({ id: m.id, seed: effectiveSeed(m) })),
      theme,
    ).map((a) => [a.memberId, a]),
  )

  /** 上一次使用的真实工位（空闲持有判定、坐席脚底回退用）。 */
  const historyOf = (id: string): StudioSlot | undefined => stationById.get(historySlots[id] ?? '')
  /** 上一帧脚底：游走中取游走状态；坐席状态（wander=null）退回槽位锚点。 */
  const lastFootOf = (id: string): PixelPoint | undefined => {
    const wander = memo.wander?.[id] ?? null
    if (wander !== null) return wander.foot
    const slot = historyOf(id)
    return slot !== undefined ? seatPointOfSlot(slot) : undefined
  }

  interface Placement {
    readonly slot?: StudioSlot
    readonly seat: number
    readonly overflow: boolean
    readonly roaming: boolean
    /** 归位目标 / 避让退让点 / 首次出发原点。 */
    readonly home: PixelPoint
    readonly foot: PixelPoint
  }
  const assigned = new Map<string, Placement>()
  const claimed = new Set<string>()
  const teammates = roster.filter((m) => m.role !== 'lead')

  const leadMember = roster.find((m) => m.role === 'lead')
  if (leadMember !== undefined && leadSlot !== undefined) {
    claimed.add(leadSlot.id)
    assigned.set(leadMember.id, {
      slot: leadSlot,
      seat: 0,
      overflow: false,
      roaming: false,
      home: seatPointOfSlot(leadSlot),
      foot: lastFootOf(leadMember.id) ?? seatPointOfSlot(leadSlot),
    })
  }

  // 第一遍：空闲但人还坐在工位锚点上——起身前座位不释放（短暂持有）。
  for (const member of teammates) {
    if (visuals.get(member.id) !== 'idle') continue
    const slot = historyOf(member.id)
    const lastFoot = lastFootOf(member.id)
    if (slot === undefined || lastFoot === undefined) continue
    if (claimed.has(slot.id) || !atSeat(lastFoot, seatPointOfSlot(slot))) continue
    claimed.add(slot.id)
    assigned.set(member.id, {
      slot,
      seat: 0,
      overflow: false,
      roaming: false,
      home: seatPointOfSlot(slot),
      foot: lastFoot,
    })
  }

  // 第二遍：非 idle 认领工位——本次干活会话内沿用，新会话就近取空闲，满了进候客区。
  let overflowCount = 0
  for (const member of teammates) {
    const visual = visuals.get(member.id)
    if (visual === undefined || visual === 'idle') continue
    const lastFoot = lastFootOf(member.id) ?? sofaAnchor
    const sessionSlot = stationById.get(sessionSlots[member.id] ?? '')
    let slot: StudioSlot | undefined
    if (sessionSlot !== undefined && !claimed.has(sessionSlot.id)) {
      slot = sessionSlot
    } else {
      let bestDist = Number.POSITIVE_INFINITY
      for (const candidate of workstations) {
        if (claimed.has(candidate.id)) continue
        const dist = Math.hypot(candidate.anchor.x - lastFoot.x, candidate.anchor.y - lastFoot.y)
        if (dist < bestDist) {
          bestDist = dist
          slot = candidate
        }
      }
    }
    if (slot === undefined) {
      if (!queueOverflow) continue
      const seat = overflowCount
      overflowCount += 1
      assigned.set(member.id, {
        seat,
        overflow: true,
        roaming: false,
        home: seatPointOfSlot(overflowSlot!, seat),
        foot: lastFoot,
      })
      continue
    }
    claimed.add(slot.id)
    assigned.set(member.id, {
      slot,
      seat: 0,
      overflow: false,
      roaming: false,
      home: seatPointOfSlot(slot),
      foot: lastFoot,
    })
  }

  // 第三遍：其余空闲成员不占工位，从原地开始游走（无历史从候客区走进来）。
  for (const member of teammates) {
    if (assigned.has(member.id)) continue
    const origin = lastFootOf(member.id) ?? sofaAnchor
    assigned.set(member.id, {
      seat: 0,
      overflow: false,
      roaming: true,
      home: origin,
      foot: origin,
    })
  }

  const occupants: StudioOccupant[] = []
  const overflowMembers: StudioOccupant[] = []
  const roamers: StudioOccupant[] = []
  for (const member of roster) {
    const placement = assigned.get(member.id)
    if (placement === undefined) continue
    const visual = visuals.get(member.id) ?? 'idle'
    const assignment = assignments.get(member.id) ?? { charIndex: 0, accent: 0, reused: false }
    const character = characterFor(member, assignment, theme, atlasAvailable)
    if (placement.roaming) {
      roamers.push(toOccupant(member, visual, character, ROAMING_SLOT, 0, placement.foot))
    } else if (placement.overflow) {
      overflowMembers.push(
        toOccupant(member, visual, character, overflowSlot!, placement.seat, placement.foot),
      )
    } else {
      occupants.push(toOccupant(member, visual, character, placement.slot!, 0, placement.foot))
    }
  }

  const emptySlots = byOrder.filter(
    (slot) => slot.id !== overflowSlot?.id && !claimed.has(slot.id),
  )

  // previousSlots 只记真实工位（游走者保留历史）；sessionSlots 仅非 idle 续记，转 idle 即释放。
  const previousSlots: Record<string, string> = {}
  const sessionSlotsOut: Record<string, string> = {}
  for (const member of roster) {
    const placement = assigned.get(member.id)
    const history = historySlots[member.id]
    if (placement !== undefined && placement.slot !== undefined && !placement.roaming) {
      previousSlots[member.id] = placement.slot.id
      if (!placement.overflow && visuals.get(member.id) !== 'idle') {
        sessionSlotsOut[member.id] = placement.slot.id
      }
    } else if (history !== undefined) {
      previousSlots[member.id] = history
    }
  }

  // 游走推进（卡 16）：idle 游走 / 非 idle 归位；foot 写回 occupant，状态进 memo。
  const reducedMotion = input.reducedMotion ?? false
  const dtMs = memo.wanderLastNow === undefined ? 0 : Math.max(0, now - memo.wanderLastNow)
  const wanderStates: Record<string, StudioWanderState | null> = {}
  const feet: Record<string, PixelPoint> = {}
  const seatedFlags: Record<string, boolean> = {}
  const moveDx: Record<string, number> = {}
  const all = [...occupants, ...overflowMembers, ...roamers]
  const homeOf = new Map(all.map((o) => [o.memberId, assigned.get(o.memberId)!.home]))
  // 游走者没有座位：seated 恒 false，避免伪槽位锚点 (0,0) 误判在座。
  const seatedOf = (o: StudioOccupant, foot: PixelPoint): boolean =>
    o.slot.id !== ROAMING_SLOT.id && atSeat(foot, homeOf.get(o.memberId) ?? seatPointOfSlot(o.slot))
  if (reducedMotion) {
    // 减动效：完全不游走，foot = home（overflow 含 seat 偏移）；游走者原地站。
    for (const o of all) {
      feet[o.memberId] = homeOf.get(o.memberId) ?? seatPointOfSlot(o.slot)
      seatedFlags[o.memberId] = o.slot.id !== ROAMING_SLOT.id
      moveDx[o.memberId] = 0
      wanderStates[o.memberId] = memo.wander?.[o.memberId] ?? null
    }
  } else {
    const grid = walkGrid()
    for (const o of all) {
      const home = homeOf.get(o.memberId) ?? seatPointOfSlot(o.slot)
      const prev = memo.wander?.[o.memberId] ?? null
      const result = advanceWander(prev, {
        memberId: o.memberId,
        seed: o.memberId,
        grid,
        seat: home,
        idle: o.visual === 'idle',
        now,
        dtMs,
      })
      wanderStates[o.memberId] = result.state
      feet[o.memberId] = result.foot
      moveDx[o.memberId] = result.moveDx
      seatedFlags[o.memberId] = seatedOf(o, result.foot)
    }
    // 避让（卡 16）：先占位者优先（在座者先登记），游走者后判；退让后重验。
    const avoidance = resolveAvoidance(all.map((o) => {
      const home = homeOf.get(o.memberId) ?? seatPointOfSlot(o.slot)
      const prev = memo.wander?.[o.memberId] ?? null
      return {
        memberId: o.memberId,
        foot: feet[o.memberId] ?? home,
        seat: home,
        ...(prev !== null ? { prevFoot: prev.foot } : {}),
      }
    }))
    for (const o of all) {
      const outcome = avoidance.get(o.memberId)
      if (outcome === undefined || !outcome.yielded) continue
      const prev = memo.wander?.[o.memberId] ?? null
      // 退让生效：foot/seated/moveDx 一起同步到退让后的位置；清空旧路径，
      // 等 400ms 后从退让点重新规划（避免沿旧路径继续穿过被占位置）。
      feet[o.memberId] = outcome.foot
      moveDx[o.memberId] = 0
      seatedFlags[o.memberId] = seatedOf(o, outcome.foot)
      const base: StudioWanderState = prev ?? {
        visitIndex: 0, target: null, path: [], foot: outcome.foot, waitUntil: 0, returning: false,
      }
      wanderStates[o.memberId] = {
        ...base,
        foot: outcome.foot,
        path: [],
        waitUntil: now + AVOID_WAIT_MS,
      }
    }
  }
  const withFeet = (o: StudioOccupant): StudioOccupant => ({
    ...o,
    foot: feet[o.memberId] ?? o.foot,
    seated: seatedFlags[o.memberId] ?? false,
    moveDx: moveDx[o.memberId] ?? 0,
  })

  return {
    scene,
    occupants: occupants.map(withFeet),
    emptySlots,
    overflowMembers: overflowMembers.map(withFeet),
    roamers: roamers.map(withFeet),
    atlasAvailable,
    now,
    memo: {
      doneUntil: doneUntils,
      previousVisuals,
      previousSlots,
      sessionSlots: sessionSlotsOut,
      wander: wanderStates,
      wanderLastNow: now,
    },
  }
}
