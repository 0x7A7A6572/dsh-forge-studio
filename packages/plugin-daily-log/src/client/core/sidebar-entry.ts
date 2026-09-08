/**
 * daily-log 侧栏入口 —— 与 dsh-task-board / plugin-notes 同构的 DOM 注入方式。
 * 侧栏 shell 无可注册外部 slot，入口行在「新建会话」按钮与工作区浏览器之间注入
 * 一行纯 DOM 按钮，MutationObserver 自愈（React 重渲染把行顶掉时同帧重插）。
 * 点击开/关 daily-log 面板（board-store.toggle）。与 sibling 入口行共用注入/自愈/幂等逻辑。
 */

import { boardStore } from './board-store.ts'

const ROW_SELECTOR = '[data-dsh-dailylog-entry]'

const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/></svg>'

const ENTRY_CSS = `
[data-dsh-dailylog-entry] {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 13px;
  font-family: var(--dsw-font-family, inherit);
  white-space: nowrap;
}
[data-dsh-dailylog-entry]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
[data-dsh-dailylog-entry][data-active] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
[data-dsh-dailylog-entry][data-active]:hover {
  background: var(--dsw-specific-sidebar-nav-item-active);
}
[data-dsh-dailylog-entry] .fs-dailylog-entry-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
}
[data-dsh-dailylog-entry] .fs-dailylog-entry-icon svg {
  display: block;
  width: 18px;
  height: 18px;
}
[data-dsh-dailylog-entry] .fs-dailylog-entry-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-dailylog-entry],
[data-sidebar-collapsed] [data-dsh-dailylog-entry] {
  justify-content: center;
  padding: 0;
  width: 36px;
  height: 36px;
  margin: 0 auto 12px;
  border-radius: 50%;
}
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-dailylog-entry] .fs-dailylog-entry-label,
[data-sidebar-collapsed] [data-dsh-dailylog-entry] .fs-dailylog-entry-label {
  display: none;
}
`

let styleInstalled = false

function ensureStyle(): void {
  if (styleInstalled || typeof document === 'undefined') return
  styleInstalled = true
  const el = document.createElement('style')
  el.setAttribute('data-dsh-dailylog-entry-style', '')
  el.textContent = ENTRY_CSS
  document.head.appendChild(el)
}

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

function createEntry(): { entry: HTMLButtonElement } {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute('data-dsh-dailylog-entry', '')
  entry.setAttribute('data-dsh-plugin', 'daily-log')
  entry.setAttribute('data-dsh-part', 'sidebar-entry')
  entry.setAttribute('aria-label', '工作报告')
  entry.setAttribute('title', '工作报告')
  const iconSpan = document.createElement('span')
  iconSpan.className = 'fs-dailylog-entry-icon'
  iconSpan.innerHTML = ICON
  const labelSpan = document.createElement('span')
  labelSpan.className = 'fs-dailylog-entry-label'
  labelSpan.textContent = '工作报告'
  entry.append(iconSpan, labelSpan)
  entry.addEventListener('click', () => { boardStore.toggle() })
  return { entry }
}

const FAMILY_SELECTORS = ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]', '[data-dsh-notes-entry]', '[data-dsh-dailylog-entry]']

function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = (row !== null && row.parentElement === root) ? row : button
    const family = Array.from(root.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches(FAMILY_SELECTORS.join(', ')),
    )
    const anchor = family.length > 0 ? family[family.length - 1]!.nextElementSibling : base.nextElementSibling
    root.insertBefore(entry, anchor)
  }
  return true
}

export function mountDailyLogSidebarEntry(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(ROW_SELECTOR) !== null) return () => {}
  ensureStyle()
  const { entry } = createEntry()
  let root: HTMLElement | undefined
  let placed = false

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    if (placed) {
      if (document.body.contains(entry)) return
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) rootObserver.observe(root, { childList: true, subtree: true })
  }

  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) {
      placed = placeEntry(root, entry)
    }
  })

  const syncActive = (): void => {
    if (boardStore.open) entry.dataset.active = 'true'
    else delete entry.dataset.active
  }
  const unsubscribeActive = boardStore.subscribe(syncActive)
  syncActive()

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribeActive()
    entry.remove()
  }
}
