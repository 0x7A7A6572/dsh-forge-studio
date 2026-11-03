import { describe, expect, it } from 'vitest'
import {
  advanceTick,
  STUDIO_FRAME_MS,
} from '../packages/plugin-agent-studio/src/client/core/pixel/stage-clock.ts'
import {
  expandVars,
  themeKeyOf,
  type StagePalette,
} from '../packages/plugin-agent-studio/src/client/core/pixel/stage-tokens.ts'
import {
  computeAtlasAvailable,
  isPlaceholderImage,
  atlasSizeMatches,
  sheetSize,
} from '../packages/plugin-agent-studio/src/client/core/pixel/atlas.ts'
import {
  planFrame,
  stageFrameIndex,
  drawStageFrame,
} from '../packages/plugin-agent-studio/src/client/core/pixel/painter-frame.ts'
import { OFFICE_SCENE, SIT_FRAME_DROP, SIT_FRAME_SHIFT_EAST, SIT_FRAME_SHIFT_WEST } from '../packages/plugin-agent-studio/src/client/core/pixel/scene-office.ts'
import { composeStageModel, type StudioRosterMember } from '../packages/plugin-agent-studio/src/client/core/pixel/studio-model.ts'
import { composeAvatar } from '../packages/plugin-agent-studio/src/client/core/pixel/avatar-sprite.ts'
import { findAtlasEntry } from '../packages/plugin-agent-studio/src/client/core/pixel/atlas.ts'
import {
  SUBAGENT_ACTIVITY_TEXT,
  activityDurationMs,
  formatDuration,
  formatTokenUsage,
  formatTokens,
  subagentActivityOf,
  subagentModeText,
  tokenTotal,
} from '../packages/plugin-agent-studio/src/client/core/pixel/text-format.ts'
import {
  HOTSPOT_HEIGHT_PX,
  HOTSPOT_WIDTH_PX,
  catalogPhaseOf,
  hotspotRectOf,
  mapCatalogRows,
  memberStatusOf,
  subagentDotOf,
  workstationTextOf,
} from '../packages/plugin-agent-studio/src/client/core/pixel/detail-model.ts'
import {
  NO_STUDIO_CAPABILITIES,
  readStudioDetailCapabilities,
} from '../packages/plugin-agent-studio/src/client/core/capabilities.ts'

const USAGE_2K = {
  uncachedInputTokens: 1_000,
  outputTokens: 500,
  cacheReadTokens: 250,
  cacheWriteTokens: 250,
}

describe('agent studio member detail formatting', () => {
  it('formats the four-bucket token total at the official boundaries', () => {
    expect(tokenTotal(USAGE_2K)).toBe(2_000)
    expect(tokenTotal(undefined)).toBeUndefined()
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_500)).toBe('1.5K')
    expect(formatTokens(150_000)).toBe('150K')
    expect(formatTokens(1_200_000)).toBe('1.2M')
    expect(formatTokenUsage(USAGE_2K)).toBe('2K tok')
    expect(formatTokenUsage(undefined)).toBeUndefined()
  })

  it('formats active duration from settledMs plus the open interval', () => {
    const timing = { settledMs: 5_000, active: { since: 1_000, through: 3_000 } }
    expect(activityDurationMs(undefined, 'running', 0)).toBeUndefined()
    expect(activityDurationMs({ settledMs: 5_000 }, 'running', 9_000)).toBe(5_000)
    // running 用 now 补齐打开区间；inactive 只用闭合的 through。
    expect(activityDurationMs(timing, 'running', 9_000)).toBe(13_000)
    expect(activityDurationMs(timing, 'inactive', 9_000)).toBe(7_000)
    // through < since 时增量夹到 0。
    expect(activityDurationMs({ settledMs: 5_000, active: { since: 5_000, through: 1_000 } }, 'inactive', 0))
      .toBe(5_000)
    expect(formatDuration(59_000)).toBe('59秒')
    expect(formatDuration(61_000)).toBe('1分01秒')
    expect(formatDuration(125_000)).toBe('2分05秒')
    expect(formatDuration(3_600_000)).toBe('1小时0分')
    expect(formatDuration(3_700_000)).toBe('1小时1分')
    expect(formatDuration(-5_000)).toBe('0秒')
  })

  it('maps activity and mode text exactly like the official panel', () => {
    expect(subagentActivityOf('running', undefined)).toBe('running')
    expect(subagentActivityOf('inactive', true)).toBe('completed')
    expect(subagentActivityOf('inactive', undefined)).toBe('inactive')
    expect(SUBAGENT_ACTIVITY_TEXT).toEqual({
      running: '正在运行',
      completed: '已完成',
      inactive: '当前未运行',
    })
    expect(subagentModeText('continuable')).toBe('可继续')
    expect(subagentModeText('one-shot')).toBe('一次性')
    expect(subagentModeText('external')).toBe('模式未知')
    expect(subagentModeText('unknown')).toBe('模式未知')
  })

  it('maps catalog rows with label fallback and missing child data', () => {
    const entries = [
      { id: 'child-1', mode: 'continuable' as const, label: '审视边界' },
      { id: 'child-2', mode: 'one-shot' as const },
      { id: 'child-3', mode: 'unknown' as const, label: '外部执行' },
      { id: 'child-4', mode: 'external' as const, label: '外部 agent' },
    ]
    const summaries = {
      'child-1': {
        title: '检查像素热区',
        running: true,
        projectionValues: {
          tokenUsage: USAGE_2K,
          subagentTiming: { settledMs: 5_000, active: { since: 1_000, through: 2_000 } },
        },
      },
      'child-2': {
        title: '跑回归',
        projectionValues: {
          tokenUsage: { uncachedInputTokens: 999, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          subagentTiming: { settledMs: 0, lastTurnCompleted: true },
        },
      },
    }
    const view = mapCatalogRows({ entries, summaries, state: 'ready', now: 9_000 })
    expect(view.phase).toBe('ready')
    expect(view.running).toBe(true)
    // label 回退：catalog.label → session title → session id。
    expect(view.rows.map((row) => row.label)).toEqual(['审视边界', '跑回归', '外部执行', '外部 agent'])
    expect(view.rows[0]).toMatchObject({
      activity: 'running',
      secondary: '检查像素热区 · 可继续 · 正在运行',
      tokensText: '2K tok',
      durationText: '13秒',
    })
    expect(view.rows[1]).toMatchObject({
      activity: 'completed',
      secondary: '跑回归 · 一次性 · 已完成',
      tokensText: '999 tok',
      durationText: '0秒',
    })
    // 没有子会话快照：只给确定知道的信息，tok/耗时不编造。
    expect(view.rows[2].secondary).toBe('模式未知 · 当前未运行')
    expect(view.rows[2].tokensText).toBeUndefined()
    expect(view.rows[2].durationText).toBeUndefined()
    // external 是外部执行，没有本地子会话可打开。
    expect(view.rows[0].openable).toBe(true)
    expect(view.rows[2].openable).toBe(true)
    expect(view.rows[3].openable).toBe(false)
    // status store 优先于 byId.running。
    const byStatus = mapCatalogRows({
      entries,
      summaries,
      state: 'ready',
      now: 9_000,
      statuses: { get: (id: string) => (id === 'child-2' ? { running: true } : undefined) },
    })
    expect(byStatus.rows[1].activity).toBe('running')
    expect(byStatus.rows[1].durationText).toBe('0秒')
  })

  it('converts foot positions into overlay percentages', () => {
    expect(HOTSPOT_WIDTH_PX).toBe(18)
    expect(HOTSPOT_HEIGHT_PX).toBe(28)
    const rect = hotspotRectOf({ x: 47, y: 162 }, { width: 256, height: 224 })
    expect(rect.left).toBeCloseTo(14.84375, 6)
    expect(rect.top).toBeCloseTo(59.8214286, 6)
    expect(rect.width).toBeCloseTo(7.03125, 6)
    expect(rect.height).toBeCloseTo(12.5, 6)
    const custom = hotspotRectOf({ x: 10, y: 10 }, { width: 256, height: 224 }, { width: 10, height: 10 })
    expect(custom.left).toBeCloseTo(1.953125, 6)
    expect(custom.top).toBeCloseTo(0, 6)
    expect(custom.width).toBeCloseTo(3.90625, 6)
    expect(custom.height).toBeCloseTo(4.4642857, 6)
    // 画布尺寸缺失时不产出 NaN（百分比会直接写进 style）。
    expect(hotspotRectOf({ x: 10, y: 10 }, { width: 0, height: 0 })).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    })
  })

  it('degrades to empty rows without crashing on partial data', () => {
    const empty = mapCatalogRows({ now: 0 })
    expect(empty.rows).toEqual([])
    expect(empty.phase).toBe('loading')
    expect(empty.running).toBe(false)
    expect(catalogPhaseOf(undefined, 'idle')).toBe('loading')
    expect(catalogPhaseOf([], 'idle')).toBe('ready')
    expect(catalogPhaseOf([], 'error')).toBe('error')
    expect(catalogPhaseOf(undefined, undefined)).toBe('loading')
    expect(catalogPhaseOf([], 'migration-required')).toBe('error')
    // 元素缺 label 时回退 id；没有 summary/statuses 也不崩。
    const bare = mapCatalogRows({ entries: [{ id: 'child-9', mode: 'one-shot' }], state: 'ready', now: 0 })
    expect(bare.rows[0]).toMatchObject({
      id: 'child-9',
      label: 'child-9',
      activity: 'inactive',
      secondary: '一次性 · 当前未运行',
    })
    expect(memberStatusOf('working')).toEqual({ dot: 'ongoing', text: '运行中' })
    expect(memberStatusOf('error').dot).toBe('error')
    expect(subagentDotOf('completed')).toBe('done')
    expect(subagentDotOf('inactive')).toBe('idle')
    expect(workstationTextOf({ id: 'overflow', role: 'member' })).toBe('候客区')
    expect(workstationTextOf({ id: 'lead', role: 'lead' })).toBe('接待台')
    expect(workstationTextOf({ id: 'seat-A1', role: 'member' })).toBe('A1')
    expect(workstationTextOf({ id: 'seat-D2', role: 'member' })).toBe('D2')
  })
})

describe('agent studio host capability modeling', () => {
  it('only exposes session/workspace methods the host actually provides', () => {
    expect(NO_STUDIO_CAPABILITIES.hasOpenSession).toBe(false)
    expect(NO_STUDIO_CAPABILITIES.hasRefreshProjections).toBe(false)
    expect(NO_STUDIO_CAPABILITIES.openSession).toBeUndefined()
    expect(NO_STUDIO_CAPABILITIES.refreshProjections).toBeUndefined()

    const missing = readStudioDetailCapabilities({})
    expect(missing.hasOpenSession).toBe(false)
    expect(missing.hasRefreshProjections).toBe(false)
    expect(missing.openSession).toBeUndefined()

    // 服务对象在、方法缺失同样判不可用：任务行禁用与提示只看 hasOpenSession。
    const servicesOnly = readStudioDetailCapabilities({ sessions: {}, uiWorkspace: {} })
    expect(servicesOnly.hasOpenSession).toBe(false)
    expect(servicesOnly.hasRefreshProjections).toBe(false)
    expect(servicesOnly.openSession).toBeUndefined()

    const calls: string[] = []
    const full = readStudioDetailCapabilities({
      sessions: {
        refreshProjections: (id: string) => {
          calls.push(`refresh:${id}`)
        },
      },
      uiWorkspace: {
        openSession: (target) => {
          calls.push(`open:${target.childSessionId}`)
        },
      },
    })
    expect(full.hasOpenSession).toBe(true)
    expect(full.hasRefreshProjections).toBe(true)
    full.refreshProjections?.('member-1')
    full.openSession?.({ parentSessionId: 'member-1', childSessionId: 'child-1', mode: 'continuable' })
    expect(calls).toEqual(['refresh:member-1', 'open:child-1'])
  })
})

describe('agent studio stage clock', () => {
  it('quantizes to 12fps without catching up dropped frames', () => {
    expect(STUDIO_FRAME_MS).toBeCloseTo(1000 / 12, 6)
    // 不足一帧：不动。
    expect(advanceTick(5, 1000, 950)).toEqual({ tick: 5, lastMs: 950, due: false })
    // 到帧：推 1 tick，lastMs 取当前时间。
    expect(advanceTick(5, 1000, 900)).toEqual({ tick: 6, lastMs: 1000, due: true })
    // 掉帧不补帧：落后 1s 也只推 1 tick。
    expect(advanceTick(5, 2000, 900).tick).toBe(6)
  })
})

describe('agent studio theme cache key', () => {
  it('composes body attr and prefers-color-scheme', () => {
    expect(themeKeyOf(undefined, false)).toBe('|light')
    expect(themeKeyOf('dark', true)).toBe('dark|dark')
    expect(themeKeyOf('ocean', false)).toBe('ocean|light')
  })
})

describe('agent studio color expression expansion', () => {
  it('expands var() references inside color-mix expressions', () => {
    const expr =
      'color-mix(in srgb, var(--dsw-a) 55%, var(--dsw-b))'
    const resolved = expandVars(expr, (name) =>
      name === '--dsw-a' ? '#7aaaff' : '#34415b',
    )
    expect(resolved).toBe('color-mix(in srgb, #7aaaff 55%, #34415b)')
    expect(expandVars('var(--x)', () => '#123456')).toBe('#123456')
    expect(expandVars('rgb(1, 2, 3)', () => '#000000')).toBe('rgb(1, 2, 3)')
  })
})

describe('agent studio atlas degradation gate', () => {
  it('treats placeholder-size sheets as unavailable', () => {
    expect(isPlaceholderImage(1, 1)).toBe(true)
    const real = (['bg', 'chars'] as const).map((sheet) => ({
      sheet,
      width: sheetSize(sheet).width,
      height: sheetSize(sheet).height,
    }))
    expect(computeAtlasAvailable(real)).toBe(true)
    expect(computeAtlasAvailable(real.map((s) => ({ ...s, width: 1, height: 1 })))).toBe(false)
    expect(computeAtlasAvailable([real[0]])).toBe(false)
  })

  it('registers the bg sheet at scene canvas size and matches only real bg', () => {
    // bg 尺寸 = 画布尺寸（256×224）；占位 bg（1×1 或其它）不匹配。
    expect(sheetSize('bg')).toEqual({ width: 256, height: 224 })
    expect(atlasSizeMatches('bg', 256, 224)).toBe(true)
    expect(atlasSizeMatches('bg', 256, 174)).toBe(false)
    expect(atlasSizeMatches('bg', 1, 1)).toBe(false)
  })

  it('degrades bg and chars independently', () => {
    // bg 可用 + chars 占位：chars 侧降级（fallback），bg 仍可用。
    expect(computeAtlasAvailable([
      { sheet: 'bg', width: 256, height: 224 },
      { sheet: 'chars', width: 1, height: 1 },
    ])).toBe(false)
    // chars 可用 + bg 占位：同样整体不可用，但 bg 尺寸单独判定为可用（hook 拆 flag）。
    expect(computeAtlasAvailable([
      { sheet: 'bg', width: 1, height: 1 },
      { sheet: 'chars', width: sheetSize('chars').width, height: sheetSize('chars').height },
    ])).toBe(false)
    expect(atlasSizeMatches('chars', sheetSize('chars').width, sheetSize('chars').height)).toBe(true)
    expect(atlasSizeMatches('bg', 1, 1)).toBe(false)
  })
})

describe('agent studio frame helpers', () => {
  it('frame tables carry head effects without screens (region-based states)', () => {
    const done = OFFICE_SCENE.clips.done
    expect(done.frames.map((f) => f.effects[0] ?? '')).toEqual([
      '', 'sticker', 'sticker', 'sticker', 'star', 'star', 'star', '',
    ])
    expect(done.holdMs).toBe(2400)
    // 落入：provisioning 的坐姿区域从工位上方 8px 落到位。
    expect(OFFICE_SCENE.clips.provisioning.frames[0].offset.y).toBe(-8)
    expect(OFFICE_SCENE.clips.provisioning.frames[5].offset.y).toBe(0)
    // working 坐姿区域 1px 微动。
    expect(OFFICE_SCENE.clips.working.frames[1].offset.y).toBe(-1)
    // 屏幕帧彻底移除。
    const withScreen = Object.values(OFFICE_SCENE.clips)
      .flatMap((clip) => clip.frames)
      .some((frame) => 'screen' in frame)
    expect(withScreen).toBe(false)
  })

  it('pins reduced-motion frames: loops at f0, one-shot at last frame', () => {
    expect(stageFrameIndex(OFFICE_SCENE.clips.idle, 40, true)).toBe(0)
    expect(stageFrameIndex(OFFICE_SCENE.clips.working, 40, true)).toBe(0)
    expect(stageFrameIndex(OFFICE_SCENE.clips.done, 1, true)).toBe(7)
    expect(stageFrameIndex(OFFICE_SCENE.clips.error, 1, true)).toBe(3)
    expect(stageFrameIndex(OFFICE_SCENE.clips.idle, 2, false)).toBe(1)
    expect(stageFrameIndex(OFFICE_SCENE.clips.error, 97, false)).toBe(3)
  })

  it('plans characters before L3 and anchors overflow seats', () => {
    function member(overrides: Partial<StudioRosterMember> & { id: string }): StudioRosterMember {
      return { name: overrides.id, role: 'teammate', phase: 'active', running: false, ...overrides }
    }
    const roster: StudioRosterMember[] = [
      member({ id: 'lead-1', role: 'lead' }),
      // 共享工位口径：只有非 idle 成员认领工位（8 座 + 溢出沙发 2）。
      ...Array.from({ length: 10 }, (_, i) => member({ id: `m${i + 1}`, running: true })),
    ]
    const model = composeStageModel({ roster, scene: OFFICE_SCENE, atlasAvailable: true, now: 0 })
    const palette = {
      lutTargets: [],
      fallbackColors: {},
      accents: [],
      ui: Object.fromEntries(
        [
          'lampRunning', 'lampIdle', 'lampError', 'lampDone', 'screenDark', 'screenOn',
          'screenText', 'snow', 'check', 'scan', 'star',
        ].map((k) => [k, `test-${k}`]),
      ),
    } as unknown as StagePalette
    const plan = planFrame(model, 0, 0, palette, false, new Map())
    // 工作区静态（bg 烘焙）：全员 = 角色帧（8 工位 + lead + 溢出 2 = 11）。
    expect(plan.characters).toHaveLength(11)
    // 到座且非 idle 成员 = 坐姿帧（8 工位 + 溢出 2）；lead 未干活 = 静止帧。
    const seated = plan.characters.filter((c) => c.pose === 'sit')
    expect(seated).toHaveLength(10)
    expect(plan.characters.find((c) => c.occupant.slot.id === 'lead')?.pose).toBe('idle')
    const overflowChars = plan.characters.filter((c) => c.occupant.slot.id === 'overflow')
    expect(overflowChars.map((c) => c.occupant.memberId)).toEqual(['m9', 'm10'])
    // 溢出锚点按 seat × anchorStep 平移（dx = 46/61 − pivotX；dy 含坐姿下移）。
    for (const c of overflowChars) {
      const pivot = findAtlasEntry(`${c.occupant.character.entry}-sit`)
      expect(pivot).toBeDefined()
      const seatX = 46 + c.occupant.seat * c.occupant.slot.anchorStep
      expect(c.dx).toBe(seatX - (pivot?.pivotX ?? 0))
      expect(c.dy).toBe(151 - (pivot?.pivotY ?? 0) + SIT_FRAME_DROP)
    }
    // 座位朝向：坐姿帧原生朝东——西椅（尾数 1）不镜像，东椅（尾数 2）镜像朝西。
    // 坐姿水平微调：西椅右移 5px，东椅左移 10px（lead/溢出位不微调）。
    for (const c of plan.characters.filter((x) => x.occupant.slot.id.startsWith('seat-'))) {
      const isWest = c.occupant.slot.id.endsWith('1')
      expect(c.flip).toBe(!isWest)
      expect(c.debug.sitShift).toBe(isWest ? SIT_FRAME_SHIFT_WEST : SIT_FRAME_SHIFT_EAST)
      const pivot = findAtlasEntry(`${c.occupant.character.entry}-sit`)
      expect(pivot).toBeDefined()
      expect(c.dx).toBe(
        c.occupant.foot.x - (pivot?.pivotX ?? 0) + (isWest ? SIT_FRAME_SHIFT_WEST : SIT_FRAME_SHIFT_EAST),
      )
    }
    // lead / 溢出位无水平微调。
    for (const c of plan.characters.filter((x) => !x.occupant.slot.id.startsWith('seat-'))) {
      expect(c.debug.sitShift).toBe(0)
    }
  })

  it('working seated chars bob and overflow chars stay stable (tick0 vs tick2)', () => {
    function member(overrides: Partial<StudioRosterMember> & { id: string }): StudioRosterMember {
      return { name: overrides.id, role: 'teammate', phase: 'active', running: false, ...overrides }
    }
    const roster: StudioRosterMember[] = [
      member({ id: 'lead-1', role: 'lead' }),
      // 全员 working：共享工位口径下只有非 idle 成员认领工位。
      ...Array.from({ length: 10 }, (_, i) => member({ id: `m${i + 1}`, running: true })),
    ]
    const model = composeStageModel({ roster, scene: OFFICE_SCENE, atlasAvailable: true, now: 0 })
    const palette = {
      lutTargets: [], fallbackColors: {}, accents: [],
      ui: Object.fromEntries(['lampRunning', 'lampIdle', 'lampError', 'lampDone', 'screenDark',
        'screenOn', 'screenText', 'snow', 'check', 'scan', 'star'].map((k) => [k, `test-${k}`])),
    } as unknown as StagePalette
    const working = {
      ...model,
      occupants: model.occupants.map((o) => ({ ...o, visual: 'working' as const })),
      overflowMembers: model.overflowMembers.map((o) => ({ ...o, visual: 'working' as const })),
    }
    // memo 必须传给两次 planFrame（previousVisuals 命中 → 不重置 start）；含溢出成员。
    const memo = {
      previousVisuals: Object.fromEntries(
        [...working.occupants, ...working.overflowMembers].map((o) => [o.memberId, 'working' as const]),
      ),
    }
    const workingWithMemo = { ...working, memo }
    // 同一 Map 实例 + 回写（与执行器契约一致）：t0 起点 0 → t2 elapsed=2 → working f1。
    const startsMap = new Map<string, number>()
    const t0 = planFrame(workingWithMemo, 0, 0, palette, false, startsMap)
    for (const [id, s] of Object.entries(t0.tickStarts)) startsMap.set(id, s)
    const t2 = planFrame(workingWithMemo, 2, 0, palette, false, startsMap)
    // 坐姿人物帧：working f1 上浮 1px（呼吸只动人，工作区不动）。
    expect(t0.characters).toHaveLength(11)
    for (const c0 of t0.characters) {
      const c2 = t2.characters.find((p) => p.occupant.memberId === c0.occupant.memberId)
      expect(c2).toBeDefined()
      expect(c2!.pose).toBe('sit')
      expect(c2!.dx).toBe(c0.dx)
      expect(c2!.dy).toBe(c0.dy - 1)
    }
  })

  it('mirrors moving sprites 1:1 via scale(-1,1) only (recorder, fallback path)', () => {
    function member(overrides: Partial<StudioRosterMember> & { id: string }): StudioRosterMember {
      return { name: overrides.id, role: 'teammate', phase: 'active', running: false, ...overrides }
    }
    const roster: StudioRosterMember[] = [member({ id: 'lead-1', role: 'lead' }), member({ id: 'm1', running: true })]
    const model = composeStageModel({ roster, scene: OFFICE_SCENE, atlasAvailable: false, now: 0 })
    const palette = {
      lutTargets: [], fallbackColors: {}, accents: [],
      ui: Object.fromEntries(['lampRunning', 'lampIdle', 'lampError', 'lampDone', 'screenDark',
        'screenOn', 'screenText', 'snow', 'check', 'scan', 'star'].map((k) => [k, `test-${k}`])),
    } as unknown as StagePalette
    const themeKey = 'test'
    const caches = { variant: new Map(), fallback: new Map(), tickStart: new Map() }
    for (const o of [...model.occupants, ...model.overflowMembers]) {
      const sprite = composeAvatar(o.memberId, o.memberId)
      const key = `${themeKey}:${sprite.width}x${sprite.height}:${[...sprite.data].join(',')}`
      caches.fallback.set(key, { tag: `char-${o.memberId}` } as unknown as HTMLCanvasElement)
    }
    // m1 行进中（向右）：素材原生朝左 → 镜像一次；lead 静止不翻转。
    const moved = {
      ...model,
      occupants: model.occupants.map((o) =>
        o.memberId === 'm1' ? { ...o, foot: { x: 130, y: 145 }, seated: false, moveDx: 1 } : o),
    }
    const ops: Array<{ op: string; sx?: number; sy?: number }> = []
    const ctx = {
      clearRect: () => {}, drawImage: () => {}, fillRect: () => {},
      save: () => ops.push({ op: 'save' }), restore: () => ops.push({ op: 'restore' }),
      translate: (x: number, y: number) => ops.push({ op: 'translate', sx: x, sy: y }),
      scale: (sx: number, sy: number) => ops.push({ op: 'scale', sx, sy }),
      set globalAlpha(_v: number) {}, get globalAlpha() { return 1 },
      set fillStyle(_v: string) {}, get fillStyle() { return '' },
    } as unknown as CanvasRenderingContext2D
    drawStageFrame(ctx, moved, {
      tick: 0, now: 0, themeKey, palette,
      assets: { bg: { sheet: 'bg', width: 256, height: 224, bitmap: {} as HTMLCanvasElement }, charsDecoded: undefined },
      reducedMotion: false, caches,
    })
    const scales = ops.filter((o) => o.op === 'scale')
    // m1 向右行进 → flip=true → 恰一次 scale(-1,1)；lead 静止不翻转；全部 1:1。
    expect(scales.length).toBe(1)
    for (const s of scales) {
      expect(Math.abs(s.sx!)).toBe(1)
      expect(Math.abs(s.sy!)).toBe(1)
    }
    expect(scales[0].sx).toBe(-1)
  })

  it('orders bg → char with z by foot (recorder ctx, fallback chars)', () => {
    function member(overrides: Partial<StudioRosterMember> & { id: string }): StudioRosterMember {
      return { name: overrides.id, role: 'teammate', phase: 'active', running: false, ...overrides }
    }
    const roster: StudioRosterMember[] = [
      member({ id: 'lead-1', role: 'lead' }),
      member({ id: 'm1', running: true }),
      member({ id: 'm2', running: true }),
    ]
    // atlasAvailable:false → 全员带 fallback sprite（无 DOM 依赖的角色像素）。
    const model = composeStageModel({ roster, scene: OFFICE_SCENE, atlasAvailable: false, now: 0 })
    const palette = {
      lutTargets: [], fallbackColors: {}, accents: [],
      ui: Object.fromEntries(['lampRunning', 'lampIdle', 'lampError', 'lampDone', 'screenDark',
        'screenOn', 'screenText', 'snow', 'check', 'scan', 'star'].map((k) => [k, `test-${k}`])),
    } as unknown as StagePalette
    // 预填 fallback 画布缓存（key 与 painter-frame 一致），避免测试触 DOM。
    const themeKey = 'test'
    const caches = {
      variant: new Map(),
      fallback: new Map(),
      tickStart: new Map(),
      staticLayer: { tag: 'static' } as unknown as HTMLCanvasElement,
    }
    for (const o of [...model.occupants, ...model.overflowMembers]) {
      const sprite = composeAvatar(o.memberId, o.memberId)
      const key = `${themeKey}:${sprite.width}x${sprite.height}:${[...sprite.data].join(',')}`
      caches.fallback.set(key, { tag: `char-${o.memberId}` } as unknown as HTMLCanvasElement)
    }
    const ops: Array<{ op: string; source: unknown }> = []
    const bgMarker = { tag: 'bg' } as unknown as HTMLCanvasElement
    const ctx = {
      clearRect: () => ops.push({ op: 'clear', source: null }),
      drawImage: (source: unknown) => {
        // source 身份区分：静态层 = bg；其余 = 角色。
        ops.push({ op: 'draw', source: source === caches.staticLayer ? 'bg' : 'char' })
      },
      fillRect: () => ops.push({ op: 'fill', source: null }),
      save: () => {}, restore: () => {},
      translate: () => {}, scale: () => {},
      set globalAlpha(_v: number) {}, get globalAlpha() { return 1 },
      set fillStyle(_v: string) {}, get fillStyle() { return '' },
    } as unknown as CanvasRenderingContext2D
    drawStageFrame(ctx, model, {
      tick: 0, now: 0, themeKey, palette,
      assets: { bg: { sheet: 'bg', width: 256, height: 224, bitmap: bgMarker }, charsDecoded: undefined },
      reducedMotion: false, caches,
    })
    // 顺序：bg（静态层）→ char×N（lead + 2 个坐姿 fallback）；无 cover/灯/屏。
    const kinds = ops.map((o) => o.op === 'draw' ? o.source : o.op)
    const firstChar = kinds.indexOf('char')
    expect(firstChar).toBeGreaterThan(kinds.indexOf('bg'))
    expect(kinds.filter((k) => k === 'char')).toHaveLength(3)
    expect(kinds.filter((k) => k === 'fill')).toHaveLength(0)
  })
})
