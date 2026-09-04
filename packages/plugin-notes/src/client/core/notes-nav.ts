/**
 * 便签板浮层弹窗导航（状态）：列表页（BoardMain）常驻内容，编辑器、设置与
 * 使用说明是叠加其上的互斥浮层弹窗，开关一律由本 store 决定，board-view
 * 只做数据控制器 + 渲染出口，不再持有 draft/settingsOpen 本地 state。
 *
 * 弹窗 = 目标（type 互斥）：editor 弹窗带 draft（create | edit+note），
 * settings/help 弹窗为布尔开关；同一时刻至多开一个弹窗（openEditor 会收掉
 * 设置/说明弹窗，反之亦然），列表页始终可见。
 *
 * 模块级单例（与 board-store 相同的 subscribe + useSyncExternalStore 范式）；
 * 与浮层开关（board-store.open）解耦：关掉浮层再开，停留在原弹窗态，
 * 与改造前组件 state 的语义一致（组件挂载期 state 本就跨开关保留）。
 *
 * 新增弹窗：扩展弹窗联合 → 这里补动作 → board-view 的渲染处加一支。
 */

import type { NoteRecord } from '../../types.ts'

/** 新建/编辑草稿目标（沿用原 board-view Draft 语义，类型上收至此）。 */
export type EditorTarget =
  | { readonly mode: 'create' }
  | { readonly mode: 'edit'; readonly note: NoteRecord }

export interface NotesNav {
  /** 编辑器弹窗的当前目标；null = 编辑器未打开。 */
  readonly editing: EditorTarget | null
  /** 设置弹窗开关（与编辑器互斥）。 */
  readonly settingsOpen: boolean
  /** 使用说明弹窗开关（与编辑器/设置互斥）。 */
  readonly helpOpen: boolean
  openEditor(target: EditorTarget): void
  /** 取消/保存成功后关编辑器弹窗（编辑内容丢弃由弹窗卸载负责，与现状一致）。 */
  closeEditor(): void
  setSettingsOpen(open: boolean): void
  /** 打开/关闭使用说明弹窗（说明只读，纯展示）。 */
  setHelpOpen(open: boolean): void
  subscribe(listener: () => void): () => void
}

export function createNotesNav(): NotesNav {
  let editing: EditorTarget | null = null
  let settingsOpen = false
  let helpOpen = false
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of [...listeners]) listener()
  }

  return {
    get editing() {
      return editing
    },
    get settingsOpen() {
      return settingsOpen
    },
    get helpOpen() {
      return helpOpen
    },
    openEditor(target) {
      editing = target
      // 弹窗互斥：编辑器打开时收掉设置/说明弹窗（与现状一致）。
      settingsOpen = false
      helpOpen = false
      emit()
    },
    closeEditor() {
      editing = null
      emit()
    },
    setSettingsOpen(open) {
      if (settingsOpen === open) return
      // 弹窗互斥：设置弹窗打开时收掉编辑器与说明弹窗。
      if (open) {
        editing = null
        helpOpen = false
      }
      settingsOpen = open
      emit()
    },
    setHelpOpen(open) {
      if (helpOpen === open) return
      // 弹窗互斥：说明弹窗打开时收掉编辑器与设置弹窗（说明只读，不改数据）。
      if (open) {
        editing = null
        settingsOpen = false
      }
      helpOpen = open
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
