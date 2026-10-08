/** 编辑器与只读渲染共用这套扩展装配，两侧行为与 Markdown 往返须一致。 */

import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import Image from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import type { AnyExtension } from '@tiptap/core'
import { Markdown } from 'tiptap-markdown'
import { createLowlight, common } from 'lowlight'
import powershell from 'highlight.js/lib/languages/powershell'
import dos from 'highlight.js/lib/languages/dos'
import xml from 'highlight.js/lib/languages/xml'

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

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Markdown 行内特殊字符转义（复刻 prosemirror-markdown 的 esc，非行首场景）。 */
function escapeMarkdownInline(value: string): string {
  return value.replace(/[`*\\~[\]_]/g, (m, i) =>
    m === '_' && i > 0 && i + 1 < value.length && /\w/.test(value[i - 1]) && /\w/.test(value[i + 1])
      ? m
      : `\\${m}`,
  )
}

/**
 * 单张图片 → Markdown：有 width 走内联 `<img … width>`（tiptap-markdown 的
 * html:true 原样保留，加载时由 Image.parseHTML 还原）；无 width 走标准
 * `![alt](src "title")`，与 prosemirror-markdown 默认序列化逐字节一致。
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

/**
 * 待办清单扩展组。节点名必须是官方 `taskList` / `taskItem`：tiptap-markdown
 * 按扩展名回退找内置规格，改名即丢 `- [ ]` / `- [x]` 存取。
 */
export const NoteTaskListKit = (): AnyExtension[] => [
  TaskList,
  TaskItem.configure({ nested: true }),
]

export const NoteTableKit = (): AnyExtension[] => [
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
]

export function noteLinkExtension(readonly: boolean): AnyExtension {
  return Link.configure({
    openOnClick: readonly,
    autolink: true,
    linkOnPaste: true,
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
  })
}

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
    ...NoteTaskListKit(),
    ...NoteTableKit(),
  ]
}

type BaseLowlight = ReturnType<typeof createLowlight>

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
 * 语法高亮注册表。lowlight v3 没有 registered()，而 tiptap 的装饰判定靠它
 * 决定「该语言能否精确高亮」，这里补一个试跑判定：
 * 能高亮空串即算已注册（未注册语言会抛 Unknown language）。
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

export function isCodeLanguageHighlightable(
  language: string | null | undefined,
): boolean {
  return canHighlight(baseLowlight, language)
}
