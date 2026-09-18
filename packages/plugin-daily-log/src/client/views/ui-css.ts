/**
 * daily-log 工作区的样式：视觉语言对齐 dsh 设置页（Agent 预设分区）——
 * 0.5px 描边卡片 + 卡片栅格 + 分组小标题 + 虚线新增位，全部走宿主 --dsw-* 令牌。
 *
 * 只注入一次，选择器统一挂在 [data-dsh-dailylog-ui] 之下：这个根属性同时贴在
 * 设置分区根节点与每个 Modal 内容包一层上——Modal 是 body 级 portal，挂在分区
 * 选择器下会失配，故与分区共用同一个根标记。
 */

/**
 * 样式根标记 `data-dsh-dailylog-ui`：设置分区根节点与每个 Modal 内容包装层都带它
 * （见 views/parts.tsx 的 DialogRoot）。
 */
// 样式正文在 ui-css.css（真 CSS 文件，编辑器有高亮/补全；vite 的 `?inline` 查询返回
// 编译后的 CSS 文本且不自动注入，语义等价于原先 esbuild 的 text loader）。
import CSS from './ui-css.css?inline'

const STYLE_ATTR = 'data-dsh-dailylog-style'

let installed = false

/** 幂等注入分区样式（只挂一个 <style>，卸载不回收：与侧栏入口样式同一约定）。 */
export function ensureDailyLogStyle(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  if (document.querySelector('style[' + STYLE_ATTR + ']') !== null) return
  const el = document.createElement('style')
  el.setAttribute(STYLE_ATTR, '')
  el.textContent = CSS
  document.head.appendChild(el)
}
