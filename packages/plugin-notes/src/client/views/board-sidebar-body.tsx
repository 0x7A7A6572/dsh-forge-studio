/**
 * 便签板在**右侧栏 tab** 里的身子（slot: sidebar.right.pane.tab，key = 本插件注册的
 * tab 类型 id）。
 *
 * 复用 views/board-view 的同一个 NotesBoard，**不另写一份板子**：组件本身只是
 * 「控制器 + 渲染出口」，状态在模块级 store（board-store / notes-stats / notes-nav），
 * 所以中间列与右侧栏两处挂载看到的是同一份数据、同一套代码，没有第二份要维护。
 *
 * 差别只有两处：
 * - 「关掉」往哪走：中间列是 ctx.layout.selectPanel(null) 交还会话；这里是
 *   tab.actions.close() 关掉自己这个 tab；
 * - surface='sidebar'：不参与 sibling 面板（task-board / ssh / daily-log）的中间列
 *   互斥广播 —— 右侧栏 tab 不占中间列，广播只会白赶走兄弟面板，还会被兄弟面板的
 *   反向广播把自己的 tab 关掉。
 *
 * 远端通道与设置 scope 由注册处**闭包带进来**（与其它入口同款），所以本文件不做
 * 跨包注入、只 import 类型。
 */

import { useMemo } from 'react';
// type-only：把 sidebar.right.* 座位声明带进 SlotMap（运行时零依赖）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { NotesConfig } from '../../types.ts';
import type { NotesRemote } from '../core/notes-remote.ts';
import { NotesBoard } from './board-view.tsx';

export type NotesSidebarBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & {
  /** notes 远程通道（注册处闭包注入）。 */
  readonly notes: NotesRemote;
  /** forge-studio-notes 命名空间 scope（注册处闭包注入）。 */
  readonly scope: SettingsScope<NotesConfig>;
};

/** @returns 右侧栏 tab 里的便签板（与中间列主面板同一个组件）。 */
export function NotesSidebarBody(props: NotesSidebarBodyProps): JSX.Element {
  const { useTabInfo, notes, scope } = props;
  const { tab } = useTabInfo();
  const face = useMemo(
    () => ({
      notes,
      scope,
      closeBoard: () => {
        tab.actions.close();
      },
    }),
    [notes, scope, tab],
  );
  return (
    <div className="fs-note-sidebar-body">
      <NotesBoard face={face} surface="sidebar" />
    </div>
  );
}
