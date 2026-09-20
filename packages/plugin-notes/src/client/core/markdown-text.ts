/**
 * Markdown → 纯文本摘要工具（仅用于列表/搜索预览，不触碰存储原文）。
 * 便签正文以 Markdown 存储；卡片行展示时先剥掉语法标记得到可读纯文本。
 * 不依赖任何解析库：面向显示的子集剥离 + 空白折叠，输出永不抛错。
 * 另有 todoProgress：只统计正文里的 Markdown 待办项完成度（纸卡/行列表徽标用）。
 */

/** 剥掉常见 Markdown 语法标记，返回可读纯文本（单行、无语法符号）。 */
export function mdToPlainText(md: string): string {
  const text = md
  // 代码块：去掉围栏，内容按纯文本保留
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
  // 行内代码
    .replace(/`{1,3}([^`\n]+)`{1,3}/g, '$1')
  // 图片 ![alt](url) → alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 链接 [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 标题标记
    .replace(/^#{1,6}\s+/gm, '')
  // 引用
    .replace(/^>\s?/gm, '')
  // 无序列表
    .replace(/^\s*[-*+]\s+/gm, '')
  // 有序列表
    .replace(/^\s*\d+[.)]\s+/gm, '')
  // 任务清单勾选框（须在列表标记剥离之后）
    .replace(/^\s*\[[ xX]\]\s*/gm, '')
  // 分隔线 --- / *** / ___
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
  // 删除线
    .replace(/~~([^~]+)~~/g, '$1')
  // 加粗+斜体 / 加粗 / 斜体
    .replace(/(\*\*\*|___)(.+?)\1/g, '$2')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
  // 残留 HTML 标签
    .replace(/<[^>]+>/g, '')
  // 空白折叠为单空格
    .replace(/\s+/g, ' ')
    .trim()
  return text
}

/**
 * 生成列表摘要：剥语法 + 折叠空白 + 按 maxLength 截断（尾部追加 …）。
 * 长度按码元计，CJK/emoji 安全（不会产生半个代理对之外的破坏）。
 */
export function mdSnippet(md: string, maxLength = 120): string {
  const plain = mdToPlainText(md)
  if (plain.length <= maxLength) return plain
  return `${plain.slice(0, maxLength)}…`
}

/** 待办清单完成度：done = 已勾选数，total = 总项数（total > 0 时才有意义）。 */
export interface TodoProgress {
  readonly done: number
  readonly total: number
}

/**
 * 待办项识别：可选的缩进 + 列表标记（- * + 或 1. / 1)）+ 勾选框 `[ ]` / `[x]`。
 * 允许任意缩进（嵌套清单里同样计数）。
 */
const TODO_ITEM_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\](?=[ \t]|$)/gm

/**
 * 统计正文里的 Markdown 待办项（`- [ ]` / `- [x]`）：返回 { done, total }；
 * 正文没有待办项时返回 null（调用方据此不显示徽标）。围栏代码块（```/~~~）
 * 整体剔除后再统计——写在代码示例里的勾选框不算真清单。纯文本扫描，不解析、不抛错。
 */
export function todoProgress(md: string): TodoProgress | null {
  if (!md) return null
  const body = md.replace(/```[\s\S]*?```/g, '').replace(/~~~[\s\S]*?~~~/g, '')
  let done = 0
  let total = 0
  for (const item of body.matchAll(TODO_ITEM_RE)) {
    total += 1
    if (item[1] !== ' ') done += 1
  }
  return total > 0 ? { done, total } : null
}

/**
 * 取正文中第一张图片的 URL：markdown `![alt](url)` 或内联 HTML `<img src="…">`
 * （设过显示尺寸的图会序列化为 <img>，这里一并识别，保证卡片缩略图不丢）。
 * 用于列表卡片缩略图；无图返回 null。url 形如 data:…、http(s)://… 或相对路径；
 * markdown 形式支持可选的 "title" / 'title' 后缀。不解析、不校验内容，只做稳妥剥离。
 */
export function firstImageUrl(md: string): string | null {
  const mdMatch = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/.exec(md)
  const htmlMatch = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(md)
  if (!mdMatch && !htmlMatch) return null
  if (mdMatch && htmlMatch) {
    return (mdMatch.index < htmlMatch.index ? mdMatch[1] : htmlMatch[1]) || null
  }
  const url = mdMatch ? mdMatch[1] : (htmlMatch as RegExpExecArray)[1]
  return url || null
}
