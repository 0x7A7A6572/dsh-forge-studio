/**
 * 便签板的全部状态与动作（board-view 的逻辑面）。
 *
 * 视图只读返回值，自己永远不碰 remote / notesNav / 键盘事件 —— 想知道「删一条会
 * 发生什么」，看这里。
 *
 * 数据流：开关订阅、拉取（事件驱动，无定时轮询）、错误条、busy 与保存流
 * （saveDraft → run → refresh）。弹窗层（编辑器 / 使用说明）是互斥浮层，开关一律
 * 读 notes-nav store，本 hook 不再持有本地开关 state。
 *
 * 与 sibling 面板（task-board / ssh / daily-log）的互斥见 core/notes-panel：它们
 * 还在抢中间列的 DOM，所以主面板挂载时广播、收到它们的广播时把中间列交还会话；
 * 右侧栏 surface 不参与（见 UseNotesBoardOptions.surface）。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  NoteColor,
  NoteId,
  NoteRecord,
  NoteScheduleInput,
  NotesConfig,
  NoteUpdateInput,
} from '../../../types.ts'
import { scheduleSignature } from '../../../schedule.ts'
import type { TaskStatus } from '../../core/task-lanes.ts'
import { lanePatchForSave } from '../../core/task-lanes.ts'
import { boardStore } from '../../core/board-store.ts'
import { announceNotesPanel, watchSiblingPanels } from '../../core/notes-panel.ts'
import { notesChangeBus, notesStatsStore } from '../../core/notes-stats.ts'
import type { EditorTarget } from '../../core/notes-nav.ts'
import { notesNav } from '../../core/notes-nav.ts'
import type { NotesRemote } from '../../core/notes-remote.ts'
import type { NoteSaveOptions, NoteTaskDraft } from '../../components/NoteEditor.tsx'

/** 面板注入面：由 client 入口在注册槽位时提供。 */
export interface NotesBoardFace {
  readonly notes: NotesRemote
  /** forge-studio-notes 命名空间 scope（默认标题/默认工作区；入口开关在 dsh 设置 → 便签）。 */
  readonly scope: SettingsScope<NotesConfig>
  /** 关闭便签板：把主面板切回会话（ctx.layout.selectPanel(null)）。 */
  readonly closeBoard: () => void
}

export interface UseNotesBoardOptions {
  readonly face: NotesBoardFace
  /**
   * 本品挂在哪块地里：
   * - 'main'（缺省）：中间列主面板，挂载时广播、并监听 sibling 面板的反向广播；
   * - 'sidebar'：右侧栏 tab（见 views/notes-sidebar-body）。它不占中间列，所以两边都
   *   不参与 —— 广播白赶走兄弟面板，监听则会被兄弟面板关掉自己的 tab。
   */
  readonly surface?: 'main' | 'sidebar'
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 提示：执行需宿主可新建会话（no-dispatch / dispatch-failed 共用）。 */
const EXECUTE_NEEDS_SESSION_HINT = '执行需要宿主能新建会话（会话控制器不可用或投递被拒）'

/** 未指定工作区提示（便签级 + 设置默认都为空）：任务必须跑在明确的工作区。 */
const EXECUTE_NEEDS_WORKSPACE_HINT =
  '任务便签未指定工作区：请在该便签编辑器里填写，或到设置里配置「默认工作区」'

/** 任务执行事务失败 reason → 用户提示。 */
function executeError(
  reason: 'missing' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed',
): string {
  switch (reason) {
    case 'missing':
      return '便签不存在，无法执行'
    case 'busy':
      return '任务正在执行中或不可执行'
    case 'missing-workspace':
      return EXECUTE_NEEDS_WORKSPACE_HINT
    case 'no-dispatch':
    case 'dispatch-failed':
      return EXECUTE_NEEDS_SESSION_HINT
  }
}

/** 设置分区与板子共用的返回值形状（视图同名解构）。 */
export interface UseNotesBoardResult {
  readonly notes: readonly NoteRecord[]
  readonly loading: boolean
  readonly busy: boolean
  readonly error: string | undefined
  readonly activeCount: number
  readonly helpOpen: boolean
  readonly editing: EditorTarget | null
  readonly defaultTitle: string
  readonly effectiveDefaultWorkspace: string
  readonly workspaces: readonly string[]
  readonly workspacesReady: boolean
  readonly closeBoard: () => void
  readonly refresh: () => void
  readonly dismissError: () => void
  readonly toggleHelp: () => void
  readonly closeHelp: () => void
  readonly openEditor: (note: NoteRecord) => void
  readonly createNote: () => void
  readonly closeEditor: () => void
  readonly saveDraft: (
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: NoteTaskDraft,
    options?: NoteSaveOptions,
  ) => Promise<void>
  readonly togglePin: (note: NoteRecord) => void
  readonly toggleArchive: (note: NoteRecord) => void
  readonly remove: (note: NoteRecord) => void
  readonly move: (id: NoteId, status: TaskStatus) => void
  readonly execute: (note: NoteRecord) => void
  readonly reset: (note: NoteRecord) => void
  readonly createTask: (status: TaskStatus) => void
}

/** 便签板的全部状态与动作。 */
export function useNotesBoard(options: UseNotesBoardOptions): UseNotesBoardResult {
  const { face } = options
  const closeBoard = face.closeBoard
  const surface = options.surface ?? 'main'

  /** 工作区候选（最近会话用过的 cwd，设置/编辑器下拉用；拿不到即空数组）。 */
  const [workspaces, setWorkspaces] = useState<readonly string[]>([])
  /**
   * 工作区候选是否已加载完成：编辑器「用默认（目录）」文案在就绪前**不写「未配置」**，
   * 否则候选一到就会被真目录替换，用户看到的就是「提示一闪而过」。
   */
  const [workspacesReady, setWorkspacesReady] = useState(false)
  const [notes, setNotes] = useState<readonly NoteRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  // 挂载即可见（见 NotesBoard 文件头），所以不订阅「开着吗」；只回报挂载态 + 与 sibling 协调。
  useEffect(() => {
    // 挂载态照记：notes-stats 靠它判断「板子在，变更由板子自己刷」，与挂在哪块地无关。
    boardStore.setMounted(true)
    if (surface !== 'main') {
      return () => {
        boardStore.setMounted(false)
      }
    }
    announceNotesPanel()
    const stop = watchSiblingPanels(() => {
      closeBoard()
    })
    return () => {
      stop()
      boardStore.setMounted(false)
    }
  }, [closeBoard, surface])

  // 弹窗层：编辑器（目标）与使用说明开关都由导航 store 决定（跨开关浮层保留）。
  const editing = useSyncExternalStore(notesNav.subscribe, () => notesNav.editing)
  const helpOpen = useSyncExternalStore(notesNav.subscribe, () => notesNav.helpOpen)

  // 订阅命名空间 scope：默认标题在设置里改完实时生效（新建便签/弹窗展示）。
  const scope = face.scope
  const snapshot = useSyncExternalStore(
    (cb) => scope.subscribe(cb),
    () => scope.getSnapshot(),
  )

  const defaultTitle = snapshot.value?.defaultTitle ?? '新便签'
  /** 设置里的默认工作区（任务便签未单独指定时用它新建执行会话）。 */
  const defaultWorkspace = snapshot.value?.defaultWorkspace ?? ''
  /**
   * 生效默认工作区（只用于 UI 文案）：设置值 → 最近会话目录，与 host 侧
   * defaultWorkspace() 的兜底一致，这样「用默认（xxx）」显示的就是真正会用的目录。
   */
  const effectiveDefaultWorkspace =
    defaultWorkspace !== '' ? defaultWorkspace : (workspaces[0] ?? '')

  async function refresh(silent = false): Promise<void> {
    if (!silent) setLoading(true)
    const result = await face.notes.list()
    if (result.ok) {
      setNotes(result.value)
      // 侧栏「活动待办」徽标：板内操作/变更推送后即时同步（关板时由 notes-stats 事件订阅兜底）。
      notesStatsStore.sync(result.value)
      setError(undefined)
    } else if (!silent) {
      setError(errText(result.error))
    }
    if (!silent) setLoading(false)
  }

  // 事件驱动（替代原 5s/1.5s 轮询）：开板首刷；之后任何写（本板操作、agent 工具、
  // WebDAV 恢复等）由宿主 notes/watch 推送 → 静默刷新。无定时器。
  useEffect(() => {
    void refresh()
    return notesChangeBus.subscribe(() => {
      void refresh(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 工作区候选：**挂载即拉**（不等开板）。编辑器里的「用默认（目录）」文案依赖它，
  // 等开板才拉的话，用户开板后马上点开编辑器就会先看到「未配置」再被真目录替换。
  // 只读端点，失败静默 —— 没有候选就只是一个空下拉；拉完置 ready（文案才写「未配置」）。
  useEffect(() => {
    let alive = true
    void face.notes
      .listWorkspaces()
      .then((result) => {
        if (alive && result.ok) setWorkspaces(result.value)
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

  // Esc：按弹窗层级收 —— 使用说明 → 编辑器弹窗 → 整个面板
  // （编辑器内的 Esc 由 NoteEditor 处理并 stopPropagation，不会走到这里）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (helpOpen) notesNav.setHelpOpen(false)
      else if (editing) notesNav.closeEditor()
      else closeBoard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, helpOpen, closeBoard])

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError(undefined)
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'ok' in result) {
        const outcome = result as { ok: boolean; error?: { message?: string } }
        if (!outcome.ok) {
          setError(outcome.error?.message ?? '操作失败')
          return false
        }
      }
      await refresh(true)
      return true
    } catch (cause) {
      setError(errText(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  /**
   * 静默写（自动保存用）：成功静默刷新；失败只落错误条，**不动全局 busy** —— 自动保存
   * 每隔几秒触发一次，动 busy 会让板内控件跟着一闪一闪。
   */
  async function quietRun(action: () => Promise<unknown>): Promise<boolean> {
    try {
      const result = await action()
      if (result && typeof result === 'object' && 'ok' in result) {
        const outcome = result as { ok: boolean; error?: { message?: string } }
        if (!outcome.ok) {
          setError(outcome.error?.message ?? '自动保存失败')
          return false
        }
      }
      await refresh(true)
      return true
    } catch (cause) {
      setError(errText(cause))
      return false
    }
  }

  /**
   * 保存草稿（唯一落库口：编辑器按钮 / Ctrl+S / 自动保存都走这里）。
   * options.close（默认 true）= 保存成功后关弹窗；自动保存与 Ctrl+S 传 false（留在弹窗里
   * 继续改）；options.silent = 静默（不置 busy、不打断输入，见 quietRun）。
   */
  async function saveDraft(
    title: string,
    body: string,
    color: NoteColor,
    taskPatch: NoteTaskDraft,
    options?: NoteSaveOptions,
  ): Promise<void> {
    const current = notesNav.editing
    if (!current) return
    const close = options?.close !== false
    const save = (action: () => Promise<unknown>): Promise<boolean> =>
      options?.silent === true ? quietRun(action) : run(action)
    // 工作区一律 trim 后落库（空串 = 未指定，执行时回退设置默认值）。
    const workspace = taskPatch.workspace.trim()
    if (current.mode === 'create') {
      // 新建：开关开 → 以 laneStatus 落任务身份；关 → 普通便签（原路径不变）。
      // 列头「＋新建任务」的初始状态已由 EditorPageDialog 合成进编辑器初值，此处
      // 开关是唯一真相（用户可在弹窗内改状态/取消任务）。
      // 定时日程：只有任务便签才带（普通便签无 lane，host 侧同样会忽略）。
      const schedule = taskPatch.on ? taskPatch.schedule : undefined
      const ok = await save(() =>
        face.notes.create({
          title,
          text: body,
          color,
          ...(taskPatch.on ? { laneStatus: taskPatch.status } : {}),
          ...(workspace !== '' ? { workspace } : {}),
          ...(schedule !== undefined ? { schedule } : {}),
        }),
      )
      if (ok && close) notesNav.closeEditor()
    } else {
      // 编辑：仅当用户在对话框内实际改了任务状态才发 lane.status（含「普通便签转
      // 任务」）；状态未改不携带 lane —— 否则编辑器打开期间陈旧快照会把宿主已 settle
      // / 已执行的最新状态回滚；开关关且原本是任务 → clear（取消任务）；关且非任务
      // → 纯内容更新。running 任务的开关在编辑器里只读（状态不可能改），故不会对
      // running lane 发任何 patch。
      const laneForUpdate = lanePatchForSave(taskPatch.on, taskPatch.status, current.note.lane)
      // workspace 只在真的改了才发（空串 = 清除该字段，回退设置默认值）；未改不发，
      // 避免编辑器打开期间的无谓写入。
      const workspaceChanged = workspace !== (current.note.workspace ?? '')
      // 定时日程：编辑器草稿（任务态）→ 与便签上既有日程比「可写字段签名」。未改不发，
      // 免得编辑器打开期间宿主写回的 nextAt/lastResult 被陈旧快照覆盖；草稿缺失（关掉
      // 定时或取消任务）而便签上有日程 → 发 null 清除。
      const draftSchedule: NoteScheduleInput | undefined = taskPatch.on ? taskPatch.schedule : undefined
      const schedulePatch: NoteScheduleInput | null | undefined =
        draftSchedule === undefined
          ? current.note.schedule !== undefined
            ? null
            : undefined
          : scheduleSignature(draftSchedule) !== scheduleSignature(current.note.schedule)
            ? draftSchedule
            : undefined
      const patch: NoteUpdateInput = {
        title,
        text: body,
        color,
        ...(laneForUpdate !== undefined ? { lane: laneForUpdate } : {}),
        ...(workspaceChanged ? { workspace } : {}),
        ...(schedulePatch !== undefined ? { schedule: schedulePatch } : {}),
      }
      const ok = await save(() => face.notes.update(current.note.id, patch))
      if (ok && close) notesNav.closeEditor()
    }
  }

  /** 泳道卡执行/重跑：busy 守卫 → taskExecute → 失败提示 → 刷新。 */
  async function execute(note: NoteRecord): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      // 执行 = host 按工作区新建会话后投递（便签板所在会话不参与执行）。
      const result = await face.notes.taskExecute(note.id)
      if (!result.ok) {
        setError(errText(result.error))
        return
      }
      if (!result.value.ok) {
        setError(executeError(result.value.reason))
      }
      await refresh(true)
    } catch (cause) {
      setError(errText(cause))
    } finally {
      setBusy(false)
    }
  }

  /** 泳道卡重置为待办（手动接管）：busy 守卫 → taskReset → 刷新。 */
  async function reset(note: NoteRecord): Promise<void> {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      const result = await face.notes.taskReset(note.id)
      if (!result.ok) {
        setError(errText(result.error))
        return
      }
      if (!result.value.ok) {
        setError('重置失败：便签不存在或非任务')
      }
      await refresh(true)
    } catch (cause) {
      setError(errText(cause))
    } finally {
      setBusy(false)
    }
  }

  const activeCount = notes.filter((n) => !n.archived).length

  return {
    notes,
    loading,
    busy,
    error,
    activeCount,
    helpOpen,
    editing,
    defaultTitle,
    effectiveDefaultWorkspace,
    workspaces,
    workspacesReady,
    closeBoard,
    refresh: () => void refresh(),
    dismissError: () => setError(undefined),
    toggleHelp: () => notesNav.setHelpOpen(!helpOpen),
    closeHelp: () => notesNav.setHelpOpen(false),
    openEditor: (note) => notesNav.openEditor({ mode: 'edit', note }),
    createNote: () => notesNav.openEditor({ mode: 'create' }),
    closeEditor: () => notesNav.closeEditor(),
    saveDraft,
    togglePin: (note) => void run(() => face.notes.setPinned(note.id, !note.pinned)),
    toggleArchive: (note) => void run(() => face.notes.update(note.id, { archived: !note.archived })),
    remove: (note) => void run(() => face.notes.delete(note.id)),
    // 泳道拖拽换列：状态写回 lane（颜色与状态已解耦，纸色不再表状态）。
    move: (id, status) => void run(() => face.notes.update(id, { lane: { status } })),
    execute: (note) => void execute(note),
    reset: (note) => void reset(note),
    // 泳道列头「＋」：打开新建编辑器，预置 lane 状态为当前列。
    createTask: (status) => notesNav.openEditor({ mode: 'create', laneStatus: status }),
  }
}
