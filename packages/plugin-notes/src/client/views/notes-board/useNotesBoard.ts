/**
 * 便签板全部状态与动作：视图只读返回值，不碰 remote / notesNav / 键盘事件。
 * 刷新为事件驱动（宿主 notes/watch 推送），无定时器。
 * 与 sibling 面板的互斥只在 surface='main' 参与（见 core/notes-panel）。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MutableRefObject } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  NoteColor,
  NoteId,
  NoteRecord,
  NoteScheduleInput,
  NotesConfig,
  NoteUpdateInput,
  TaskTargets,
} from '../../../types.ts'
import { scheduleSignature } from '../../../schedule.ts'
import type { TaskStatus } from '../../core/task-lanes.ts'
import { lanePatchForSave, taskTargetCreateInput } from '../../core/task-lanes.ts'
import { boardStore } from '../../core/board-store.ts'
import { announceNotesPanel, watchSiblingPanels } from '../../core/notes-panel.ts'
import { notesChangeBus, notesStatsStore } from '../../core/notes-stats.ts'
import type { EditorTarget } from '../../core/notes-nav.ts'
import { notesNav } from '../../core/notes-nav.ts'
import type { NotesRemote } from '../../core/notes-remote.ts'
import type { NoteSaveOptions, NoteTaskDraft } from '../../components/NoteEditor.tsx'

export interface NotesBoardFace {
  readonly notes: NotesRemote
  readonly scope: ConfigForm<NotesConfig>
  readonly closeBoard: () => void
}

export interface UseNotesBoardOptions {
  readonly face: NotesBoardFace
  /**
   * 'main'（缺省）占中间列，挂载时广播并监听 sibling 面板；'sidebar' 不占
   * 中间列，两边都不参与（广播会白赶走兄弟面板，监听会被关掉自己的 tab）。
   */
  readonly surface?: 'main' | 'sidebar'
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const EXECUTE_NEEDS_SESSION_HINT = '执行需要宿主能新建会话（会话控制器不可用或投递被拒）'

/** 任务必须自带工作区，没有默认值。 */
const EXECUTE_NEEDS_WORKSPACE_HINT =
  '这张任务便签还没指定工作区：打开它，在「设为任务」底下选一个工作区再执行'

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

export interface UseNotesBoardResult {
  readonly notes: readonly NoteRecord[]
  readonly loading: boolean
  readonly busy: boolean
  readonly error: string | undefined
  readonly activeCount: number
  readonly helpOpen: boolean
  readonly editing: EditorTarget | null
  readonly defaultTitle: string
  readonly workspaces: readonly string[]
  readonly workspacesReady: boolean
  readonly taskTargets: TaskTargets
  readonly closeBoard: () => void
  readonly refresh: () => void
  readonly dismissError: () => void
  readonly toggleHelp: () => void
  readonly closeHelp: () => void
  readonly openEditor: (note: NoteRecord) => void
  readonly createNote: () => void
  readonly closeEditor: () => void
  /** 有未保存改动时先走编辑器自己的关闭闸（板子的兜底 Esc 也必须经它）。 */
  readonly editorRequestCloseRef: MutableRefObject<(() => void) | null>
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

export function useNotesBoard(options: UseNotesBoardOptions): UseNotesBoardResult {
  const { face } = options
  const closeBoard = face.closeBoard
  const surface = options.surface ?? 'main'

  /** 工作区候选：最近会话用过的 cwd；拿不到即空数组。 */
  const [workspaces, setWorkspaces] = useState<readonly string[]>([])
  /** 候选是否已加载完成；就绪前不显示「未配置」。 */
  const [workspacesReady, setWorkspacesReady] = useState(false)
  /** 任务执行目标目录；挂载即拉一次，失败即空目录。 */
  const [taskTargets, setTaskTargets] = useState<TaskTargets>({ models: [], presets: [] })
  const [notes, setNotes] = useState<readonly NoteRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // 挂载态先记：notes-stats 靠它判断板子在不在，与 surface 无关。
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

  const editing = useSyncExternalStore(notesNav.subscribe, () => notesNav.editing)
  const helpOpen = useSyncExternalStore(notesNav.subscribe, () => notesNav.helpOpen)
  const editorRequestCloseRef = useRef<(() => void) | null>(null)

  const scope = face.scope
  const snapshot = useSyncExternalStore(
    (cb) => scope.subscribe(cb),
    () => scope.getSnapshot(),
  )

  const defaultTitle = snapshot.value?.defaultTitle ?? '新便签'

  async function refresh(silent = false): Promise<void> {
    if (!silent) setLoading(true)
    const result = await face.notes.list()
    if (result.ok) {
      setNotes(result.value)
      notesStatsStore.sync(result.value)
      setError(undefined)
    } else if (!silent) {
      setError(errText(result.error))
    }
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    void refresh()
    return notesChangeBus.subscribe(() => {
      void refresh(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 挂载即拉（不等开板）：编辑器的「用默认（目录）」文案依赖它。
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

  useEffect(() => {
    let alive = true
    void face.notes
      .taskTargets()
      .then((result) => {
        if (alive && result.ok) setTaskTargets(result.value)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc 按层级收：使用说明 → 编辑器（经其关闭闸）→ 整个面板。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (helpOpen) notesNav.setHelpOpen(false)
      else if (editing) {
        const requestClose = editorRequestCloseRef.current
        if (requestClose) requestClose()
        else notesNav.closeEditor()
      } else closeBoard()
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

  /** 静默写（自动保存用）：不动全局 busy，失败只落错误条。 */
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
   * 唯一落库口（编辑器按钮 / Ctrl+S / 自动保存）。
   * options.close 默认 true = 保存成功后关弹窗；silent = 静默（见 quietRun）。
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
    // 空串 = 未指定工作区（任务必须有，见 host 侧 missing-workspace）。
    const workspace = taskPatch.workspace.trim()
    const target = {
      agentPreset: taskPatch.agentPreset,
      ...(taskPatch.model !== undefined ? { model: taskPatch.model } : {}),
    }
    if (current.mode === 'create') {
      const schedule = taskPatch.on ? taskPatch.schedule : undefined
      const targets = taskPatch.on ? taskTargetCreateInput(target) : {}
      const ok = await save(() =>
        face.notes.create({
          title,
          text: body,
          color,
          ...(taskPatch.on ? { laneStatus: taskPatch.status } : {}),
          ...(workspace !== '' ? { workspace } : {}),
          ...targets,
          ...(schedule !== undefined ? { schedule } : {}),
        }),
      )
      if (ok && close) notesNav.closeEditor()
    } else {
      // 状态未改不发 lane（陈旧快照会回滚宿主已 settle 的状态）；关掉开关 → clear。
      const laneForUpdate = lanePatchForSave(taskPatch.on, taskPatch.status, current.note.lane, target)
      // 改过才发：空串 = 清除工作区（此后执行会被拒）。
      const workspaceChanged = workspace !== (current.note.workspace ?? '')
      // 只发签名变过的日程：未改不发，免得宿主写回的 nextAt/lastResult 被覆盖；
      // 草稿缺失而便签上有 → 发 null 清除。
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
    workspaces,
    workspacesReady,
    taskTargets,
    closeBoard,
    refresh: () => void refresh(),
    dismissError: () => setError(undefined),
    toggleHelp: () => notesNav.setHelpOpen(!helpOpen),
    closeHelp: () => notesNav.setHelpOpen(false),
    openEditor: (note) => notesNav.openEditor({ mode: 'edit', note }),
    createNote: () => notesNav.openEditor({ mode: 'create' }),
    closeEditor: () => notesNav.closeEditor(),
    editorRequestCloseRef,
    saveDraft,
    togglePin: (note) => void run(() => face.notes.setPinned(note.id, !note.pinned)),
    toggleArchive: (note) => void run(() => face.notes.update(note.id, { archived: !note.archived })),
    remove: (note) => void run(() => face.notes.delete(note.id)),
    move: (id, status) => void run(() => face.notes.update(id, { lane: { status } })),
    execute: (note) => void execute(note),
    reset: (note) => void reset(note),
    createTask: (status) => notesNav.openEditor({ mode: 'create', laneStatus: status }),
  }
}
