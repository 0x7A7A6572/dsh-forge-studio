/**
 * 节点滑杆组件（ScaleSlider）：把「重要性」那套原生 range + 自绘节点抽成通用件，
 * 供重要性、注入门槛与 capture 高级配置共用。
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScaleSlider } from '../src/client/components/scale-slider.tsx'

const STEPS = [1, 2, 3, 5, 8, 10, 15, 20] as const
const count = (text: string, needle: string): number => text.split(needle).length - 1

const render = (value: number, steps: readonly number[] = STEPS, disabled = false): string =>
  renderToStaticMarkup(createElement(ScaleSlider, {
    label: '提炼间隔', value, steps, disabled, onChange: () => {},
  }))

describe('节点滑杆', () => {
  it('按 steps 数量画节点，当前档及以下的节点点亮', () => {
    const h = render(3)
    expect(count(h, 'class="mem-tick"')).toBe(5)
    expect(count(h, 'class="mem-tick mem-tick-on"')).toBe(3)
  })

  it('滑块位置按档位下标算，不是按数值本身', () => {
    const h = render(3)
    expect(h).toContain('min="0"')
    expect(h).toContain('max="7"')
    expect(h).toContain('value="2"')
  })

  it('填充比例按下标算：首档 0%、末档 100%、五档中间档 50%', () => {
    expect(render(1)).toContain('--mem-fill:0%')
    expect(render(20)).toContain('--mem-fill:100%')
    expect(render(3, [1, 2, 3, 4, 5])).toContain('--mem-fill:50%')
  })

  it('标签与可访问性：aria-label 用 label，aria-valuetext 报当前档', () => {
    const h = render(3)
    expect(h).toContain('aria-label="提炼间隔"')
    expect(h).toContain('aria-valuetext="3"')
  })

  it('disabled 透传到原生 range', () => {
    expect(render(3, STEPS, true)).toContain('disabled=""')
  })
})
