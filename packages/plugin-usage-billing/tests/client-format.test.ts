import { describe, expect, it } from 'vitest'
import { formatCny, formatDateTime, formatDay, formatInt, formatPct } from '../src/client/core/format.ts'

/**
 * 非有限输入的**统一口径**：一律渲染占位 `'—'`，绝不渲染 `'¥0.00'`/`'0'`。
 * 把无法计算的费用说成「没花钱」比留白更糟 —— 与入口卡对未定价账本的占位同一姿态。
 */
const PLACEHOLDER = '—'
const NON_FINITE = [NaN, Infinity, -Infinity, undefined] as unknown as number[]

describe('format', () => {
  it('金额千分位不缩写', () => {
    expect(formatCny(1234.5)).toBe('¥1,234.50')
    expect(formatCny(1234567.891)).toBe('¥1,234,567.89')
    expect(formatCny(0)).toBe('¥0.00')
  })
  it('负金额带符号（-¥1,234.50，不是 ¥1,234.50）', () => {
    expect(formatCny(-1234.5)).toBe('-¥1,234.50')
    expect(formatCny(-0.001)).toBe('<¥0.01')
  })
  it('极小非零金额不显示成 ¥0.00', () => {
    expect(formatCny(0.001)).toBe('<¥0.01')
  })
  it('非有限金额是占位而不是「没花钱」', () => {
    for (const n of NON_FINITE) expect(formatCny(n)).toBe(PLACEHOLDER)
    // `-Infinity` 曾渲染成无符号的 `¥0.00`（最坏的那个谎）
    expect(formatCny(-Infinity)).not.toBe('¥0.00')
  })

  it('整数千分位', () => {
    expect(formatInt(1234567)).toBe('1,234,567')
  })
  it('负整数带符号（-1,235，不是 1,235）', () => {
    // 注意：`formatInt` 里那截显式符号分支**行为上不可观测** —— `String(-1235)` 自带 '-'，
    // 且 `thousands('-1235')` 得到 '-1,235'（'-' 与首位数字之间是词边界，`\B` 不插逗号），
    // 所以删掉它这套断言照样绿。这里钉的是**对外行为**：负号保留、±0 绝不渲染 '-0'。
    expect(formatInt(-1234.6)).toBe('-1,235')
    expect(formatInt(-1234)).toBe('-1,234')
    expect(formatInt(-0.4)).toBe('0')
    expect(formatInt(-0)).toBe('0')
  })
  it('非有限整数是占位', () => {
    for (const n of NON_FINITE) expect(formatInt(n)).toBe(PLACEHOLDER)
  })

  it('百分比保留一位小数', () => {
    expect(formatPct(0.5)).toBe('50.0%')
    expect(formatPct(0)).toBe('0.0%')
  })
  it('百分比的 digits 参数对非有限分支同样生效', () => {
    for (const n of NON_FINITE) expect(formatPct(n, 2)).toBe(PLACEHOLDER)
    expect(formatPct(0.1234, 2)).toBe('12.34%')
  })

  it('日期显示为 MM-DD', () => {
    expect(formatDay('2026-09-16')).toBe('09-16')
  })
  it('日期时间：本地时刻，且非有限输入不渲染 NaN-NaN-NaN', () => {
    expect(formatDateTime(Date.UTC(2026, 8, 16, 6, 0))).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    for (const n of NON_FINITE) expect(formatDateTime(n)).toBe(PLACEHOLDER)
  })
})
