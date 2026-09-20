/**
 * 便签板浮层弹窗导航（状态）：列表页（BoardMain）常驻内容，编辑器与使用说明是
 * 叠加其上的互斥浮层弹窗，开关一律由本 store 决定，board-view 只做数据控制器 +
 * 渲染出口，不再持有 draft/弹窗开关本地 state。
 *
 * 弹窗 = 目标（type 互斥）：editor 弹窗带 draft（create | edit+note），help 弹窗
 * 为布尔开关；同一时刻至多开一个弹窗（openEditor 会收掉说明弹窗，反之亦然），
 * 列表页始终可见。
 *
 * **设置不在这里**：便签的设置已搬到 dsh 设置面板的「便签」分区
 * （views/settings-section.tsx），板内的设置弹窗与齿轮入口一并删除 —— 设置入口
 * 不再依赖便签自己的入口开关，也就没有「入口全关 → 进不去设置」的死角。
 *
 * 模块级单例（与 board-store 相同的 subscribe + useSyncExternalStore 范式）；
 * 与浮层开关（board-store.open）解耦：关掉浮层再开，停留在原弹窗态，
 * 与改造前组件 state 的语义一致（组件挂载期 state 本就跨开关保留）。
 *
 * 新增弹窗：扩展弹窗联合 → 这里补动作 → board-view 的渲染处加一支。
 */

import type { NoteRecord, TaskStatus } from '../../types.ts'

/** 新建便签的预填内容（助手消息「存成便签」把那条回答带进编辑器用）。 */
export interface NoteDraft {
  /** 预填标题；留空则由设置里的 defaultTitle 兜底。 */
  readonly title?: string
  /** 预填正文。 */
  readonly text?: string
}

/** 新建/编辑草稿目标（沿用原 board-view Draft 语义，类型上收至此）。 */
export type EditorTarget =
  | {
      readonly mode: 'create'
      readonly laneStatus?: TaskStatus
      /** 预填内容；不带就是空的编辑器。 */
      readonly draft?: NoteDraft
      /**
       * 新建态的打开序号（由 openEditor 自动发号）：编辑器只在挂载那一刻读
       * initialTitle/initialBody，所以「连点两次存成便签」要靠它换 key 才能换掉草稿。
       */
      readonly nonce?: number
    }
  | { readonly mode: 'edit'; readonly note: NoteRecord }

export interface NotesNav {
  /** 编辑器弹窗的当前目标；null = 编辑器未打开。 */
  readonly editing: EditorTarget | null
  /** 使用说明弹窗开关（与编辑器互斥）。 */
  readonly helpOpen: boolean
  openEditor(target: EditorTarget): void
  /** 取消/保存成功后关编辑器弹窗（编辑内容丢弃由弹窗卸载负责，与现状一致）。 */
  closeEditor(): void
  /** 打开/关闭使用说明弹窗（说明只读，纯展示）。 */
  setHelpOpen(open: boolean): void
  subscribe(listener: () => void): () => void
}

export function createNotesNav(): NotesNav {
  let editing: EditorTarget | null = null
  let helpOpen = false
  /** 新建态发号器（编辑器 key 用，见 EditorTarget.nonce）。 */
  let nonce = 0
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of [...listeners]) listener()
  }

  return {
    get editing() {
      return editing
    },
    get helpOpen() {
      return helpOpen
    },
    openEditor(target) {
      // 新建态每次换一个 nonce：编辑器只在挂载那一刻读初值，不给新 key 的话，
      // 编辑器已经开着（空草稿）时再点一次「存成便签」会沿用上一份草稿。
      editing = target.mode === 'create' ? { ...target, nonce: ++nonce } : target
      // 弹窗互斥：编辑器打开时收掉说明弹窗（与现状一致）。
      helpOpen = false
      emit()
    },
    closeEditor() {
      editing = null
      emit()
    },
    setHelpOpen(open) {
      if (helpOpen === open) return
      // 弹窗互斥：说明弹窗打开时收掉编辑器弹窗（说明只读，不改数据）。
      if (open) editing = null
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
