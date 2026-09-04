/**
 * 便签代码块「语言选择器」数据源（纯表，无 tiptap 依赖，便于单测）。
 * value 即写入 Markdown 围栏的语言标记（如 ```js）；空串 = 无语言。
 * 高亮支持由 note-richtext.ts 里的 lowlight 注册表兜底：
 * html/js/css/bash/python/json/yaml/sql/xml/markdown/diff/ini 来自
 * lowlight 的 common 语法集，powershell/dos 单独注册，vue 借用 xml 文法；
 * jsx/tsx 分别走 javascript/typescript 自带的别名（react 即 jsx 写法）。
 */

export interface CodeLanguageOption {
  /** 围栏语言标记（写入 markdown 的值）；'' 表示无语言。 */
  readonly value: string
  /** 下拉里展示的名称。 */
  readonly label: string
}

/** 无语言（自动/纯文本）占位项，恒为列表第一项。 */
export const CODE_LANGUAGE_NONE: CodeLanguageOption = {
  value: '',
  label: '无语言',
}

/** 代码块语言候选（按使用频次排序，value 与 label 一一对应）。 */
export const CODE_LANGUAGES: readonly CodeLanguageOption[] = [
  CODE_LANGUAGE_NONE,
  { value: 'html', label: 'HTML' },
  { value: 'js', label: 'JavaScript' },
  { value: 'ts', label: 'TypeScript' },
  { value: 'jsx', label: 'React (JSX)' },
  { value: 'tsx', label: 'React (TSX)' },
  { value: 'vue', label: 'Vue' },
  { value: 'css', label: 'CSS' },
  { value: 'bash', label: 'Shell / Bash' },
  { value: 'ps', label: 'PowerShell' },
  { value: 'bat', label: '批处理 (BAT/CMD)' },
  { value: 'python', label: 'Python' },
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'sql', label: 'SQL' },
  { value: 'xml', label: 'XML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'diff', label: 'Diff' },
  { value: 'ini', label: 'INI / 配置' },
]

/** 下拉需要的全部合法 value 集合（快速查找用）。 */
const CODE_LANGUAGE_VALUES: ReadonlySet<string> = new Set(
  CODE_LANGUAGES.map((o) => o.value),
)

/** 判断某 value 是否在候选列表中（'' 也算合法）。 */
export function isCodeLanguageOption(value: string): boolean {
  return CODE_LANGUAGE_VALUES.has(value)
}

/** value → 展示名；未知值回退原样，'' 显示「无语言」。 */
export function codeLanguageLabel(value: string | null | undefined): string {
  if (!value) return CODE_LANGUAGE_NONE.label
  return (
    CODE_LANGUAGES.find((o) => o.value === value)?.label ?? value
  )
}
