/**
 * 便签侧栏入口 —— 与 dsh-task-board 同构的 DOM 注入方式。
 *
 * dsh 的侧栏 shell 没有暴露可注册的外部 slot（`sidebar.workspaces` /
 * `sidebar.settings` 都是单占位、已被占用），所以入口行在「新建会话」按钮与
 * 工作区浏览器之间注入一行纯 DOM 按钮，并用 MutationObserver 自愈（React
 * 重渲染把行顶掉时同帧重插，不闪烁）。点击开/关便签板（board-store.toggle）。
 *
 * 行是纯 DOM（非 React 树），不会扰动 shell 的 reconcile；它切换的面板视图
 * 是另一个由调用方拥有的独立 React 根（见 panel-mount.ts）。与 task-board 的
 * 入口行共用同一套注入/自愈/幂等逻辑，仅图标、文案与开关动作不同。
 */

import { boardStore } from './board-store.ts'

/** 注入行的稳定 data 属性（幂等键 + 样式作用域）。 */
const ROW_SELECTOR = '[data-dsh-notes-entry]'

/** 与 shell 18px 导航图标一致的便签内联图标（折叠角文档样式）。 */
const ICON =
  '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5H4.5a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V6Z"/><path d="M10.5 2.5V6H13"/><path d="M5.5 8h5M5.5 10.5h3"/></svg>'

/** 入口行样式（以 data 属性作用域；配色走宿主 --dsw-* 令牌，明暗自适应）。 */
const ENTRY_CSS = `
[data-dsh-notes-entry] {
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
[data-dsh-notes-entry]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
[data-dsh-notes-entry][data-active] {
  background: var(--dsw-alias-interactive-bg-active);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
[data-dsh-notes-entry][data-active]:hover {
  background: var(--dsw-specific-sidebar-nav-item-active);
}
[data-dsh-notes-entry] .fs-notes-entry-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
}
[data-dsh-notes-entry] .fs-notes-entry-icon svg {
  display: block;
  width: 18px;
  height: 18px;
}
[data-dsh-notes-entry] .fs-notes-entry-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 折叠 rail（56px）：图标居中、隐藏文字，与 shell 折叠态一致。 */
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-notes-entry],
[data-sidebar-collapsed] [data-dsh-notes-entry] {
  justify-content: center;
  padding: 0;
  width: 36px;
  height: 36px;
  margin: 0 auto 12px;
  border-radius: 50%;
}
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-label,
[data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-label {
  display: none;
}
`

let styleInstalled = false

/** 一次性注入入口行样式（幂等；无 DOM 环境时 no-op）。 */
function ensureStyle(): void {
  if (styleInstalled || typeof document === 'undefined') return
  styleInstalled = true
  const el = document.createElement('style')
  el.setAttribute('data-dsh-notes-entry-style', '')
  el.textContent = ENTRY_CSS
  document.head.appendChild(el)
}

/** 定位侧栏 shell 根元素；未挂载时返回 undefined。 */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  // 当前 shell 结构：column > wrapper > root（logoRow 的拥有者）。优先取 logoRow
  // 拥有者（真正的侧栏 UI 根），旧 shell 回退到 column 首个子元素。
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

/** 「新建会话」按钮：当前 shell 嵌在 logoRow 里，旧 shell 是根的首个子按钮。 */
function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

/** 构造入口行（离屏按钮，shell 就绪后再插入）。 */
function createEntry(): { entry: HTMLButtonElement } {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute('data-dsh-notes-entry', '')
  entry.setAttribute('data-dsh-plugin', 'notes')
  entry.setAttribute('data-dsh-part', 'sidebar-entry')
  entry.setAttribute('aria-label', '智能便签')
  entry.setAttribute('title', '智能便签')
  const iconSpan = document.createElement('span')
  iconSpan.className = 'fs-notes-entry-icon'
  iconSpan.innerHTML = ICON
  const labelSpan = document.createElement('span')
  labelSpan.className = 'fs-notes-entry-label'
  labelSpan.textContent = '智能便签'
  entry.append(iconSpan, labelSpan)
  entry.addEventListener('click', () => { boardStore.toggle() })
  return { entry }
}

/**
 * 相对「家族块」定位：与 sibling 插件入口行（task-board / ssh）保持稳定相对
 * 顺序 —— 便签排在其后、工作区浏览器之前。任何 self-heal 重插都落在同一相对
 * 位置，不会因 observer 回调顺序或 shell 包装变化而交换顺序。
 */
const FAMILY_SELECTORS = ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]', '[data-dsh-notes-entry]']

/** 在「新建会话」行之后、工作区浏览器之前插入入口行。 */
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

/**
 * 挂载便签侧栏入口行，等待 shell 渲染并自愈 React 重渲染。
 * @returns 移除入口行与观察器的 disposer。
 */
export function mountNotesSidebarEntry(): () => void {
  if (typeof document === 'undefined') return () => {}
  // DOM 级幂等：无论此前由哪条路径挂过入口行（重复 apply / HMR / 残留模块），
  // 都绝不挂第二个；已有的行继续可用，刷新页面是最终重置。
  if (document.querySelector(ROW_SELECTOR) !== null) return () => {}
  ensureStyle()
  const { entry } = createEntry()
  let root: HTMLElement | undefined
  let placed = false

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      // shell 整树重建了侧栏 pane；旧 root observer 随旧树消失，从头再查。
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

  // body 级 watcher 作为「整树重建」兜底：shell 拆掉整个侧栏 pane 时只有它能看到
  // 新 pane 挂载。放置后不再 disconnect；placed-and-still-mounted 场景靠上面的
  // document.body.contains(entry) 短路，避免无关 DOM 变更（如聊天流式输出）反复全量重查。
  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  // 自愈：React 重渲染把行顶掉时，同一帧（paint 前的 microtask）重插，无闪烁。
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

  // 把面板开关态映射到行的 active 高亮；undefined 会物化成 data-active="undefined"
  // 造成常亮，必须用 delete 移除属性。
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
