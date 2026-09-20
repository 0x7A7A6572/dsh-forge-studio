/**
 * 设置卡片：标题 +（可选）说明 + 内容，版式对齐 dsh 设置页里的分区卡片。
 *
 * 用中性半透明底 + 一圈描边做「浮在弹窗底上」的层次，而不是再要一个 surface 令牌 ——
 * 明暗两套主题下都不会跟弹窗底色糊在一起。控件一律仍走 ui-primitives。
 */

import type { ReactNode } from 'react';
import { t } from '../core/theme-tokens.ts';

export interface SettingsCardProps {
  /** 卡片标题（一句话说清这组设置管什么）。 */
  readonly title: string;
  /** 标题下的一段说明（可为空）。 */
  readonly desc?: string;
  /** 标题右侧的附加内容（按钮 / 徽标）。 */
  readonly extra?: ReactNode;
  readonly children: ReactNode;
}

/** @returns 一张设置分组卡片。 */
export function SettingsCard(props: SettingsCardProps): JSX.Element {
  return (
    <section style={cardStyle}>
      <div style={headStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={titleStyle}>{props.title}</span>
          {props.desc !== undefined && <span style={descStyle}>{props.desc}</span>}
        </div>
        {props.extra}
      </div>
      <div style={bodyStyle}>{props.children}</div>
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '12px 14px',
  background: 'rgba(127, 127, 127, 0.06)',
  border: `1px solid ${t.borderL1}`,
  borderRadius: 10,
};
const headStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 10,
};
const titleStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  color: t.labelPrimary,
};
const descStyle: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  color: t.labelCaption,
};
const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
