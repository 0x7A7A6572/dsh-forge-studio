/**
 * 开关行：左边标题 + 说明，右边 ui-primitives 的 Switch 原语。
 *
 * 用原语而不是手写 `<input type="checkbox">`：原语的 `label` 是必填的，渲染点
 * 没法漏掉可访问名（见 ui-primitives 的 Switch 注释），键盘与读屏行为也统一。
 */

import { Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { t } from '../core/theme-tokens.ts';

export interface SettingsSwitchRowProps {
  /** 行标题（同时作为 Switch 的可访问名）。 */
  readonly title: string;
  /** 一句话说明这个开关管什么。 */
  readonly desc: string;
  readonly checked: boolean;
  /** 是否禁止改动（写进行中，或这是最后一个开着的入口）。 */
  readonly disabled?: boolean;
  /** 禁用原因（悬停可见）。 */
  readonly lockReason?: string;
  readonly onChange: (next: boolean) => void;
}

/** @returns 一行「说明 + 开关」。 */
export function SettingsSwitchRow(props: SettingsSwitchRowProps): JSX.Element {
  return (
    <div style={rowStyle}>
      <div style={copyStyle}>
        <span style={titleStyle}>{props.title}</span>
        <span style={descStyle}>{props.desc}</span>
      </div>
      <Switch
        checked={props.checked}
        disabled={props.disabled === true}
        label={props.title}
        {...(props.lockReason !== undefined ? { title: props.lockReason } : {})}
        onChange={props.onChange}
      />
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};
const copyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
};
const titleStyle: React.CSSProperties = {
  fontSize: 13,
  color: t.labelPrimary,
};
const descStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: t.labelCaption,
};
