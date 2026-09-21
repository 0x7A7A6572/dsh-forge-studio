/**
 * 代码块按钮的「合并式」切换：多块选区并成**一个**代码块。
 *
 * 起因：粘贴多行文本时 ProseMirror 默认把每个换行断成一个段落（剪贴板纯文本走
 * 默认解析器时的行为），这时点工具栏「代码块」，官方 toggleCodeBlock 走 setBlockType
 * 逐段转换 —— 得到一行一个代码块：正文碎成一地单行块，存成 Markdown 也是一行
 * 一个围栏（黑底因此变成一排小色条）。
 *
 * 判据：选区覆盖的顶层块 ≥ 2 且全是段落 / 代码块时自己处理（存量的单行代码块
 * 也从这条路合回一块）；其余情况一律交回官方 toggleCodeBlock —— 单块选区与光标
 * 的手感（进 / 退代码块）保持不变。
 */

import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'

/** 可合并的块类型：段落（粘贴多行的产物）与代码块（存量便签的修复入口）。 */
const MERGEABLE_BLOCKS = new Set(['paragraph', 'codeBlock'])

/** 合并结果：块内文本 + 沿用的语言（无语言或语言不一致时为 null）。 */
export interface CodeBlockMerge {
  readonly text: string
  readonly language: string | null
}

/** 块内只有文本与硬换行：图片等叶子节点会被换成 \n，一律不合并（等于丢内容）。 */
function isTextOnly(node: PMNode): boolean {
  let textOnly = true
  node.descendants((child) => {
    if (child.isText || child.type.name === 'hardBreak') return true
    if (child.isLeaf) textOnly = false
    return !child.isLeaf
  })
  return textOnly
}

/** 语言沿用规则：只有一个非空语言时沿用它，否则不设语言。 */
function sharedLanguage(blocks: readonly PMNode[]): string | null {
  const languages = new Set<string>()
  for (const block of blocks) {
    const language: unknown = block.attrs.language
    if (typeof language === 'string' && language !== '') languages.add(language)
  }
  return languages.size === 1 ? [...languages][0] : null
}

/**
 * 判断 [from, to) 这一整段顶层块能否并成一个代码块，能就取出文本与语言。
 * @param doc - 编辑器文档。
 * @param from - 首个顶层块的起始位置（$from.before(1)）。
 * @param to - 末个顶层块的结束位置（$to.after(1)）。
 * @returns 可合并时的内容；不可合并（块数 < 2、含非文本块）返回 null。
 */
export function codeBlockMerge(doc: PMNode, from: number, to: number): CodeBlockMerge | null {
  const blocks: PMNode[] = []
  doc.forEach((node, offset) => {
    if (offset >= from && offset + node.nodeSize <= to) blocks.push(node)
  })
  if (blocks.length < 2) return null
  const mergeable = blocks.every((node) => MERGEABLE_BLOCKS.has(node.type.name) && isTextOnly(node))
  if (!mergeable) return null
  return { text: doc.textBetween(from, to, '\n', '\n'), language: sharedLanguage(blocks) }
}

/** 工具栏「代码块」按钮的动作：能合并就合并，否则走官方开关。 */
export function toggleNoteCodeBlock(editor: Editor): void {
  const { state } = editor
  const { empty, $from, $to } = state.selection
  // depth 0 = 选区不在任何顶层块内（整篇 / 表格选区），没有可合并的范围。
  const merge =
    !empty && $from.depth > 0 && $to.depth > 0
      ? codeBlockMerge(state.doc, $from.before(1), $to.after(1))
      : null;
  if (merge === null) {
    editor.chain().focus().toggleCodeBlock().run();
    return;
  }
  // 整段换成一个代码块：文本按行拼回，光标由 insertContentAt 落到块尾。
  editor
    .chain()
    .focus()
    .insertContentAt(
      { from: $from.before(1), to: $to.after(1) },
      {
        type: 'codeBlock',
        attrs: { language: merge.language },
        content: merge.text === '' ? [] : [{ type: 'text', text: merge.text }],
      },
    )
    .run();
}
