/**
 * 输入栏左侧的便签入口（slot: conversation.input.left）：**一个** notepad-text 字形，
 * 点开才弹出「新增便签 / 便签板 / 任务泳道」三行菜单。
 *
 * 以前这里并排三个格子（记一笔 | 打开便签板 | 待办数）还带一层淡便签黄底：输入框
 * 左下角本来就窄，三个字形都在跟输入区抢宽度。收成一个字形后各件事进弹层，底色
 * 一并去掉 —— 入口只剩一个字形。
 *
 * 三条交互契约（M1）：
 * 1. **点选即关**：Menu 是 owner-controlled —— 它只回调 onSelect / onClose，「选完收不
 *    收」是插件自己的事（见 ui-primitives 的 Menu 文档）。少了这一步，点完菜单会赖在
 *    输入框上面不走。所以 onSelect 第一件事就是关。
 * 2. **「任务泳道」直达**：开板 + 把视图切到泳道页签（openTaskLanes），不用先在板上
 *    切一次视图。
 * 3. **待办数挂在「任务泳道」那一行**，不再挂入口字形：这个数字的语义就是泳道里
 *    「待办 + 进行中」的条数（见 core/task-lanes.countOpenTasks），挂在入口上只会让
 *    输入框左下角多一个跟当前输入无关的角标。为 0 时不渲染（没意义的数字不如不写）。
 *
 * 数字读 notesStatsStore（与侧栏小签同源、事件驱动无轮询）。
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Kanban, NotepadText, Plus, StickyNote } from 'lucide-react';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives';
import { useNotesEntryEnabled } from '../hooks/useNotesEntryEnabled.ts';
import { notesStatsStore } from '../core/notes-stats.ts';
import { NotesEntryIconButton } from './NotesEntryIconButton.tsx';
import type { NotesUiFace } from '../core/notes-ui-face.ts';
import styles from '../styles/notes-entry.module.css';

export interface NotesInputToolbarProps extends NotesUiFace {}

/** @returns 输入栏便签入口；开关关闭时渲染 null（不占位）。 */
export function NotesInputToolbar(props: NotesInputToolbarProps): JSX.Element | null {
  const enabled = useNotesEntryEnabled(props.scope, 'inputToolbar');
  const count = useSyncExternalStore(
    notesStatsStore.subscribe,
    () => notesStatsStore.openTasks,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const { capture, openBoard, openTaskLanes } = props;

  const select = useCallback((id: string): void => {
    // 点选即关（契约 1）：先收菜单再导航 —— 跳走的那一瞬间浮层还挂在旧位置上很难看。
    setMenuOpen(false);
    if (id === 'capture') capture();
    else if (id === 'board') openBoard();
    else if (id === 'lanes') openTaskLanes();
  }, [capture, openBoard, openTaskLanes]);

  /** 待办数徽标：只在这一行上出现，>99 收成 99+。 */
  const badge = count > 99 ? '99+' : String(count);
  const items = useMemo<readonly MenuEntry[]>(() => [
    { id: 'capture', label: '新增便签', icon: <Plus size={14} /> },
    { id: 'board', label: '便签板', icon: <StickyNote size={14} /> },
    {
      id: 'lanes',
      icon: <Kanban size={14} />,
      // 计数进 label（MenuEntry.label 是 ReactNode）：贴着文字，不另占一列。
      label: count > 0
        ? (
          <span className={styles.menuRow}>
            <span>任务泳道</span>
            <span className={styles.menuBadge} title={`待办与进行中的任务共 ${badge} 条`}>
              {badge}
            </span>
          </span>
        )
        : '任务泳道',
    },
  ], [count, badge]);

  if (!enabled) return null;
  // 入口字形不再挂角标（契约 3）：计数只在菜单里。无障碍名仍带数字，读屏用户不必
  // 展开菜单才知道有几条待办。
  const label = count > 0 ? `便签（待办 ${badge}）` : '便签';

  return (
    <Menu
      className={styles.toolbar}
      open={menuOpen}
      anchor={(
        <NotesEntryIconButton
          label={label}
          expanded={menuOpen}
          onClick={() => { setMenuOpen((open) => !open); }}
        >
          <NotepadText size={16} />
        </NotesEntryIconButton>
      )}
      items={items}
      onSelect={select}
      onClose={() => { setMenuOpen(false); }}
      align="start"
      side="top"
      dense
      portal
    />
  );
}
