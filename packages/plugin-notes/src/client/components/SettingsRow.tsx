/**
 * 表单行：标签 + 控件 + 尾注，竖排（标签在上、控件占满宽度）。
 *
 * 根节点是**真 `<label>`**：文本类控件靠它拿可访问名，不然屏幕阅读器只会念
 * 「编辑框」。开关这类自带可访问名的控件走 SettingsSwitchRow，不要用本组件。
 */

import type { ReactNode } from 'react';
import { t } from '../core/theme-tokens.ts';

export interface SettingsRowProps {
  /** 行标签。 */
  readonly label: string;
  /** 标签右侧的小标记（例如「已覆盖」）。 */
  readonly badge?: ReactNode;
  /** 标签与控件之间的一句说明。 */
  readonly hint?: string;
  readonly children: ReactNode;
}

/** @returns 一列「标签 + 控件」的表单行。 */
export function SettingsRow(props: SettingsRowProps): JSX.Element {
  return (
    <label style={rowStyle}>
      <span style={labelStyle}>
        {props.label}
        {props.badge}
      </span>
      {props.hint !== undefined && <span style={hintStyle}>{props.hint}</span>}
      {props.children}
    </label>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const labelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontWeight: 600,
  fontSize: 13,
  color: t.labelPrimary,
};
const hintStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: t.labelCaption,
};
