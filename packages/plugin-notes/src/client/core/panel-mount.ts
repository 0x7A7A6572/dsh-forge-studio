/**
 * 中间列面板接管 —— 与 dsh-task-board 同构。
 *
 * 会话区（`conversation` slot）是单占位（ui-conversation），外部插件无法声明
 * slot，所以便签板在 DOM 层接管中间列：在中间列（`[class*="centerCol"]`，新版
 * AppFrame 布局；旧 shell 是 `[data-pane="conversation"]`）追加一个 React 从不
 * 管理的额外尾随子容器，再靠一条样式规则在面板激活时隐藏会话内容。开关是
 * `<html>` 上的 data 属性 —— 不涉及 React，会话子树保持挂载与状态。
 *
 * 打开便签板时驱逐 sibling 面板（task-board / ssh）的激活属性，并广播
 * `dsh-panel-activate`；反向亦然（sibling 激活时关掉便签板）。点击侧栏会话行
 * 也把中间列交还会话。
 */

import { createRoot, type Root } from 'react-dom/client'
import { boardStore } from './board-store.ts'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
/** 跨插件激活事件；detail 为激活的面板名。 */
const ACTIVATE_EVENT = 'dsh-panel-activate'
/** 本面板的 `<html>` 激活属性。 */
const VIEW_ATTRIBUTE = 'data-dsh-notes-active'
/** sibling 面板的激活属性（打开本面板时驱逐）。 */
const SIBLING_ATTRIBUTES = ['data-dsh-taskboard-active', 'data-dsh-ssh-active', 'data-dsh-dailylog-active']
/** sibling 面板的广播名（其激活时关掉本面板）。 */
const SIBLING_PANEL_NAMES = ['taskboard', 'ssh', 'dailylog']
// 侧栏会话行：点击把中间列交还会话（含已当前行，其点击不产生 session-change
// 事件）。捕获阶段监听，让面板在 shell 处理点击前先关。
const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/** 中间列接管样式（属性作用域；配色走宿主 --dsw-* 令牌）。 */
const TAKEOVER_CSS = `
[data-pane='conversation'],
[class*='centerCol'] {
  position: relative;
}
[data-dsh-notes-view] {
  position: absolute;
  inset: 0;
  display: none;
  z-index: 60;
  background: var(--dsw-alias-bg-base);
}
/* 中间列单占位；:not() 守卫避免与 sibling 面板（task-board / ssh / daily-log）争夺可见性。 */
html[data-dsh-notes-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-dailylog-active]) [data-dsh-notes-view] {
  display: block;
}
/* 面板激活时隐藏会话内容（保持挂载与状态）。!important 必要：新版 shell 用
   inline display:contents 包会话视图，inline 样式会压过普通样式规则，不写
   !important 输入卡片仍会露出并盖在面板底部。 */
html[data-dsh-notes-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-dailylog-active]) [data-pane='conversation'] > :not([data-dsh-notes-view]),
html[data-dsh-notes-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]):not([data-dsh-dailylog-active]) [class*='centerCol'] > :not([data-dsh-notes-view]) {
  display: none !important;
}
`

let styleInstalled = false

/** 一次性注入接管样式（幂等；无 DOM 环境时 no-op）。 */
function ensureStyle(): void {
  if (styleInstalled || typeof document === 'undefined') return
  styleInstalled = true
  const el = document.createElement('style')
  el.setAttribute('data-dsh-notes-takeover-style', '')
  el.textContent = TAKEOVER_CSS
  document.head.appendChild(el)
}

/** 定位中间列；框架未挂载时返回 undefined。 */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

export interface NotesPanelMountOptions {
  /** 把便签板 React 树渲染进容器根（初始挂载 / 重建 / 语言切换刷新）。 */
  render: (root: Root) => void
}

/**
 * 把便签板挂到中间列，并绑定其可见性到 boardStore.open。
 * @returns 卸载 React 树、移除容器并恢复中间列的 disposer。
 */
export function mountNotesPanel(options: NotesPanelMountOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  ensureStyle()
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      // 会话 pane 被替换：丢弃旧树并重建。
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshNotesView = ''
    container.dataset.dshPlugin = 'notes'
    column.appendChild(container)
    root = createRoot(container)
    options.render(root)
  }

  // 框架在 boot 结算后挂载；观察 body 等中间列出现。
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (boardStore.open) {
      // 单占位中间列：打开本面板必须驱逐 sibling 面板的 html 激活属性，否则两
      // 套可见性规则互搏、第二次点击看起来像没反应。
      for (const attr of SIBLING_ATTRIBUTES) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(VIEW_ATTRIBUTE, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'notes' }))
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
