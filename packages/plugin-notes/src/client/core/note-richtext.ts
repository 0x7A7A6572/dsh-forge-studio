/**
 * 便签富文本「共享扩展装配层」：编辑器与只读渲染（note-preview）共用同一套
 * tiptap 扩展，保证链接 / 表格 / 代码语言高亮在编辑与展示两侧行为一致，
 * 且 Markdown 存取格式不丢（tiptap-markdown 按扩展名回退序列化：
 * codeBlock 围栏带语言、table 管道表格、link 走 [text](url)）。
 *
 * - 链接：@tiptap/extension-link（可输入规则自动链接 + 粘贴解析）；
 *   只读场景 openOnClick=true 可点开，编辑场景 false 避免误跳转。
 * - 表格：@tiptap/extension-table + row/header/cell（插入、行列增删、删除）。
 * - 代码高亮：@tiptap/extension-code-block-lowlight，配 lowlight v3 实例；
 *   common 语法集 + powershell/dos 补注册，vue 借用 xml 文法，js/ts 等
 *   别名由 highlight.js 文法自带。lowlight v3 无 registered 方法，为让
 *   tiptap 的装饰判定把「别名语言」也放行，这里给实例挂一个 registered。
 * - 图片：@tiptap/extension-image（base64 内联）——原 note-editor 定义挪来
 *   一处，避免编辑器与只读渲染各自配置漂移。
 */

import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import Image from '@tiptap/extension-image'
import type { AnyExtension } from '@tiptap/core'
import { Markdown } from 'tiptap-markdown'
import { createLowlight, common } from 'lowlight'
import powershell from 'highlight.js/lib/languages/powershell'
import dos from 'highlight.js/lib/languages/dos'
import xml from 'highlight.js/lib/languages/xml'

/** 编辑器/只读渲染共用的图片扩展（粘贴的图以 data URL 内联进正文）。 */
export const NoteImage = Image.configure({ inline: true, allowBase64: true })

/** 表格扩展组（table 需要 row/header/cell 三个伙伴节点才可实例化）。 */
export const NoteTableKit = (): AnyExtension[] => [
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

/** 链接扩展：输入时自动识别可链接地址、粘贴即转链接。 */
export function noteLinkExtension(readonly: boolean): AnyExtension {
  return Link.configure({
    // 只读展示可点开；编辑态点击应落光标而非跳走。
    openOnClick: readonly,
    autolink: true,
    linkOnPaste: true,
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    // 官方默认白名单(http/https/ftp/…)+ note:（便签互链 / note:// 引用）。
    protocols: ['note'],
  })
}

/**
 * 构造便签编辑器/只读渲染共用扩展列表。
 * StarterKit 默认带 codeBlock，需关掉换成 CodeBlockLowlight，避免节点重名。
 */
export function buildNoteRichTextExtensions(
  opts: { readonly?: boolean } = {},
): AnyExtension[] {
  const readonly = opts.readonly === true
  return [
    StarterKit.configure({ codeBlock: false }),
    CodeBlockLowlight.configure({ lowlight: noteLowlight }),
    Markdown,
    NoteImage,
    noteLinkExtension(readonly),
    ...NoteTableKit(),
  ]
}

type BaseLowlight = ReturnType<typeof createLowlight>

/** 能否对某语言标记精确高亮（低版本 lowlight 无 registered 时才需要）。 */
function canHighlight(
  lowlight: BaseLowlight,
  name: string | null | undefined,
): boolean {
  if (!name) return false
  try {
    lowlight.highlight(name, '')
    return true
  } catch {
    return false
  }
}

/**
 * 语法高亮文法注册表（common + 补漏），模块加载时初始化一次。
 * lowlight v3 未暴露 registered()，@tiptap/extension-code-block-lowlight 的
 * 装饰判定会调用它来决定「该语言是否可精确高亮」（拿不到会退化为自动识别，
 * js/tsx/vue 等别名语言会被误判），这里补一个基于试跑的判定：
 * 能对空串高亮即认为已注册（未注册语言会抛 Unknown language）。
 */
const baseLowlight = createLowlight(common)
baseLowlight.register({
  powershell,
  dos, // bat/cmd 批处理
  vue: xml, // Vue SFC 暂以 XML 文法高亮模板/标签部分
})
export const noteLowlight = Object.assign(baseLowlight, {
  registered: (name: string): boolean => canHighlight(baseLowlight, name),
}) as BaseLowlight & { registered: (name: string) => boolean }

/** 公开判定的同款实现：某语言标记当前是否可精确高亮。 */
export function isCodeLanguageHighlightable(
  language: string | null | undefined,
): boolean {
  return canHighlight(baseLowlight, language)
}
