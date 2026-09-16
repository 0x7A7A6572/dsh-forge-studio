/**
 * 样式守卫：token 白名单 + 命名空间 + 括号平衡。
 *
 * 1. **token 白名单**（真实踩过）：未定义的 \`var(--dsw-*)\` 不会让浏览器报错 ——
 *    它让整条声明在 computed-value 阶段失效（连上一行的兜底一起吃掉），症状是
 *    「改了跟没改一样」。所以 ui-css.ts 里出现的每个 --dsw-* 都必须先去
 *    client/ui-theme/src/styles/design-platform.css 核对它确实存在。
 * 2. **命名空间**：所有选择器都要带 ub- 前缀或插件自己的 data 属性 —— 弹窗是 portal 到 body 的，
 *    样式不依赖祖先作用域，只能靠类名前缀保证不漏到别的插件。
 * 3. **括号平衡**：CSS 在那个模板字符串里是纯文本，写漏一个 } 浏览器会静默吞掉后面的规则。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 已核对存在于 design-platform.css（light + dark 两套）里的 alias token。 */
const KNOWN_TOKENS = new Set([
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l4',
  '--dsw-alias-brand-primary',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-warn-primary',
])

const CSS_PATH = fileURLToPath(new URL('../src/client/views/ui-css.ts', import.meta.url))
const source = readFileSync(CSS_PATH, 'utf8')

/** 源码里的是模板字面量：`${TOKENS.brand}` 这类占位符自带一对花括号，先剔掉再分析。 */
const PLACEHOLDER = /\$\{[^}]*\}/g
const cssSource = source.replace(PLACEHOLDER, '')

/**
 * 只取 `const CSS = \`…\`` 那段模板字面量本身。
 * 后面的函数体里也有花括号，切宽了会把 `export function …(…): void {` 也当成选择器。
 */
function cssText(): string {
  // 注意：两个 indexOf 都必须在**同一个**字符串上找。剔除占位符会让后面的下标整体左移，
  // 一旦 `start` 取自 source、`close` 取自 cssSource，切片就会越过结尾的反引号切进 JS 代码。
  const start = cssSource.indexOf('const CSS = ')
  // 反引号本身要用 fromCharCode 写：在这个文件里再套一层转义只会更难读。
  const tick = String.fromCharCode(96)
  const open = cssSource.indexOf(tick, start)
  const close = cssSource.indexOf(tick, open + 1)
  expect(open).toBeGreaterThan(-1)
  expect(close).toBeGreaterThan(open)
  return cssSource.slice(open + 1, close)
}
const used = [...new Set([...source.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((match) => match[1]!))].sort()

describe('主题 token', () => {
  it('样式里用到的每个 --dsw-* 变量都在白名单内', () => {
    expect(used.length).toBeGreaterThan(0)
    const unknown = used.filter((name) => !KNOWN_TOKENS.has(name))
    expect(unknown, '未核对的 token（先确认 design-platform.css 里真的定义了它）：' + unknown.join(', ')).toEqual([])
  })
})

describe('热力图容器', () => {
  it('日历格子必须同时给行数与列填充方向（只给其一就摊成一条横线）', () => {
    // 真实踩过：只写 grid-auto-flow: column 而没给 grid-template-rows 时，隐式网格只有一行，
    // 整个日历被压成一条横杠。这条断言把两半都钉住。
    const rule = /\.ub-heat\s*\{([^}]*)\}/.exec(cssText())
    expect(rule).not.toBeNull()
    const body = rule![1]!
    expect(body).toContain('grid-auto-flow: column')
    expect(body).toMatch(/grid-template-rows:\s*repeat\(\s*7\s*,/)
  })
})

describe('命名空间与语法', () => {
  it('CSS 大括号成对（模板字符串里漏一个 } 会让后面的规则被静默吞掉）', () => {
    const css = cssText()
    const open = (css.match(/\{/g) ?? []).length
    const close = (css.match(/\}/g) ?? []).length
    expect(open).toBe(close)
    expect(open).toBeGreaterThan(50)
  })

  it('除基础重置外，每个选择器都带 ub- 前缀（弹窗 portal 到 body，没有祖先作用域可依赖）', () => {
    const css = cssText()
    const selectors: string[] = []
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1]!.trim()
      if (selector === '' || selector.startsWith('@') || selector.startsWith('/*')) continue
      selectors.push(selector)
    }
    expect(selectors.length).toBeGreaterThan(20)
    for (const selector of selectors) {
      for (const part of selector.split(',').map((piece) => piece.trim())) {
        if (part === '') continue
        const namespaced = part.includes('ub-') || part.includes('data-dsh-')
        expect(namespaced, '未受控的选择器（会漏到别的插件）：' + part).toBe(true)
      }
    }
  })
})
