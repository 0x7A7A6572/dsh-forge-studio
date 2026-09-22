/**
 * 会话区入口的图标按钮：28px 命中区、hover/focus 观感、无障碍属性都在这里，
 * 免得每个入口各写一遍 button 与那套 aria 属性。
 *
 * 纯展示零件：不读设置、不管开关（开关由各自的入口组件判定后决定渲不渲染）。
 *
 * 曾经这里还有「右上角计数角标」：M1-3 把输入栏入口的待办数挪进了菜单的「任务泳道」
 * 那一行 —— 数字属于泳道，挂在入口字形上只会让输入框左下角多一个跟当前输入无关的
 * 角标。侧栏那一行的待办数走 NotesPanelIcon 自己的小签（.panelCount），与这里无关。
 */

import type { ReactNode } from 'react';
import styles from '../styles/notes-entry.module.css';

export interface NotesEntryIconButtonProps {
  /** 无障碍名与 tooltip 文案。 */
  readonly label: string;
  readonly onClick: () => void;
  /** 图标节点（调用方决定尺寸与图标）。 */
  readonly children: ReactNode;
  /** 高亮态（如便签板正开着）。 */
  readonly active?: boolean;
  /** 弹层锚的展开态：给了才带 aria-haspopup。 */
  readonly expanded?: boolean;
}

/** @returns 一个 28px 见方的图标按钮。 */
export function NotesEntryIconButton(props: NotesEntryIconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={styles.entryBtn}
      title={props.label}
      aria-label={props.label}
      aria-haspopup={props.expanded === undefined ? undefined : 'menu'}
      aria-expanded={props.expanded}
      data-active={props.active === true ? '' : undefined}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
