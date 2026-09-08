/**
 * daily-log 中间列面板接管 —— 与 plugin-notes 同构。会话区（conversation slot）是
 * 单占位，外部插件无法声明 slot，故在 DOM 层接管中间列：追加一个 React 不管的尾随
 * 子容器，面板激活时用样式规则隐藏会话内容。开关是 <html> 上的 data 属性。
 * 打开时驱逐 sibling 面板（taskboard / ssh / notes）并广播 dsh-panel-activate。
 */

import { createRoot, type Root } from 'react-dom/client'
import { boardStore } from './board-store.ts'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVATE_EVENT = 'dsh-panel-activate'
const VIEW_ATTRIBUTE = 'data-dsh-dailylog-active'
const SIBLING_ATTRIBUTES = ['data-dsh-taskboard-active', 'data-dsh-ssh-active', 'data-dsh-notes-active']
const SIBLING_PANEL_NAMES = ['taskboard', 'ssh', 'notes']
const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

const TAKEOVER_CSS = `
[data-pane='conversation'],
[class*='centerCol'] {
  position: relative;
}
[data-dsh-dailylog-view] {
  position: absolute;
  inset: 0;
  display: none;
  z-index: 60;
  background: var(--dsw-alias-bg-base);
}
html[data-dsh-dailylog-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-notes-active]) [data-dsh-dailylog-view] {
  display: block;
}
html[data-dsh-dailylog-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-notes-active]) [data-pane='conversation'] > :not([data-dsh-dailylog-view]),
html[data-dsh-dailylog-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-notes-active]) [class*='centerCol'] > :not([data-dsh-dailylog-view]) {
  display: none !important;
}
`

let styleInstalled = false

function ensureStyle(): void {
  if (styleInstalled || typeof document === 'undefined') return
  styleInstalled = true
  const el = document.createElement('style')
  el.setAttribute('data-dsh-dailylog-takeover-style', '')
  el.textContent = TAKEOVER_CSS
  document.head.appendChild(el)
}

function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

export interface DailyLogPanelMountOptions {
  render: (root: Root) => void
}

export function mountDailyLogPanel(options: DailyLogPanelMountOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  ensureStyle()
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    // 用 setAttribute 而非 dataset：dataset 的 camelCase→kebab-case 会把
    // dshDailyLogView 转成 data-dsh-daily-log-view（DailyLog 的 D/L 各拆一个 `-`），
    // 与接管 CSS 的 [data-dsh-dailylog-view] 选择器不匹配 → display:none 不生效，
    // 面板默认可见并叠在会话上。这里直接写死 data-dsh-dailylog-view。
    container.setAttribute('data-dsh-dailylog-view', '')
    container.dataset.dshPlugin = 'daily-log'
    column.appendChild(container)
    root = createRoot(container)
    options.render(root)
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (boardStore.open) {
      for (const attr of SIBLING_ATTRIBUTES) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(VIEW_ATTRIBUTE, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'dailylog' }))
    } else {
      document.documentElement.removeAttribute(VIEW_ATTRIBUTE)
    }
  }
  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    if (SIBLING_PANEL_NAMES.includes(detail as string) && boardStore.open) boardStore.hide()
  }
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!boardStore.open) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) boardStore.hide()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = boardStore.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(VIEW_ATTRIBUTE)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
