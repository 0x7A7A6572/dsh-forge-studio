/**
 * 输入栏左侧的便签入口（slot: conversation.input.left）：**一个** notepad-text 字形，
 * 点开才弹出「新增便签 / 便签板」两行菜单。
 *
 * 以前这里并排三个格子（记一笔 | 打开便签板 | 待办数）还带一层淡便签黄底：输入框
 * 左下角本来就窄，三个字形都在跟输入区抢宽度。收成一个字形后两件事进弹层，底色
 * 一并去掉 —— 入口只剩一个字形。
 *
 * 角标读 notesStatsStore（与侧栏小签同源、事件驱动无轮询）；待办为 0 时不渲染，
 * 免得图标长期挂一个没意义的数字。
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import { NotepadText, Plus, StickyNote } from 'lucide-react';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives';
import { useNotesEntryEnabled } from '../hooks/useNotesEntryEnabled.ts';
import { notesStatsStore } from '../core/notes-stats.ts';
import { NotesEntryIconButton } from './NotesEntryIconButton.tsx';
import type { NotesUiFace } from '../core/notes-ui-face.ts';
import styles from '../styles/notes-entry.module.css';

export interface NotesInputToolbarProps extends NotesUiFace {}

/** 入口弹层的两行：新增便签（快捷新建浮层）/ 便签板。 */
const MENU_ITEMS: readonly MenuEntry[] = [
  { id: 'capture', label: '新增便签', icon: <Plus size={14} /> },
  { id: 'board', label: '便签板', icon: <StickyNote size={14} /> },
];

/** @returns 输入栏便签入口；开关关闭时渲染 null（不占位）。 */
export function NotesInputToolbar(props: NotesInputToolbarProps): JSX.Element | null {
  const enabled = useNotesEntryEnabled(props.scope, 'inputToolbar');
  const count = useSyncExternalStore(
    notesStatsStore.subscribe,
    () => notesStatsStore.openTasks,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const { capture, openBoard } = props;

  const select = useCallback((id: string): void => {
    if (id === 'capture') capture();
    else if (id === 'board') openBoard();
  }, [capture, openBoard]);

  if (!enabled) return null;
  const badge = count > 99 ? '99+' : String(count);
  const label = count > 0 ? `便签（待办 ${badge}）` : '便签';

  return (
    <Menu
      className={styles.toolbar}
      open={menuOpen}
      anchor={(
        <NotesEntryIconButton
          label={label}
          badge={count > 0 ? badge : undefined}
          expanded={menuOpen}
          onClick={() => { setMenuOpen((open) => !open); }}
        >
          <NotepadText size={16} />
        </NotesEntryIconButton>
      )}
      items={MENU_ITEMS}
      onSelect={select}
      onClose={() => { setMenuOpen(false); }}
      align="start"
      side="top"
      dense
      portal
    />
  );
}
