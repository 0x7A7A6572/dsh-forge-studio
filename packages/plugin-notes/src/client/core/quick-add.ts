/**
 * 快捷新建便签的**独立浮层**（不经便签板）：侧栏入口行尾 ＋ 按钮触发。
 *
 * 与 dsh-task-board / plugin-notes 的「中间列接管」不同：这里**不开便签板**
 * （不碰 boardStore.open / html 激活属性），浮层直接挂在 body 上的固定层里，
 * 全窗口遮罩 + 居中新建编辑器（EditorPageDialog 复用）。关闭只收自己，不带走
 * 便签板任何状态。
 *
 * store 与 sidebar-entry / quick-add-dialog 同属纯 DOM 侧模块级单例
 * （boardStore / notesNav 同范式）：sidebar-entry 只管 show()；可见性由
 * mountQuickAdd 订阅 store 切换 <html> data 属性控制（容器 CSS display 切换）。
 */

import { createRoot, type Root } from 'react-dom/client'

type Listener = () => void

let open = false
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

export const quickAddStore = {
  get open(): boolean {
    return open
  },
  show(): void {
    if (open) return
    open = true
    emit()
  },
  hide(): void {
    if (!open) return
    open = false
    emit()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export interface QuickAddMountOptions {
  /** 把 React 树渲染进浮层容器根（index.ts 提供，注入宿主相关的保存/刷新回调）。 */
  render: (root: Root) => void
}

/** 浮层根的稳定 data 属性（幂等键 + 样式作用域）。 */
const ROOT_SELECTOR = '[data-dsh-quickadd-root]'
/** <html> 可见性属性。 */
const VIEW_ATTRIBUTE = 'data-dsh-quickadd-open'

const OVERLAY_CSS = `
/* body 级固定层：默认隐藏，打开时铺满视口；z-index 高于中间列面板接管层。 */
[data-dsh-quickadd-root] {
  position: fixed;
  inset: 0;
  z-index: 300;
  display: none;
}
html[data-dsh-quickadd-open] [data-dsh-quickadd-root] {
  display: block;
}
`

let styleInstalled = false

/** 一次性注入浮层样式（幂等；无 DOM 环境时 no-op）。 */
function ensureStyle(): void {
  if (styleInstalled || typeof document === 'undefined') return
  styleInstalled = true
  const el = document.createElement('style')
  el.setAttribute('data-dsh-quickadd-style', '')
  el.textContent = OVERLAY_CSS
  document.head.appendChild(el)
}

/**
 * 挂载快捷新建浮层根（body 子容器 + 可见性订阅）。模块级幂等：重复 apply /
 * HMR 不挂第二个；旧根由旧 fiber 的 disposer 收掉。
 * @returns 卸载浮层根与订阅的 disposer。
 */
export function mountQuickAdd(options: QuickAddMountOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(ROOT_SELECTOR) !== null) return () => {}
  ensureStyle()

  const container = document.createElement('div')
  container.setAttribute('data-dsh-quickadd-root', '')
  container.setAttribute('data-dsh-plugin', 'notes')
  document.body.appendChild(container)

  const root = createRoot(container)
  options.render(root)

  // 可见性：undefined 会物化成属性字符串，必须用 removeAttribute 收干净。
  const apply = (): void => {
    if (quickAddStore.open) document.documentElement.setAttribute(VIEW_ATTRIBUTE, '')
    else document.documentElement.removeAttribute(VIEW_ATTRIBUTE)
  }
  const unsubscribe = quickAddStore.subscribe(apply)
  apply()

  return () => {
    unsubscribe()
    document.documentElement.removeAttribute(VIEW_ATTRIBUTE)
    root.unmount()
    container.remove()
  }
}
