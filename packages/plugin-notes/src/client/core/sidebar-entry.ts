/**
 * 便签侧栏入口 —— 与 dsh-task-board 同构的 DOM 注入方式。
 *
 * dsh 的侧栏 shell 没有暴露可注册的外部 slot（`sidebar.workspaces` /
 * `sidebar.settings` 都是单占位、已被占用），所以入口行在「新建会话」按钮与
 * 工作区浏览器之间注入一行纯 DOM，并用 MutationObserver 自愈（React
 * 重渲染把行顶掉时同帧重插，不闪烁）。
 *
 * 行是纯 DOM（非 React 树），不会扰动 shell 的 reconcile；它切换的面板视图
 * 是另一个由调用方拥有的独立 React 根（见 panel-mount.ts）。与 task-board 的
 * 入口行共用同一套注入/自愈/幂等逻辑，仅图标、文案与开关动作不同。
 *
 * 行内结构（容器 + 两个按钮，避免 button 嵌套 button）：
 * - toggle（占满行宽）：图标 + 「智能便签」+ 活动待办计数徽标（notes-stats
 *   订阅，0 隐藏 / >0 便签黄底深字）；点击开/关便签板（board-store.toggle）；
 * - add（行尾小圆钮）：快捷新建 —— 弹**独立**新建编辑器浮层（core/quick-add），
 *   不开便签板（不动 board-store.open）、不动视图/筛选/搜索。
 */

import { boardStore } from './board-store.ts'
import { quickAddStore } from './quick-add.ts'
import { notesStatsStore, openTaskText } from './notes-stats.ts'

/** 注入行的稳定 data 属性（幂等键 + 样式作用域）。 */
const ROW_SELECTOR = '[data-dsh-notes-entry]'

/** 与 shell 18px 导航图标一致的便签内联图标（折叠角文档样式）。 */
const ICON =
  '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5H4.5a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V6Z"/><path d="M10.5 2.5V6H13"/><path d="M5.5 8h5M5.5 10.5h3"/></svg>'

/** 快捷新建的加号图标（按钮 22px，图标 12px）。 */
const PLUS_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>'

/** 入口行样式（以 data 属性作用域；配色走宿主 --dsw-* 令牌，明暗自适应）。 */
const ENTRY_CSS = `
[data-dsh-notes-entry] {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 36px;
  padding: 0 8px 0 10px;
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
/* 主开关按钮：占满行宽，透明继承行样式。 */
[data-dsh-notes-entry] .fs-notes-entry-toggle {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  white-space: nowrap;
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
  min-width: 0;
}
/* 「待办 N」文字小签：0 时 hidden（sync 控制）；>0 便签黄底深字小方签（非胶囊/圆点）。 */
[data-dsh-notes-entry] .fs-notes-entry-count {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  flex: none;
  margin-left: auto;
  padding: 2px 5px;
  border-radius: 3px;
  background: #e3b341;
  color: #2e2a22;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
[data-dsh-notes-entry] .fs-notes-entry-count[hidden] {
  display: none;
}
/* 快捷新建：行尾小圆钮。 */
[data-dsh-notes-entry] .fs-notes-entry-add {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
[data-dsh-notes-entry] .fs-notes-entry-add:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
[data-dsh-notes-entry] .fs-notes-entry-add svg {
  display: block;
}
[data-dsh-notes-entry] button:focus-visible {
  outline: 2px solid var(--dsw-static-deepseek-450);
  outline-offset: -2px;
  border-radius: 6px;
}
/* 折叠 rail（56px）：图标居中、隐藏文字与徽标/快捷钮，与 shell 折叠态一致。 */
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-notes-entry],
[data-sidebar-collapsed] [data-dsh-notes-entry] {
  justify-content: center;
  padding: 0;
  width: 36px;
  height: 36px;
  margin: 0 auto 12px;
  border-radius: 50%;
}
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-toggle,
[data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-toggle {
  justify-content: center;
}
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-label,
[data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-label,
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-count,
[data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-count,
[data-dsh-frame][data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-add,
[data-sidebar-collapsed] [data-dsh-notes-entry] .fs-notes-entry-add {
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

/** 构造入口行（离屏容器，shell 就绪后再插入）。 */
function createEntry(): {
  entry: HTMLDivElement
  toggle: HTMLButtonElement
  add: HTMLButtonElement
  count: HTMLSpanElement
} {
  const entry = document.createElement('div')
  entry.setAttribute('data-dsh-notes-entry', '')
  entry.setAttribute('data-dsh-plugin', 'notes')
  entry.setAttribute('data-dsh-part', 'sidebar-entry')

  // 主开关：图标 + 文字 + 活动待办徽标。
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'fs-notes-entry-toggle'
  toggle.setAttribute('aria-label', '智能便签')
  toggle.setAttribute('title', '智能便签')
  const iconSpan = document.createElement('span')
  iconSpan.className = 'fs-notes-entry-icon'
  iconSpan.innerHTML = ICON
  const labelSpan = document.createElement('span')
  labelSpan.className = 'fs-notes-entry-label'
  labelSpan.textContent = '智能便签'
  const countSpan = document.createElement('span')
  countSpan.className = 'fs-notes-entry-count'
  countSpan.hidden = true
  toggle.append(iconSpan, labelSpan, countSpan)
  toggle.addEventListener('click', () => { boardStore.toggle() })

  // 快捷新建：行尾小圆钮。
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'fs-notes-entry-add'
  add.setAttribute('aria-label', '快捷新建便签')
  add.setAttribute('title', '快捷新建便签')
  add.innerHTML = PLUS_SVG
  add.addEventListener('click', (event) => {
    event.stopPropagation()
    quickAddStore.show()
  })

  entry.append(toggle, add)
  return { entry, toggle, add, count: countSpan }
}

/**
 * 相对「家族块」定位：与 sibling 插件入口行（task-board / ssh）保持稳定相对
 * 顺序 —— 便签排在其后、工作区浏览器之前。任何 self-heal 重插都落在同一相对
 * 位置，不会因 observer 回调顺序或 shell 包装变化而交换顺序。
 */
const FAMILY_SELECTORS = ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]', '[data-dsh-notes-entry]']

/** 在「新建会话」行之后、工作区浏览器之前插入入口行。 */
function placeEntry(root: HTMLElement, entry: HTMLDivElement): boolean {
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
  const { entry, count } = createEntry()
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

  // 「待办 N」小签：0 隐藏；文案 openTaskText（99+ 封顶）；同步 aria/title。
  const syncPill = (): void => {
    const n = notesStatsStore.openTasks
    const text = openTaskText(n)
    count.hidden = text === ''
    count.textContent = text
    const suffix = text === '' ? '' : `（${text}）`
    const toggle = entry.querySelector<HTMLButtonElement>('.fs-notes-entry-toggle')
    if (toggle !== null) {
      toggle.setAttribute('aria-label', `智能便签${suffix}`)
      toggle.setAttribute('title', `智能便签${suffix}`)
    }
  }
  const unsubscribeStats = notesStatsStore.subscribe(syncPill)
  syncPill()

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribeActive()
    unsubscribeStats()
    entry.remove()
  }
}