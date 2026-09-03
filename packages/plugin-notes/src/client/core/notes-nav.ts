/**
 * 便签板内部页面导航（状态路由）：浮层内容现在由导航 store 决定，
 * board-overlay 只做数据控制器 + 路由出口，不再持有 draft/settingsOpen 本地 state。
 *
 * 路由 = 判别联合（类型互斥）：page 'editor' 必带 draft（create | edit+note），
 * page 'board' 必不带；设置弹窗是与页面正交的浮层层（settingsOpen，现状 UX：
 * 只从列表页 header 齿轮打开，浮在内容之上）。
 *
 * 模块级单例（与 board-store 相同的 subscribe + useSyncExternalStore 范式）；
 * 与浮层开关（board-store.open）解耦：关掉浮层再开，停留在原页面/弹窗态，
 * 与改造前组件 state 的语义一致（组件挂载期 state 本就跨开关保留）。
 *
 * 新增页面：扩展 NotesPage / NotesRoute 联合 → 这里补动作 → overlay 的
 * 渲染 switch 加一支。
 */

import type { NoteRecord } from '../../types.ts'

/** 新建/编辑草稿目标（沿用原 board-overlay Draft 语义，类型上收至此）。 */
export type EditorTarget =
  | { readonly mode: 'create' }
  | { readonly mode: 'edit'; readonly note: NoteRecord }

export type NotesPage = 'board' | 'editor'

export type NotesRoute =
  | { readonly page: 'board' }
  | { readonly page: 'editor'; readonly draft: EditorTarget }

export interface NotesNav {
  readonly route: NotesRoute
  readonly settingsOpen: boolean
  openEditor(target: EditorTarget): void
  /** 取消/保存成功后回列表页（编辑内容丢弃由页面卸载负责，与现状一致）。 */
  closeEditor(): void
  setSettingsOpen(open: boolean): void
  subscribe(listener: () => void): () => void
}

export function createNotesNav(): NotesNav {
  let route: NotesRoute = { page: 'board' }
  let settingsOpen = false
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of [...listeners]) listener()
  }

  return {
    get route() {
      return route
    },
    get settingsOpen() {
      return settingsOpen
    },
    openEditor(target) {
      route = { page: 'editor', draft: target }
      // 编辑页不展示 header 齿轮，设置弹窗随页面切换关闭（与现状一致）。
      settingsOpen = false
      emit()
    },
    closeEditor() {
      route = { page: 'board' }
      emit()
    },
    setSettingsOpen(open) {
      if (settingsOpen === open) return
      settingsOpen = open
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** 便签板导航单例（模块级，浮层开关不重置它）。 */
export const notesNav = createNotesNav()
