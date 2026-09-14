/**
 * 便签待办清单（todolist）契约测试。
 *
 * 三层契约：
 * 1. 装配层（core/note-richtext.ts）必须注册名为 \`taskList\` / \`taskItem\` 的节点 ——
 *    tiptap-markdown 的内置 Markdown 规格按扩展名匹配（getMarkdownSpec 用
 *    extension.name 查表），节点名一改就丢 \`- [ ]\` / \`- [x]\` 的存取能力；
 * 2. taskItem 必须带 checked 属性（解析读 data-checked，序列化按 attrs.checked 输出
 *    \`- [x] \` / \`- [ ] \`），且 content 允许段落与嵌套块 —— markdown-it-task-lists
 *    解析出来的 li 正文（裸文本 + 子列表）要能在 schema 里落位；
 * 3. 编辑器 UI 契约（直接读源文件文本断言，不把 React / tiptap 实例拖进 node 测试
 *    环境）：工具栏有「任务清单」按钮并绑定 toggleTaskList，样式覆盖勾选态与只读态。
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { buildNoteRichTextExtensions } from '../src/client/core/note-richtext.ts'

const EDITOR_SOURCE = readFileSync(
  new URL('../src/client/components/note-editor.tsx', import.meta.url),
  'utf8',
)

describe('待办清单扩展装配（note-richtext）', () => {
  it('schema 注册 taskList / taskItem（节点名即 Markdown 存取契约）', () => {
    const schema = getSchema(buildNoteRichTextExtensions())
    expect(schema.nodes.taskList).toBeDefined()
    expect(schema.nodes.taskItem).toBeDefined()
  })

  it('taskItem 带 checked 属性，且 content 允许段落与嵌套块', () => {
    const item = getSchema(buildNoteRichTextExtensions()).nodes.taskItem
    expect(item.spec.attrs?.checked).toBeTruthy()
    expect(item.spec.content).toContain('paragraph')
    expect(item.spec.content).toContain('block')
  })

  it('taskList 是块级节点、内容为 taskItem', () => {
    const list = getSchema(buildNoteRichTextExtensions()).nodes.taskList
    expect(list.spec.content).toContain('taskItem')
    expect(list.spec.group ?? '').toContain('block')
  })

  it('只读渲染复用同一套装配（说明弹窗 / 任务结果区同源）', () => {
    const readonly = getSchema(buildNoteRichTextExtensions({ readonly: true }))
    expect(readonly.nodes.taskList).toBeDefined()
    expect(readonly.nodes.taskItem).toBeDefined()
  })
})

describe('编辑器待办清单 UI 契约（note-editor）', () => {
  it('工具栏提供「任务清单」按钮并绑定 toggleTaskList', () => {
    expect(EDITOR_SOURCE).toContain('title="任务清单 (Ctrl+Shift+9)"')
    expect(EDITOR_SOURCE).toContain('toggleTaskList')
    expect(EDITOR_SOURCE).toContain('taskList: editor.isActive("taskList")')
  })

  it('样式覆盖勾选框排版、勾选态与只读态', () => {
    expect(EDITOR_SOURCE).toContain('ul[data-type="taskList"] li > label input')
    expect(EDITOR_SOURCE).toContain('li[data-checked="true"] > div')
    expect(EDITOR_SOURCE).toContain(
      '.fs-note-editor.fs-note-preview .ProseMirror ul[data-type="taskList"]',
    )
  })
})
