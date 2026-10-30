/**
 * 设置侧边栏「智能体工坊」那一行的图标补丁。
 *
 * settings.section 槽位没有图标入口（options 只有 id/order/label）；
 * 与 plugin-memory 同一路数：按分区 label 认行，把默认齿轮换成工坊图标。
 * 外壳结构变化时补丁会静默失效，退回默认齿轮，不影响功能。
 */

import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { StudioIcon } from './StudioIcon.tsx'

const SECTION_LABELS = ['智能体工坊']
const MARKER = 'data-dsh-agent-studio-nav-icon'

let template: Element | null = null

function iconTemplate(): Element | null {
  if (template !== null) return template
  const host = document.createElement('span')
  flushSync(() => {
    createRoot(host).render(<StudioIcon name="boxes" size={16} />)
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

export function installAgentStudioNavIcon(): () => void {
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
