/**
 * 入口图标的通用按钮：会话区各入口（记一笔 / 打开便签板 / 待办角标）共用同一套
 * 外观与无障碍属性，避免每个入口各写一遍 button。
 *
 * 纯展示零件：不读设置、不管开关（开关由各自的入口组件判定后决定渲不渲染）。
 */

import type { ReactNode } from 'react';

export interface NotesEntryIconButtonProps {
  /** 无障碍名与 tooltip 文案。 */
  readonly label: string;
  readonly onClick: () => void;
  /** 图标节点（调用方决定尺寸与图标）。 */
  readonly children: ReactNode;
  /** 高亮态（如便签板正开着）。 */
  readonly active?: boolean;
}

/** @returns 一个 28px 见方的图标按钮。 */
export function NotesEntryIconButton(props: NotesEntryIconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="fs-note-entry-btn"
      title={props.label}
      aria-label={props.label}
      data-active={props.active === true ? '' : undefined}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
