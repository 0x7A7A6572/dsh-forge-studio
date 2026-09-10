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

/** 图片节点属性（Markdown 序列化入参的最小形状）。 */
export interface NoteImageMarkdownAttrs {
  readonly src?: string | null
  readonly alt?: string | null
  readonly title?: string | null
  /** 显示宽度百分比（如 "50%"）；null/空 = 未设尺寸（走默认上限）。 */
  readonly width?: string | null
}

/** Markdown 序列化状态的最小形状（prosemirror-markdown MarkdownSerializerState 兼容）。 */
interface MarkdownWriteState {
  write(content: string): void
}

/** HTML 属性值转义（& < > "）。base64 data URL 的 src 通常不含这些字符。 */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Markdown 行内特殊字符转义（复刻 prosemirror-markdown 的 esc，非行首场景）。 */
function escapeMarkdownInline(value: string): string {
  return value.replace(/[`*\\~\[\]_]/g, (m, i) =>
    m === '_' && i > 0 && i + 1 < value.length && /\w/.test(value[i - 1]) && /\w/.test(value[i + 1])
      ? m
      : `\\${m}`,
  )
}

/**
 * 单张图片 → Markdown 字符串：有 width 输出内联 HTML `<img … width>`（tiptap-markdown
 * 默认 html:true 原样保留，加载时经 Image.parseHTML 还原 width）；无 width 输出标准
 * `![alt](src "title")`，与 prosemirror-markdown 默认图片序列化逐字节一致。
 * 抽出为纯函数便于单测；编辑器序列化钩子直接 state.write(本函数结果)。
 */
export function noteImageToMarkdown(attrs: NoteImageMarkdownAttrs): string {
  const src = attrs.src ?? ''
  const alt = attrs.alt ?? ''
  const title = attrs.title ?? ''
  const width = attrs.width && attrs.width.trim() !== '' ? attrs.width.trim() : null
  if (width) {
    return `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" width="${escapeHtmlAttr(width)}"${title ? ` title="${escapeHtmlAttr(title)}"` : ''} />`
  }
  const escapedSrc = src.replace(/[()]/g, '\\$&')
  const escapedAlt = escapeMarkdownInline(alt)
  const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : ''
  return `![${escapedAlt}](${escapedSrc}${titlePart})`
}

/** 编辑器/只读渲染共用的图片扩展（粘贴的图以 data URL 内联进正文）。
 * 新增 width 属性承载显示宽度（百分比），并覆盖 Markdown 序列化让宽度随正文往返。 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('width'),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.width) return {}
          return { width: attributes.width }
        },
      },
    }
  },
  addStorage() {
    return {
      markdown: {
        serialize: (state: MarkdownWriteState, node: { attrs: NoteImageMarkdownAttrs }): void => {
          state.write(noteImageToMarkdown(node.attrs))
        },
      },
    }
  },
}).configure({ inline: true, allowBase64: true })

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
    // 官方默认白名单（http/https/ftp/…，note:// 引用已随 v0.1 移除）。
  })
}

/**
 * 构造便签编辑器/只读渲染共用扩展列表。
 * StarterKit 默认带 codeBlock，需关掉换成 CodeBlockLowlight，避免节点重名。
 */
export function buildNoteRichTextExtensions(
  opts: { readonly?: boolean; imageNode?: AnyExtension } = {},
): AnyExtension[] {
  const readonly = opts.readonly === true
  return [
    StarterKit.configure({ codeBlock: false }),
    CodeBlockLowlight.configure({ lowlight: noteLowlight }),
    Markdown,
    opts.imageNode ?? NoteImage,
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
