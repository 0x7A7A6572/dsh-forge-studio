/**
 * 设置侧边栏「工作报告」那一行的图标补丁。
 *
 * 背景（已核实，非推测）：
 * 侧边栏每个分区的图标来自 @deepseek-ai/dsh-client-ui-settings-general 里的一个
 * **硬编码 id 映射** —— 只有 models / agent-presets / plugins 有专属图标，其余一律
 * 吃默认齿轮 IconSettingsOutlineMedium。settings.section 槽位**没有图标入口**（options
 * 只有 id/order/label，owner props 只有 close），导航按钮上也没有 id/data 属性，
 * 所以只能按标签文本认行。
 *
 * 做法与本机已有的 dsh-skill-hub 一致：作用域 DOM 补丁，把「工作报告」那一行的齿轮
 * 换成我们选定的官方图标，并在设置面板重渲染后补回去。替换时继承外壳原有的
 * className，尺寸与颜色（currentColor）仍由外壳的 .navIcon 控制，所以跟随主题。
 *
 * 这是补丁性质：外壳若改动导航结构，这里会静默失效（最坏退回默认齿轮），不会报错。
 */

import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { IconListPenOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** 认行依据：分区注册时的 label（见 src/client/index.ts）。 */
const SECTION_LABELS = ['工作报告', 'Work report']
const MARKER = 'data-dsh-dailylog-nav-icon'

let template: Element | null = null

/** 同步渲染一次官方图标并缓存；之后每次补丁克隆它（MutationObserver 里不能等调度）。 */
function iconTemplate(): Element | null {
  if (template !== null) return template
  const host = document.createElement('span')
  flushSync(() => {
    createRoot(host).render(<IconListPenOutlineRegular size={16} />)
  })
  const rendered = host.firstElementChild
  if (rendered === null) return null
  template = rendered
  return template
}

function patchButton(button: Element): void {
  const current = button.querySelector('svg')
  if (current === null || current.getAttribute(MARKER) === 'true') return
  const icon = iconTemplate()
  if (icon === null) return
  const replacement = icon.cloneNode(true) as Element
  const className = current.getAttribute('class')
  if (className !== null && className !== '') replacement.setAttribute('class', className)
  replacement.setAttribute(MARKER, 'true')
  current.replaceWith(replacement)
}

function patchNavIcon(): void {
  const dialog = document.querySelector('[role="dialog"]')
  if (dialog === null) return
  for (const button of dialog.querySelectorAll('button')) {
    const label = button.querySelector('span')
    if (label === null) continue
    if (!SECTION_LABELS.includes(label.textContent?.trim() ?? '')) continue
    patchButton(button)
  }
}

/**
 * 挂上补丁并返回 disposer。无 DOM 环境（SSR、单测）直接空转，绝不抛错；
 * 补丁本身失败也只降级为「保持默认齿轮」，不影响分区功能。
 */
export function installDailyLogNavIcon(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  try {
    patchNavIcon()
    const observer = new MutationObserver(() => { patchNavIcon() })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { observer.disconnect() }
  } catch {
    return () => {}
  }
}
