/**
 * 弹窗 CSS 作用域 / 权重守卫。
 *
 * 两个真实踩过的坑，症状都是「样式写了但完全没生效」：
 *
 * 1. Modal 是 createPortal(..., document.body) —— 弹窗 DOM 不在 [data-dsh-memory-ui]
 *    作用域内。属性挂在外层 div 自己身上时，必须写 [data-dsh-memory-ui].mem-modal-body
 *    （自身选择器）；写成 `[data-dsh-memory-ui] .mem-modal-body`（后代选择器）
 *    永远匹配不到，规则形同废纸。
 *
 * 2. Modal.module.css 的 .dialog 是单类 { width: min(380px, 100%) }，权重 (0,1,0)；
 *    插件自己的单类规则同样是 (0,1,0)，打平后就按源码顺序 —— app 的 CSS Module 在
 *    插件的 <style> 之后注入，所以只写单类会被压住。给弹窗加宽必须自带更高权重
 *    （[role='dialog'].mem-draft-modal 是 (0,2,0)），与加载顺序无关。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CSS_PATH = fileURLToPath(new URL('../src/client/views/ui-css.ts', import.meta.url))
const source = readFileSync(CSS_PATH, 'utf8')

describe('筛选行与下拉', () => {
  it('定宽只作用于数字输入，不会把搜索框和复选框压成 64px', () => {
    // 踩过：写裸 .mem-field-row input { width: 64px } —— Input 原语内部就是裸 input，
    // 权重 (0,2,1) 压过它自己的 (0,1,0)，搜索框和复选框一起被压成 64px。
    expect(source).not.toMatch(/\.mem-field-row\s+input\s*\{/)
    expect(source).toContain(".mem-field-row input[type='number']")
  })

  it('下拉选择器全部限定在插件命名空间内，不外泄', () => {
    const selectors: string[] = []
    for (const match of source.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1]!.trim()
      if (/\bselect\b/.test(selector)) selectors.push(selector)
    }
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) {
      for (const part of selector.split(',').map((piece) => piece.trim())) {
        if (!/\bselect\b/.test(part)) continue
        const scoped = /\[data-dsh-memory-ui\]\s+select\b/.test(part) || /\.mem-select\b/.test(part)
        expect(scoped, '未受控的 select 选择器（会漏到别的插件）：' + part).toBe(true)
      }
    }
  })
})

describe('弹窗 CSS 作用域', () => {
  it('.mem-modal-body 必须用自身选择器（弹窗是 portal 到 body 的）', () => {
    expect(source).not.toMatch(/\[data-dsh-memory-ui\]\s+\.mem-modal-body/)
    expect(source).toContain('[data-dsh-memory-ui].mem-modal-body')
  })

  it('两个弹窗共用 .mem-modal-wide，且加宽规则必须自带更高权重（压过 Modal.module.css 的 .dialog）', () => {
    const rules = source.match(/[^{}]*\.mem-modal-wide[^{}]*\{[^}]*\}/g) ?? []
    expect(rules.length).toBeGreaterThan(0)
    // 宽度规则也必须作用到内层，否则内容仍被 .mem-modal-body 的 max-width 卡住。
    expect(source).toContain("[role='dialog'].mem-modal-wide [data-dsh-memory-ui].mem-modal-body")
    for (const rule of rules) {
      const [selector = '', body = ''] = rule.split('{')
      if (/\bwidth\s*:/.test(body)) {
        expect(selector, '加宽时必须带 [role=\'dialog\'] 提升权重：' + selector.trim()).toContain("[role='dialog']")
      }
    }
  })
})
