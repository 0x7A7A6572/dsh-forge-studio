/**
 * 侧栏入口主题这条边界的门禁。
 *
 * 这里钉的是三件事，都不是"实现细节"而是**契约**：
 * 1. 注册表语义（同 id 顶替、disposer 不误删、快照引用稳定）——
 *    快照引用稳定这条尤其关键：它直接喂给 `useSyncExternalStore`，现算一个新数组会自激成无限重渲染。
 * 2. 装配出来的判档结果必须**逐分钟等于契约里那份 `toneAtMinute`** —— 主题与宿主分叉一分钟，
 *    卡片上那个点就和收的钱对不上了。
 * 3. 「没有分时价口径」必须是 `data: null`，**不许**被编成一个平坦的工作日模板。
 */
import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_THEME_ID, clockText, toneAtMinute } from '../packages/plugin-usage-billing/src/shape/index.ts'
import type { Theme } from '../packages/plugin-usage-billing/src/shape/index.ts'
import { createThemeRegistry } from '../packages/plugin-usage-billing/src/client/core/theme-registry.ts'
import { selectTheme, themePropsOf } from '../packages/plugin-usage-billing/src/client/core/entry-theme.ts'
import type { EntryThemeInput } from '../packages/plugin-usage-billing/src/client/core/entry-theme.ts'
import type { TierDayProfile } from '../packages/plugin-usage-billing/src/pricing/tiers.ts'

/** 主题只是个组件标识，测试里不需要真渲染。 */
const noopTheme = (): null => null

function themeOf(id: string): Theme {
  return { id, label: `label:${id}`, component: noopTheme }
}

/** 官方口径：工作日 09:00-12:00 / 14:00-18:00。 */
const WORKDAY: TierDayProfile = {
  workday: true,
  peakWindows: [[540, 720], [840, 1080]],
  offPeakRatio: 0.5,
  utcOffsetMinutes: 480,
}

/** 周末：窗口为空（宿主已经把"今天算不算工作日"判完了，客户端不再判第二遍）。 */
const WEEKEND: TierDayProfile = {
  workday: false,
  peakWindows: [],
  offPeakRatio: 0.5,
  utcOffsetMinutes: 480,
}

function inputOf(patch: Partial<EntryThemeInput> = {}): EntryThemeInput {
  return {
    tierDay: WORKDAY,
    minute: 600,
    wide: true,
    monthText: '¥12.34',
    todayText: '¥1.00',
    failed: false,
    unpricedText: null,
    showTier: true,
    budget: null,
    segments: [],
    ...patch,
  }
}

describe('主题注册表', () => {
  it('列出已注册的主题，且快照引用在没变化时保持同一个', () => {
    const registry = createThemeRegistry()
    registry.register(themeOf('a'))
    const first = registry.list()
    expect(first.map((s) => s.id)).toEqual(['a'])
    // 这一条是 useSyncExternalStore 的硬要求：现算新数组 = 无限重渲染。
    expect(registry.list()).toBe(first)
    registry.register(themeOf('b'))
    expect(registry.list()).not.toBe(first)
    expect(registry.list().map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('同一个 id 后注册的顶掉先注册的，且旧 disposer 不会误删新的', () => {
    const registry = createThemeRegistry()
    const disposeFirst = registry.register(themeOf('a'))
    registry.register(themeOf('a'))
    disposeFirst()
    // 被顶掉之后旧 disposer 必须变成空操作，否则 HMR 下会把新注册的那份删掉。
    expect(registry.list().map((s) => s.label)).toEqual(['label:a'])
    expect(registry.list()).toHaveLength(1)
  })

  it('disposer 注销自己，订阅能收到变化、退订后收不到', () => {
    const registry = createThemeRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    const dispose = registry.register(themeOf('a'))
    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(registry.list()).toEqual([])
    unsubscribe()
    registry.register(themeOf('b'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('dispose 清空主题与订阅', () => {
    const registry = createThemeRegistry()
    const listener = vi.fn()
    registry.subscribe(listener)
    registry.register(themeOf('a'))
    registry.dispose()
    expect(registry.list()).toEqual([])
    registry.register(themeOf('b'))
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('挑主题', () => {
  it('选中的在册就用它', () => {
    const themes = [themeOf('mine'), themeOf(BUILTIN_THEME_ID)]
    expect(selectTheme(themes, 'mine')?.id).toBe('mine')
  })

  it('选中的不在册（插件被停用 / 卸载）回落到内置那条', () => {
    const themes = [themeOf('gone'), themeOf(BUILTIN_THEME_ID)]
    expect(selectTheme(themes, 'not-installed')?.id).toBe(BUILTIN_THEME_ID)
  })

  it('连内置都不在册时返回 undefined（渲染侧要能承受空）', () => {
    expect(selectTheme([themeOf('a')], BUILTIN_THEME_ID)).toBeUndefined()
  })
})

describe('装配主题数据', () => {
  it('没有分时价口径时 data 是 null —— 不编一个平坦的工作日模板出来', () => {
    expect(themePropsOf(inputOf({ tierDay: null })).data).toBeNull()
  })

  it('把 profile 原样交给主题：窗口不做夹取 / 排序 / 去重', () => {
    const data = themePropsOf(inputOf({ tierDay: WEEKEND })).data
    expect(data).toEqual({ workday: false, peakWindows: [], minute: 600, tone: 'offPeak' })
  })

  it('tone 逐分钟都等于契约里那份判档，1440 分钟全扫', () => {
    for (const profile of [WORKDAY, WEEKEND]) {
      for (let minute = 0; minute < 1440; minute++) {
        const tone = themePropsOf(inputOf({ tierDay: profile, minute })).data?.tone
        expect(tone).toBe(toneAtMinute(profile.peakWindows, minute))
      }
    }
  })

  it('展示数据原样透传，进度缺省是 null', () => {
    const view = themePropsOf(inputOf()).view
    expect(view).toEqual({
      wide: true,
      monthText: '¥12.34',
      todayText: '¥1.00',
      failed: false,
      unpricedText: null,
      showTier: true,
      progress: null,
    })
  })

  it('有预算时把三段折成"占已用段"的比例，0 比例的段不出现', () => {
    const view = themePropsOf(inputOf({
      budget: { level: 'warn', ratio: 0.8, monthlyText: '¥600.00', spentValue: 100 },
      segments: [
        { key: 'session', value: 25 },
        { key: 'workspace', value: 0 },
        { key: 'today', value: 50 },
        { key: 'others', value: 999 },
      ],
    })).view
    expect(view.progress).toEqual({
      ratio: 0.8,
      level: 'warn',
      // 已用金额必须与卡上那个「本月」同源，否则会出现"条画到 80%、旁边写着另一个数"。
      spentText: '¥12.34',
      limitText: '¥600.00',
      bands: [
        { key: 'session', ratio: 0.25 },
        // workspace 是 0：不画（空数组段 ≠ 长度为 0 的段）
        { key: 'today', ratio: 0.5 },
      ],
    })
  })

  it('某段超过已用总额时夹到整段（比例不可能大于 1）', () => {
    const progress = themePropsOf(inputOf({
      budget: { level: 'over', ratio: 1.4, monthlyText: '¥10.00', spentValue: 10 },
      segments: [{ key: 'today', value: 999 }],
    })).view.progress
    expect(progress?.bands).toEqual([{ key: 'today', ratio: 1 }])
    // 整条的比例**不夹**：超支要能画出来，所以 ratio 原样留给主题。
    expect(progress?.ratio).toBe(1.4)
  })

  it('已用为 0 时不做除法（全部段按 0 处理，不产生 NaN）', () => {
    const progress = themePropsOf(inputOf({
      budget: { level: 'ok', ratio: 0, monthlyText: '¥10.00', spentValue: 0 },
      segments: [{ key: 'today', value: 5 }],
    })).view.progress
    expect(progress?.bands).toEqual([])
  })
})

describe('契约自身的两个纯函数', () => {
  it('窗口左闭右开：09:00 是高峰，12:00 不是', () => {
    expect(toneAtMinute(WORKDAY.peakWindows, 540)).toBe('peak')
    expect(toneAtMinute(WORKDAY.peakWindows, 719)).toBe('peak')
    expect(toneAtMinute(WORKDAY.peakWindows, 720)).toBe('offPeak')
  })

  it('时刻格式补前导零，1440 是右端点 24:00', () => {
    expect(clockText(0)).toBe('00:00')
    expect(clockText(9 * 60 + 5)).toBe('09:05')
    expect(clockText(1439)).toBe('23:59')
    expect(clockText(1440)).toBe('24:00')
  })
})
