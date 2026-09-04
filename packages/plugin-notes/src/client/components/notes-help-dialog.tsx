/**
 * 便签板「使用说明」弹窗：header 说明按钮打开，正文 = 中文使用说明 markdown
 * （core/help-content.ts 的 HELP_MARKDOWN），用 tiptap 只读实例
 * （note-preview 的 NoteMarkdownView）渲染 —— 说明观感与便签正文只读一致。
 * 结构与 settings/editor 弹窗同构：遮罩点击关闭 + 圆角卡片 + header 关闭钮；
 * 卡片比设置弹窗宽，正文区域内部滚动（超长说明不撑破便签板）。
 */

import { t } from '../core/theme-tokens.ts';
import { HELP_MARKDOWN } from '../core/help-content.ts';
import { NoteMarkdownView } from './note-preview.tsx';
import { X } from 'lucide-react';
// esbuild dataurl loader 内联的 data URI（见 src/client/assets.d.ts），运行时无外部请求。
import noteFlowBanner from '../assets/note-flow-banner.webp';

export interface NotesHelpDialogProps {
  readonly onClose: () => void;
}

export function NotesHelpDialog(props: NotesHelpDialogProps): JSX.Element {
  return (
    <div style={overlayStyle} onClick={props.onClose}>
      <div
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="智能便签使用说明"
      >
        <header style={headerStyle}>
          <span style={cardTitle}>智能便签 · 使用说明</span>
          <button
            type="button"
            title="关闭说明"
            aria-label="关闭说明"
            onClick={props.onClose}
            style={iconBtn}
          >
            <X size={14} />
          </button>
        </header>
        <div style={bodyStyle}>
          <img src={noteFlowBanner} alt="" style={bannerStyle} />
          <NoteMarkdownView markdown={HELP_MARKDOWN} />
        </div>
      </div>
    </div>
  );
}

/* ---------- 样式（与 editor/settings 弹窗同构，正文区内部滚动） ---------- */

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 10,
  display: 'flex',
  background: t.mask,
  padding: 16,
  boxSizing: 'border-box',
  overflow: 'auto',
};
const cardStyle: React.CSSProperties = {
  margin: 'auto',
  width: 'min(760px, 100%)',
  maxHeight: 'min(78vh, 640px)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 14,
  background: t.surfaceRaised,
  border: `1px solid ${t.borderL2}`,
  borderRadius: 12,
  boxShadow: t.shadowLv3,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flex: 'none',
};
const cardTitle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: t.labelPrimary,
};
const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  // border: `1px solid ${t.borderL2}`,
  // borderRadius: 10,
  // background: t.surface,
};
const bannerStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: 'auto',
  borderRadius: 8,
  flex: 'none',
};
const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: t.labelSecondary,
  cursor: 'pointer',
};
