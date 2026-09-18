/**
 * plugin-memory 设置分区的样式：视觉语言对齐 dsh 设置页（0.5px 描边卡片 +
 * 分组小标题 + 卡片栅格），全部走宿主 --dsw-* 令牌。
 *
 * 只注入一次，选择器统一挂在 [data-dsh-memory-ui] 之下：这个根属性同时贴在
 * 设置分区根节点与每个 Modal 内容包一层上 —— Modal 是 body 级 portal，挂在分区
 * 选择器下会失配，故与分区共用同一个根标记。
 */

// 样式正文在 settings-section.css（真 CSS 文件，编辑器有高亮/补全；vite 的 `?inline` 查询返回
// 编译后的 CSS 文本且不自动注入，语义等价于原先 esbuild 的 text loader）。
import CSS from './settings-section.css?inline'

const STYLE_ATTR = 'data-dsh-memory-style'

/** 只注入一次样式。 */
export function ensureMemoryStyle(): void {
  if (typeof document === 'undefined') return
  if (document.head.querySelector('style[' + STYLE_ATTR + ']') !== null) return
  const style = document.createElement('style')
  style.setAttribute(STYLE_ATTR, '')
  style.textContent = CSS
  document.head.appendChild(style)
}
