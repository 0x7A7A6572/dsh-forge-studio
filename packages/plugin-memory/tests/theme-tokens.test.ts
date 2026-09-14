/**
 * 主题 token 白名单守卫。
 *
 * 背景（真实踩过）：样式里用了 --dsw-alias-label-error，而 DSH 主题
 * （client/ui-theme/src/styles/design-platform.css）只定义了 primary / secondary，
 * 没有 label-error。未定义的 var() 不会让浏览器报错 —— 它会让整条声明在
 * computed-value 阶段失效：border-color 退回 currentColor（灰），
 * background 那条 color-mix 直接作废，连上一行的兜底也被吃掉。
 * 结果就是「改了跟没改一样」，而且从代码上看不出任何问题。
 *
 * 所以：ui-css.ts 里出现的每个 --dsw-* 变量都必须在这个白名单里，
 * 新增 token 前先去 design-platform.css 核对它确实存在。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 已核对存在于 design-platform.css（light + dark 两套）里的 alias token。 */
const KNOWN_TOKENS = new Set([
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-border-l4',
  '--dsw-alias-bg-module-platform',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-interactive-bg-active',
  '--dsw-alias-bg-layer-2',
])

const CSS_PATH = fileURLToPath(new URL('../src/client/views/ui-css.ts', import.meta.url))
const source = readFileSync(CSS_PATH, 'utf8')
const used = [...new Set([...source.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map((match) => match[1]!))].sort()

describe('主题 token', () => {
  it('样式里用到的每个 --dsw-* 变量都在白名单内', () => {
    expect(used.length).toBeGreaterThan(0)
    const unknown = used.filter((name) => !KNOWN_TOKENS.has(name))
    expect(unknown, '未核对的 token（先确认 design-platform.css 里真的定义了它）：' + unknown.join(', ')).toEqual([])
  })

  it('红色一律走 state-error-primary，不再引用不存在的 label-error', () => {
    // 断言用到的列表而不是源码文本 —— 注释里会提到那个错 token 的名字。
    expect(used).not.toContain('--dsw-alias-label-error')
    expect(used).toContain('--dsw-alias-state-error-primary')
  })
})
