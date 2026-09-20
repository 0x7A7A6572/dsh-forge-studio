/**
 * 输入栏左侧的入口工具条（slot: conversation.input.left）：记一笔 | 打开便签板 | 待办数。
 *
 * 合并前输入框左右各站一个按钮（左边「记一笔」、右边「打开便签板」），同一件事被拆到
 * 两头；现在只留左侧**一个**槽位注册，三项都长在这条工具条里。
 *
 * 待办数直接读 notesStatsStore（与侧栏徽标同源、事件驱动无轮询）。为 0 时只是变淡并
 * 改文案，**不隐藏** —— 工具条的三格位置必须稳定，否则每次计数归零按钮都会跳一格。
 */

import { useSyncExternalStore } from 'react';
import { StickyNote, StickyNotePlus } from 'lucide-react';
import { useNotesEntryEnabled } from '../hooks/useNotesEntryEnabled.ts';
import { notesStatsStore } from '../core/notes-stats.ts';
import { NotesEntryIconButton } from './NotesEntryIconButton.tsx';
import type { NotesUiFace } from '../core/notes-ui-face.ts';

export interface NotesInputToolbarProps extends NotesUiFace {}

/** @returns 输入栏便签工具条；开关关闭时渲染 null（不占位）。 */
export function NotesInputToolbar(props: NotesInputToolbarProps): JSX.Element | null {
  const enabled = useNotesEntryEnabled(props.scope, 'inputToolbar');
  const count = useSyncExternalStore(
    notesStatsStore.subscribe,
    () => notesStatsStore.openTasks,
  );
  if (!enabled) return null;
  const text = `待办 ${count > 99 ? '99+' : count}`;
  return (
    <div className="fs-note-toolbar" role="toolbar" aria-label="便签">
      <NotesEntryIconButton label="记一笔便签" onClick={props.capture}>
        <StickyNotePlus size={16} />
      </NotesEntryIconButton>
      <NotesEntryIconButton label="打开便签板" onClick={props.openBoard}>
        <StickyNote size={16} />
      </NotesEntryIconButton>
      <button
        type="button"
        className="fs-note-toolbar-count"
        data-empty={count <= 0 ? '' : undefined}
        title={`${text}；点开便签板`}
        aria-label={`${text}；打开便签板`}
        onClick={props.openBoard}
      >
        {text}
      </button>
    </div>
  );
}
