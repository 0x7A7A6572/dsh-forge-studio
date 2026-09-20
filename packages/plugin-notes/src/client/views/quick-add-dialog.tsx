/**
 * 快捷新建浮层的 React 宿主：订阅 boardStore.quickAdd，打开时铺满视口渲染
 * 「新建便签」编辑器（复用 EditorPageDialog，观感与板内新建一致），**不开**便签板。
 *
 * 本组件由 components/NotesQuickAddOverlay 注册进 shell.overlay；生命周期归槽位管
 * （插件卸载自动收干净），不再自己往 body 挂 React 根。
 *
 * 交互契约：
 * - Esc / 取消 / 点遮罩 → 只关浮层；
 * - 保存成功 → onCreated()（补刷侧栏徽标）后自动关闭；
 * - 保存失败 → 顶部错误条提示，弹窗保持打开可重试。
 *
 * defaultTitle 实时读设置命名空间 scope（与便签板行为一致）。
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NoteColor, NotesConfig, TaskStatus } from '../../types.ts'
import { boardStore } from '../core/board-store.ts'
import { t } from '../core/theme-tokens.ts'
import { EditorPageDialog } from './editor-page-dialog.tsx'
import type { NoteSaveOptions } from '../components/note-editor.tsx'

/** create 收窄返回（host 侧 RemoteResult<NoteRecord> 的 ok 面；错误只取 message）。 */
export interface QuickCreateResult {
  readonly ok: boolean
  readonly error?: { readonly message?: string }
}

export interface QuickAddDialogProps {
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
  /** 工作区候选（最近会话用过的 cwd）：打开浮层时拉一次；缺省 = 无候选。 */
  readonly listWorkspaces?: () => Promise<readonly string[]>
  /** 保存成功回调（补刷侧栏徽标等）。 */
  readonly onCreated: () => void
}

export function QuickAddDialog(props: QuickAddDialogProps): JSX.Element {
  const open = useSyncExternalStore(
    boardStore.subscribe,
    () => boardStore.quickAdd,
  )
  /** 预填草稿 + 打开序号（助手消息「存成便签」带进来；见 board-store）。 */
  const draft = useSyncExternalStore(
    boardStore.subscribe,
    () => boardStore.quickAddDraft,
  )
  const seq = useSyncExternalStore(
    boardStore.subscribe,
    () => boardStore.quickAddSeq,
  )
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
    const load = props.listWorkspaces
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

  if (!open) return <></>

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
    const result = await props.create({
      title,
      text: body,
      color,
      ...(taskPatch.on ? { laneStatus: taskPatch.status } : {}),
      ...(workspace !== '' ? { workspace } : {}),
    })
    if (result.ok) {
      props.onCreated()
      boardStore.hideQuickAdd()
    } else {
      setError(result.error?.message ?? '保存失败，请重试')
    }
  }

  return (
    <div style={hostStyle}>
      <EditorPageDialog
        target={{ mode: 'create', ...(draft === undefined ? {} : { draft }), nonce: seq }}
        defaultTitle={props.scope.getSnapshot().value?.defaultTitle ?? '新便签'}
        defaultWorkspace={
          props.scope.getSnapshot().value?.defaultWorkspace || workspaces[0] || ''
        }
        workspaceOptions={workspaces}
        workspaceReady={workspacesReady}
        onCancel={() => boardStore.hideQuickAdd()}
        onSave={onSave}
      />
      {error !== undefined && (
        <div style={errorStyle} role="alert">
          ⚠ {error}
        </div>
      )}
    </div>
  )
}

/* ---------- 样式 ---------- */

/** shell.overlay 是 click-through 层（条目要自己 opt-in 指针事件），所以这里自己
 *  铺满视口并打开 pointer-events，作为 EditorPageDialog absolute 遮罩的包含块。 */
const hostStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  zIndex: 300,
}

/** 顶部错误条：fixed 到视口顶部居中，z 高于编辑器遮罩（z10），保证可见。 */
const errorStyle: React.CSSProperties = {
  position: 'fixed',
  top: 14,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 20,
  maxWidth: 'min(680px, calc(100vw - 48px))',
  boxSizing: 'border-box',
  padding: '6px 12px',
  borderRadius: 8,
  background: t.hoverDangerBg,
  color: t.danger,
  fontSize: 12,
  boxShadow: t.shadowLv3,
}