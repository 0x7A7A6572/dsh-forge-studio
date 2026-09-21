/**
 * 会话区入口的图标按钮：28px 命中区、hover/focus 观感、角落计数角标都在这里，
 * 免得每个入口各写一遍 button 与那套无障碍属性。
 *
 * 纯展示零件：不读设置、不管开关（开关由各自的入口组件判定后决定渲不渲染）。
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
  /** 右上角计数角标；空串/缺省不渲染 —— 为 0 时不该在图标上留一个没意义的数字。 */
  readonly badge?: string;
  /** 弹层锚的展开态：给了才带 aria-haspopup。 */
  readonly expanded?: boolean;
}

/** @returns 一个 28px 见方的图标按钮。 */
export function NotesEntryIconButton(props: NotesEntryIconButtonProps): JSX.Element {
  const { label, badge } = props;
  return (
    <button
      type="button"
      className={styles.entryBtn}
      title={label}
      aria-label={label}
      aria-haspopup={props.expanded === undefined ? undefined : 'menu'}
      aria-expanded={props.expanded}
      data-active={props.active === true ? '' : undefined}
      onClick={props.onClick}
    >
      {props.children}
      {badge !== undefined && badge !== '' && (
        <span className={styles.entryBadge} aria-hidden="true">{badge}</span>
      )}
    </button>
  );
}
