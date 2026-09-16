import { describe, expect, it } from 'vitest'
import { formatCny, formatDay, formatInt, formatPct } from '../src/client/core/format.ts'

describe('format', () => {
  it('金额千分位不缩写', () => {
    expect(formatCny(1234.5)).toBe('¥1,234.50')
    expect(formatCny(1234567.891)).toBe('¥1,234,567.89')
    expect(formatCny(0)).toBe('¥0.00')
  })
  it('极小非零金额不显示成 ¥0.00', () => {
    expect(formatCny(0.001)).toBe('<¥0.01')
  })
  it('整数千分位', () => {
    expect(formatInt(1234567)).toBe('1,234,567')
  })
  it('百分比保留一位小数', () => {
    expect(formatPct(0.5)).toBe('50.0%')
    expect(formatPct(0)).toBe('0.0%')
  })
  it('日期显示为 MM-DD', () => {
    expect(formatDay('2026-09-16')).toBe('09-16')
  })
})
