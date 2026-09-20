/**
 * 快捷新建浮层的槽位宿主（slot: shell.overlay）。
 *
 * 原先浮层由 core/quick-add.ts 直接往 body 挂 React 根 + `<html>` 属性控制可见性；
 * 现在交给 shell.overlay —— 生命周期归槽位管，插件卸载时自动收干净。
 *
 * shell.overlay 是 **click-through** 层（条目要自己 opt-in 指针事件），这件事由
 * QuickAddDialog 自己的 fixed 宿主容器负责，本组件只做开关判定。
 */

import { useNotesEntryEnabled } from '../hooks/useNotesEntryEnabled.ts';
import { QuickAddDialog } from '../views/quick-add-dialog/QuickAddDialog.tsx';
import type { NotesUiFace } from '../core/notes-ui-face.ts';

export interface NotesQuickAddOverlayProps extends NotesUiFace {}

/** @returns 快捷新建浮层；开关关闭时渲染 null。 */
export function NotesQuickAddOverlay(props: NotesQuickAddOverlayProps): JSX.Element | null {
  const enabled = useNotesEntryEnabled(props.scope, 'quickAddOverlay');
  if (!enabled) return null;
  return (
    <QuickAddDialog
      scope={props.scope}
      create={props.create}
      listWorkspaces={props.listWorkspaces}
      onCreated={props.onCreated}
    />
  );
}
