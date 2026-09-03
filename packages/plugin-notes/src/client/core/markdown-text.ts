/**
 * Markdown → 纯文本摘要工具（仅用于列表/搜索预览，不触碰存储原文）。
 * 便签正文以 Markdown 存储；卡片行展示时先剥掉语法标记得到可读纯文本。
 * 不依赖任何解析库：面向显示的子集剥离 + 空白折叠，输出永不抛错。
 */

/** 剥掉常见 Markdown 语法标记，返回可读纯文本（单行、无语法符号）。 */
export function mdToPlainText(md: string): string {
  let text = md
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

/**
 * 取正文中第一张图片的 URL（markdown `![alt](url)`）。
 * 用于列表卡片缩略图；无图返回 null。url 形如 data:…、http(s)://… 或相对路径；
 * 支持可选的 "title" / 'title' 后缀。不解析、不校验内容，只做稳妥剥离。
 */
export function firstImageUrl(md: string): string | null {
  const match = /!\[[^\]]*\]\(\s*([^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/.exec(md)
  if (!match) return null
  const url = match[1]
  return url || null
}
