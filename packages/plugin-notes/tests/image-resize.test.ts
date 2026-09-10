/**
 * image-resize 纯计算单测：百分比钳制与拖拽增量换算。
 */

import { describe, expect, it } from 'vitest'
import {
  clampImageWidthPercent,
  nextImageWidthPercent,
  IMAGE_WIDTH_MIN_PERCENT,
  IMAGE_WIDTH_MAX_PERCENT,
} from '../src/client/core/image-resize.ts'

describe('clampImageWidthPercent', () => {
  it('范围内原样返回', () => {
    expect(clampImageWidthPercent(50)).toBe(50)
    expect(clampImageWidthPercent(15)).toBe(IMAGE_WIDTH_MIN_PERCENT)
    expect(clampImageWidthPercent(100)).toBe(IMAGE_WIDTH_MAX_PERCENT)
  })

  it('越界钳制到上下限', () => {
    expect(clampImageWidthPercent(5)).toBe(IMAGE_WIDTH_MIN_PERCENT)
    expect(clampImageWidthPercent(150)).toBe(IMAGE_WIDTH_MAX_PERCENT)
  })

  it('非有限数回退到下限', () => {
    expect(clampImageWidthPercent(NaN)).toBe(IMAGE_WIDTH_MIN_PERCENT)
    expect(clampImageWidthPercent(Infinity)).toBe(IMAGE_WIDTH_MIN_PERCENT)
  })
})

describe('nextImageWidthPercent', () => {
  it('无位移返回起始百分比', () => {
    expect(nextImageWidthPercent(50, 0, 1000)).toBe(50)
  })

  it('按位移/容器宽换算并取整', () => {
    expect(nextImageWidthPercent(50, 250, 1000)).toBe(75)
    expect(nextImageWidthPercent(50, 123, 1000)).toBe(62)
  })

  it('越界钳制', () => {
    expect(nextImageWidthPercent(90, 500, 1000)).toBe(100)
    expect(nextImageWidthPercent(20, -500, 1000)).toBe(15)
  })

  it('容器宽非正时仅钳制起始百分比', () => {
    expect(nextImageWidthPercent(50, 100, 0)).toBe(50)
    expect(nextImageWidthPercent(5, 100, 0)).toBe(15)
  })
})
