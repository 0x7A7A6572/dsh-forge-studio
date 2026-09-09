/**
 * 快捷新建浮层的 React 宿主：订阅 quickAddStore.open，打开时在 body 固定层里
 * 渲染「新建便签」编辑器（复用 EditorPageDialog，观感与板内新建一致），不开
 * 便签板（不碰 board-store / notes-nav）。
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
import { quickAddStore } from '../core/quick-add.ts'
import { t } from '../core/theme-tokens.ts'
import { EditorPageDialog } from './editor-page-dialog.tsx'

/** create 收窄返回（host 侧 RemoteResult<NoteRecord> 的 ok 面；错误只取 message）。 */
export interface QuickCreateResult {
  readonly ok: boolean
  readonly error?: { readonly message?: string }
}

export interface QuickAddDialogProps {
  /** 设置命名空间 scope（读 defaultTitle）。 */
  readonly scope: SettingsScope<NotesConfig>
  /** 实际落库调用（index.ts 注入 notes.create + 错误映射）。 */
  readonly create: (input: {
    title?: string
    text: string
    color?: NoteColor
    laneStatus?: TaskStatus
  }) => Promise<QuickCreateResult>
  /** 保存成功回调（补刷侧栏徽标等）。 */
  readonly onCreated: () => void
}

export function QuickAddDialog(props: QuickAddDialogProps): JSX.Element {
  const open = useSyncExternalStore(
    quickAddStore.subscribe,
    () => quickAddStore.open,
  )
  const [error, setError] = useState<string | undefined>(undefined)

  // Esc 关闭浮层：capture 阶段拦截并停传播，避免板内全局 Esc（开板时）抢收。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      quickAddStore.hide()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  // 打开时清掉上一次的残留错误提示。
  useEffect(() => {
    if (open) setError(undefined)
  }, [open])

  if (!open) return <></>

  const onSave = async (
    title: string,
    body: string,
    color: NoteColor,
    lanePatch: { readonly on: boolean; readonly status: TaskStatus },
  ): Promise<void> => {
    setError(undefined)
    const result = await props.create({
      title,
      text: body,
      color,
      ...(lanePatch.on ? { laneStatus: lanePatch.status } : {}),
    })
    if (result.ok) {
      props.onCreated()
      quickAddStore.hide()
    } else {
      setError(result.error?.message ?? '保存失败，请重试')
    }
  }

  return (
    <div style={hostStyle}>
      <EditorPageDialog
        target={{ mode: 'create' }}
        defaultTitle={props.scope.getSnapshot().value?.defaultTitle ?? '新便签'}
        onCancel={() => quickAddStore.hide()}
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

/** 宿主只占位（可见性由 quick-add 容器的 CSS 控制），子级 EditorPageDialog 的
 *  absolute 遮罩以本层为包含块铺满视口。 */
const hostStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
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