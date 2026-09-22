/**
 * 快捷新建浮层：订阅 boardStore.quickAdd，打开时铺满视口渲染「新建便签」编辑器
 * （复用 EditorPageDialog，观感与板内新建一致），**不开**便签板。
 *
 * 本组件由 components/NotesQuickAddOverlay 注册进 shell.overlay；生命周期归槽位管
 * （插件卸载自动收干净），不再自己往 body 挂 React Root。状态与动作见
 * hooks/useQuickAddDialog。
 */

import { EditorPageDialog } from '../../components/EditorPageDialog.tsx'
import { t } from '../../core/theme-tokens.ts'
import { useQuickAddDialog } from '../../hooks/useQuickAddDialog.ts'
import type { QuickCreateResult } from '../../hooks/useQuickAddDialog.ts'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {
  NoteColor,
  NoteModelSelection,
  NotesConfig,
  TaskStatus,
  TaskTargets,
} from '../../../types.ts'

export type { QuickCreateResult }

export interface QuickAddDialogProps {
  /** 设置命名空间 scope（读 defaultTitle）。 */
  readonly scope: SettingsScope<NotesConfig>
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

export function QuickAddDialog(props: QuickAddDialogProps): JSX.Element {
  const {
    open,
    draft,
    seq,
    error,
    workspaces,
    workspacesReady,
    taskTargets,
    defaultTitle,
    close,
    onSave,
  } = useQuickAddDialog(props)

  if (!open) return <></>

  return (
    <div style={hostStyle}>
      <EditorPageDialog
        target={{ mode: 'create', ...(draft === undefined ? {} : { draft }), nonce: seq }}
        defaultTitle={defaultTitle}
        workspaceOptions={workspaces}
        workspaceReady={workspacesReady}
        taskTargets={taskTargets}
        onCancel={close}
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

/* ---------- 样式（几何用内联：shell.overlay 是 click-through 层，条目要自己 opt-in 指针事件） ---------- */

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
