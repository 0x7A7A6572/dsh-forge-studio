/**
 * 样式守卫：token 白名单 + 命名空间 + 括号平衡。
 *
 * 1. **token 白名单**（真实踩过）：未定义的 \`var(--dsw-*)\` 不会让浏览器报错 ——
 *    它让整条声明在 computed-value 阶段失效（连上一行的兜底一起吃掉），症状是
 *    「改了跟没改一样」。所以 ui-css.css 里出现的每个 --dsw-* 都必须先去
 *    client/ui-theme/src/styles/design-platform.css 核对它确实存在。
 * 2. **命名空间**：所有选择器都要带 ub- 前缀或插件自己的 data 属性 —— 弹窗是 portal 到 body 的，
 *    样式不依赖祖先作用域，只能靠类名前缀保证不漏到别的插件。
 * 3. **括号平衡**：漏一个 } 浏览器会静默吞掉后面的规则。
 *
 * 样式正文是 src/client/views/ui-css.css（真 CSS 文件，不是模板字符串），测试直接读它。
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

const CSS_PATH = fileURLToPath(new URL('../src/client/views/ui-css.css', import.meta.url))
const source = readFileSync(CSS_PATH, 'utf8')

/**
 * 去掉注释后的 CSS。选择器扫描必须看真实选择器：文件头的说明注释会让
 * 「非花括号串 + 左花括号」这个模式把注释和它后面的第一条规则粘成一整块，
 * 那条规则就被整块跳过了。
 */
const cssWithoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')

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
    const rule = /\.ub-heat\s*\{([^}]*)\}/.exec(source)
    expect(rule).not.toBeNull()
    const body = rule![1]!
    expect(body).toContain('grid-auto-flow: column')
    expect(body).toMatch(/grid-template-rows:\s*repeat\(\s*7\s*,/)
  })
})

describe('命名空间与语法', () => {
  it('CSS 大括号成对（漏一个 } 会让后面的规则被静默吞掉）', () => {
    const open = (source.match(/\{/g) ?? []).length
    const close = (source.match(/\}/g) ?? []).length
    expect(open).toBe(close)
    expect(open).toBeGreaterThan(50)
  })

  it('除基础重置外，每个选择器都带 ub- 前缀（弹窗 portal 到 body，没有祖先作用域可依赖）', () => {
    const selectors: string[] = []
    for (const match of cssWithoutComments.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1]!.trim()
      if (selector === '' || selector.startsWith('@')) continue
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
