/**
 * 操作栏的两个小组件：带选中态的图标按钮与分隔线。
 * 从 note-editor 拆出（原文件 2000 行），只吃 props、无自有状态。
 */
import { t } from '../core/theme-tokens.ts'
import styles from '../styles/notes-editor.module.css'

/* ---------- 操作栏小组件 ---------- */

export function ToolButton(props: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className={styles.tool}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      style={{
        ...toolBtn,
        ...(props.active
          ? { background: t.activeBg, color: t.labelPrimary }
          : {}),
        ...(props.disabled ? { cursor: "default", opacity: 0.35 } : {}),
      }}
    >
      {props.children}
    </button>
  );
}

export function ToolDivider(): JSX.Element {
  return (
    <span
      style={{ width: 1, height: 16, background: t.borderL2, margin: "0 2px" }}
    />
  );
}

/* ---------- 样式 ---------- */

const toolBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  padding: 0,
  border: "none",
  borderRadius: 7,
  background: "transparent",
  color: t.labelSecondary,
  cursor: "pointer",
};
