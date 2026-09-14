/**
 * 编辑器选区样式契约（纸面编辑态反相选中）。
 *
 * 背景（真实反馈）：编辑便签时选中的文字是「灰底 + 近黑墨字」，因为纸面沿用了宿主
 * 主题的 bubble-highlight（半透明灰）作选区，而便签纸恒为浅 pastel、正文恒为墨色，
 * 两者叠在一起选区几乎看不出来。
 *
 * 契约：
 * 1. 纸面（.fs-note-editor--paper）必须有反相选中规则：墨底 + 纸白字；
 * 2. 其 .ProseMirror 变体与主题规则特异度相同（都是 (0,2,1)），层叠靠**顺序**决胜，
 *    故它必须排在主题规则之后——顺序一旦被调换，修复即失效；
 * 3. 泛化选择器（不带 .ProseMirror）覆盖标题输入框与只读结果区；
 * 4. 主题表面不再拿极淡的 bubble-highlight 当选区色。
 *
 * 直接读源文件文本断言（不 import 组件，避免把 React/tiptap 拖进 node 测试环境）。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(new URL('../src/client/components/note-editor.tsx', import.meta.url), 'utf8')
const PAPER_RULE = '.fs-note-editor--paper .ProseMirror ::selection'
const THEME_RULE = '.fs-note-editor .ProseMirror ::selection'

describe('编辑器选区样式（纸面反相选中）', () => {
  it('纸面选区规则：墨底 + 纸白字', () => {
    const at = SOURCE.indexOf('.fs-note-editor--paper ::selection')
    expect(at).toBeGreaterThan(-1)
    const block = SOURCE.slice(at, SOURCE.indexOf('}', at))
    expect(block).toContain('background: rgba(46, 42, 34, 0.85)')
    expect(block).toContain('color: #FFFDF4')
  })

  it('反相规则排在主题规则之后（同特异度靠层叠顺序取胜）', () => {
    expect(SOURCE.indexOf(PAPER_RULE)).toBeGreaterThan(SOURCE.indexOf(THEME_RULE))
    expect(SOURCE.indexOf(THEME_RULE)).toBeGreaterThan(-1)
  })

  it('主题表面不再用极淡的 bubble-highlight 作选区背景', () => {
    expect(SOURCE).not.toContain('var(--dsw-specific-bubble-highlight)')
  })
})
