/**
 * 快捷新建浮层的全部状态与动作（QuickAddDialog 的逻辑面）。
 *
 * 打开/预填/序号读模块级 board-store（全局入口「存成便签」也写它），错误与工作区候选
 * 是本浮层的本地状态。视图只读返回值。
 *
 * 交互契约：
 * - Esc / 取消 / 点遮罩 → 走编辑器的关闭闸（关了才算关）：有未保存改动先弹「便签有改动」，
 *   没改动才真的关掉浮层（close）；
 * - 保存成功 → onCreated()（补刷侧栏徽标）后自动关闭；
 * - 保存失败 → 返回 error，视图负责画错误条，弹窗保持打开可重试。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MutableRefObject } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NoteColor, NoteModelSelection, NotesConfig, TaskStatus, TaskTargets } from '../../types.ts'
import type { NoteDraft } from '../core/notes-nav.ts'
import { boardStore } from '../core/board-store.ts'
import type { NoteSaveOptions, NoteTaskDraft } from '../components/NoteEditor.tsx'
import { taskTargetCreateInput } from '../core/task-lanes.ts'

/** create 收窄返回（host 侧 RemoteResult<NoteRecord> 的 ok 面；错误只取 message）。 */
export interface QuickCreateResult {
  readonly ok: boolean
  readonly error?: { readonly message?: string }
}

export interface UseQuickAddDialogOptions {
  /** 配置表单（读 defaultTitle）。 */
  readonly scope: ConfigForm<NotesConfig>
  /** 实际落库调用（index.ts 注入 notes.create + 错误映射）。 */
  readonly create: (input: {
    title?: string
    text: string
    color?: NoteColor
    laneStatus?: TaskStatus
    workspace?: string
    agentPreset?: string
    model?: NoteModelSelection
  }) => Promise<QuickCreateResult>
  /** 工作区候选（最近会话用过的 cwd）：挂载即拉一次；缺省 = 无候选。 */
  readonly listWorkspaces?: () => Promise<readonly string[]>
  /** 任务执行目标目录（模型 / agent 预设）：同样挂载即拉；缺省 = 空目录。 */
  readonly listTaskTargets?: () => Promise<TaskTargets>
  /** 保存成功回调（补刷侧栏徽标等）。 */
  readonly onCreated: () => void
}

export interface UseQuickAddDialogResult {
  readonly open: boolean
  readonly draft: NoteDraft | undefined
  readonly seq: number
  readonly error: string | undefined
  readonly workspaces: readonly string[]
  readonly workspacesReady: boolean
  readonly taskTargets: TaskTargets
  readonly defaultTitle: string
  /** 编辑器填进来的关闭闸（Esc 也走它，见下）；转交给 EditorPageDialog。 */
  readonly requestCloseRef: MutableRefObject<(() => void) | null>
  readonly close: () => void
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: NoteTaskDraft,
    options?: NoteSaveOptions,
  ) => Promise<void>
}

export function useQuickAddDialog(options: UseQuickAddDialogOptions): UseQuickAddDialogResult {
  const { create, onCreated, scope } = options
  const open = useSyncExternalStore(boardStore.subscribe, () => boardStore.quickAdd)
  /** 预填草稿 + 打开序号（助手消息「存成便签」带进来；见 board-store）。 */
  const draft = useSyncExternalStore(boardStore.subscribe, () => boardStore.quickAddDraft)
  const seq = useSyncExternalStore(boardStore.subscribe, () => boardStore.quickAddSeq)
  const [error, setError] = useState<string | undefined>(undefined)
  /** 工作区候选（最近会话用过的 cwd）：挂载即拉一次，失败静默降级空数组。 */
  const [workspaces, setWorkspaces] = useState<readonly string[]>([])
  /** 候选是否已加载完成：未就绪时不写「（无候选）」（避免提示闪一下）。 */
  const [workspacesReady, setWorkspacesReady] = useState(false)
  /** 任务执行目标目录（模型 / agent 预设）：挂载即拉，失败即空目录。 */
  const [taskTargets, setTaskTargets] = useState<TaskTargets>({ models: [], presets: [] })
  /** EditorPageDialog 填进来的关闭闸（有改动先确认）；还没填时退回直接关浮层。 */
  const requestCloseRef = useRef<(() => void) | null>(null)

  // Esc 关闭浮层：capture 阶段拦截并停传播，避免板内全局 Esc（开板时）抢收。
  // 但「关」要走编辑器那道闸 —— Esc 和 X / 「取消」/ 点遮罩是同一条关闭路，绕过它就
  // 成了「按一下 Esc 草稿全没」的暗门（本浮层全是新建，丢了连库记录都没有）。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      const requestClose = requestCloseRef.current
      if (requestClose) requestClose()
      else boardStore.hideQuickAdd()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  // 打开时清掉上一次的残留错误提示；关上时丢掉草稿（下次由调用方重新给）。
  useEffect(() => {
    if (!open) {
      boardStore.clearQuickAddDraft()
      return
    }
    setError(undefined)
  }, [open])

  // 工作区候选 + 执行目标目录：挂载即拉（不等打开浮层）。等打开才拉的话，下拉会先
  // 渲染成空、数据到达后再填上——用户看到的就是「提示一闪而过」。
  useEffect(() => {
    const load = options.listWorkspaces
    if (load === undefined) {
      setWorkspacesReady(true)
      return
    }
    let alive = true
    void load()
      .then((list) => {
        if (alive) setWorkspaces(list)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setWorkspacesReady(true)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const load = options.listTaskTargets
    if (load === undefined) return
    let alive = true
    void load()
      .then((targets) => {
        if (alive) setTaskTargets(targets)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSave = async (
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: NoteTaskDraft,
    // 快捷新建只有 create 语义（保存即创建并关闭），options 收下即忽略。
    _options?: NoteSaveOptions,
  ): Promise<void> => {
    setError(undefined)
    const workspace = taskPatch.workspace.trim()
    const targets = taskPatch.on
      ? taskTargetCreateInput({
        agentPreset: taskPatch.agentPreset,
        ...(taskPatch.model !== undefined ? { model: taskPatch.model } : {}),
      })
      : {}
    const result = await create({
      title,
      text: body,
      color,
      ...(taskPatch.on ? { laneStatus: taskPatch.status } : {}),
      ...(workspace !== '' ? { workspace } : {}),
      ...targets,
    })
    if (result.ok) {
      onCreated()
      boardStore.hideQuickAdd()
    } else {
      setError(result.error?.message ?? '保存失败，请重试')
    }
  }

  return {
    open,
    draft,
    seq,
    error,
    workspaces,
    workspacesReady,
    taskTargets,
    defaultTitle: scope.getSnapshot().value?.defaultTitle ?? '新便签',
    requestCloseRef,
    close: () => boardStore.hideQuickAdd(),
    onSave,
  }
}
