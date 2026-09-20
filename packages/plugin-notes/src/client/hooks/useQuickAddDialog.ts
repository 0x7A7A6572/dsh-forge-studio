/**
 * 快捷新建浮层的全部状态与动作（QuickAddDialog 的逻辑面）。
 *
 * 打开/预填/序号读模块级 board-store（全局入口「存成便签」也写它），错误与工作区候选
 * 是本浮层的本地状态。视图只读返回值。
 *
 * 交互契约：
 * - Esc / 取消 / 点遮罩 → 只关浮层（close）；
 * - 保存成功 → onCreated()（补刷侧栏徽标）后自动关闭；
 * - 保存失败 → 返回 error，视图负责画错误条，弹窗保持打开可重试。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NoteColor, NotesConfig, TaskStatus } from '../../types.ts'
import type { NoteDraft } from '../core/notes-nav.ts'
import { boardStore } from '../core/board-store.ts'
import type { NoteSaveOptions } from '../components/NoteEditor.tsx'

/** create 收窄返回（host 侧 RemoteResult<NoteRecord> 的 ok 面；错误只取 message）。 */
export interface QuickCreateResult {
  readonly ok: boolean
  readonly error?: { readonly message?: string }
}

export interface UseQuickAddDialogOptions {
  /** 设置命名空间 scope（读 defaultTitle / defaultWorkspace）。 */
  readonly scope: SettingsScope<NotesConfig>
  /** 实际落库调用（index.ts 注入 notes.create + 错误映射）。 */
  readonly create: (input: {
    title?: string
    text: string
    color?: NoteColor
    laneStatus?: TaskStatus
    workspace?: string
  }) => Promise<QuickCreateResult>
  /** 工作区候选（最近会话用过的 cwd）：挂载即拉一次；缺省 = 无候选。 */
  readonly listWorkspaces?: () => Promise<readonly string[]>
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
  readonly defaultTitle: string
  readonly defaultWorkspace: string
  readonly close: () => void
  readonly onSave: (
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: { readonly on: boolean; readonly status: TaskStatus; readonly workspace: string },
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
  /** 候选是否已加载完成：未就绪时「用默认」文案不写「（未配置）」（避免闪一下）。 */
  const [workspacesReady, setWorkspacesReady] = useState(false)

  // Esc 关闭浮层：capture 阶段拦截并停传播，避免板内全局 Esc（开板时）抢收。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      boardStore.hideQuickAdd()
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

  // 工作区候选：挂载即拉（不等打开浮层）。等打开才拉的话，「用默认（目录）」会先渲染成
  // 「未配置」、候选到达后再变成真目录——用户看到的就是「提示一闪而过」。
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

  const onSave = async (
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: { readonly on: boolean; readonly status: TaskStatus; readonly workspace: string },
    // 快捷新建只有 create 语义（保存即创建并关闭），options 收下即忽略。
    _options?: NoteSaveOptions,
  ): Promise<void> => {
    setError(undefined)
    const workspace = taskPatch.workspace.trim()
    const result = await create({
      title,
      text: body,
      color,
      ...(taskPatch.on ? { laneStatus: taskPatch.status } : {}),
      ...(workspace !== '' ? { workspace } : {}),
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
    defaultTitle: scope.getSnapshot().value?.defaultTitle ?? '新便签',
    defaultWorkspace: scope.getSnapshot().value?.defaultWorkspace || workspaces[0] || '',
    close: () => boardStore.hideQuickAdd(),
    onSave,
  }
}
