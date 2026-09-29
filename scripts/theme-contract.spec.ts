/**
 * 主题契约的门禁：这份清单是**唯一来源**，两处漂移必须红。
 *
 * 1. 主题能 import 的裸模块必须是平台模块表的一个子集 —— 超出平台表就等于承诺了
 *    宿主模块表里没有的东西，主题会在 require 时炸。
 * 2. 契约里不该再有 service / 注册表：形状不再是插件。
 *
 * （第 3 条「宿主 require 表覆盖清单全部」要等 Task 5 把 THEME_MODULE_MAP 建出来，
 *   那时补在这个文件里 —— 提前写就是一条永远红的 spec。）
 */
import { describe, expect, it } from 'vitest'
import { PLATFORM_MODULES } from '../scripts/tsdown.client.mjs'
import {
  BUILTIN_THEME_ID,
  SHAPE_SPECIFIER,
  THEME_ALLOWED_MODULES,
  clockText,
  toneAtMinute,
} from '../packages/plugin-usage-billing/src/shape/index.ts'

describe('主题允许的模块', () => {
  it('每一项都在平台模块表里，或是契约子路径本身', () => {
    const allowed = new Set<string>([...PLATFORM_MODULES, SHAPE_SPECIFIER])
    const extra = THEME_ALLOWED_MODULES.filter((name) => !allowed.has(name))
    expect(extra).toEqual([])
  })

  it('内置主题 id 仍是 builtin（设置里的默认值与回落值都指向它）', () => {
    expect(BUILTIN_THEME_ID).toBe('builtin')
  })
})

describe('契约自身的两个纯函数', () => {
  it('窗口左闭右开：09:00 是高峰，12:00 不是', () => {
    const windows = [[540, 720]] as const
    expect(toneAtMinute(windows, 540)).toBe('peak')
    expect(toneAtMinute(windows, 719)).toBe('peak')
    expect(toneAtMinute(windows, 720)).toBe('offPeak')
  })

  it('时刻格式补前导零，1440 是右端点 24:00', () => {
    expect(clockText(0)).toBe('00:00')
    expect(clockText(545)).toBe('09:05')
    expect(clockText(1440)).toBe('24:00')
  })
})
