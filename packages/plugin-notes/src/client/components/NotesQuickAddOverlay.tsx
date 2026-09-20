/**
 * 快捷新建浮层的槽位宿主（slot: shell.overlay）。
 *
 * 原先浮层由 core/quick-add.ts 直接往 body 挂 React 根 + `<html>` 属性控制可见性；
 * 现在交给 shell.overlay —— 生命周期归槽位管，插件卸载时自动收干净。
 *
 * shell.overlay 是 **click-through** 层（条目要自己 opt-in 指针事件），这件事由
 * QuickAddDialog 自己的 fixed 宿主容器负责；本组件只做接线。
 *
 * **它没有开关**：浮层是「输入栏记一笔 / 侧栏 (＋) / 助手消息存成便签」三条入口的
 * 共同落点，单独把浮层关掉只是让那三个按钮点了没反应 —— 那叫坏掉，不叫关掉。
 * 要收入口就收那三条入口（见 types.ts 的 NotesEntryConfig）。
 */

import { QuickAddDialog } from '../views/quick-add-dialog/QuickAddDialog.tsx';
import type { NotesUiFace } from '../core/notes-ui-face.ts';

export interface NotesQuickAddOverlayProps extends NotesUiFace {}

/** @returns 快捷新建浮层。 */
export function NotesQuickAddOverlay(props: NotesQuickAddOverlayProps): JSX.Element {
  return (
    <QuickAddDialog
      scope={props.scope}
      create={props.create}
      listWorkspaces={props.listWorkspaces}
      onCreated={props.onCreated}
    />
  );
}
