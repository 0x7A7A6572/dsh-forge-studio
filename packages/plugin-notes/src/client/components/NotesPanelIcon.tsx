/**
 * 侧栏顶部那一行的便签入口（slot: sidebar.panellist）。
 *
 * **这一行没有自己的开关**：它在不在，由「注册在不在」决定 —— 关闭即整行注销
 * （写法见 client/index.ts 的 syncPanelEntry）。宿主会给每个 panellist 项画自己的按钮
 * 外壳（label 也在壳里），组件返回 null 只会留下一条写着「便签」的空壳，那不是关掉。
 */

import { useSyncExternalStore } from "react";
import { NotepadText, Plus as PlusIcon } from "lucide-react";
import { notesStatsStore, openTaskText } from "../core/notes-stats.ts";
import styles from "../styles/notes-entry.module.css";

export interface NotesPanelIconProps {
  /** 侧栏请求的方形边长（宽态 16 / rail 18）。 */
  readonly size: number;
  /** 该面板是否为当前选中项（侧栏提供，用于字形着色）。 */
  readonly active: boolean;
  /** 快捷新建：开快捷新建浮层（与输入栏「记一笔」同一个动作）。 */
  readonly capture: () => void;
  /** 面板标题文案（与注册时给侧栏的 label 同源）：接管整行时由我们自己渲染。 */
  readonly label: string;
}

/** @returns 便签板在侧栏面板列里的整行字形 [图标 便签 … 待办数 (＋)]。 */
export function NotesPanelIcon({
  size,
  active,
  capture,
  label,
}: NotesPanelIconProps): JSX.Element {
  const count = useSyncExternalStore(
    notesStatsStore.subscribe,
    () => notesStatsStore.openTasks,
  );
  return (
    <div className={styles.panelGlyph}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, flex: "1 1 auto" }}>
        <NotepadText
          size={size}
          aria-hidden
          style={{ opacity: active ? 1 : 0.75 }}
        />
        <span className={styles.panelTitle}>{label}</span>
      </div>

      {/* 不需要弹簧元素：字形是 inline-flex + justify-content: space-between，
          接管整行后左右两组自己会被顶到两端。 */}

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          minWidth: 0,
          flex: "none",
        }}
      >
        {count > 0 && (
          <span className={styles.panelCount} title={openTaskText(count)}>
            {count > 99 ? "99+" : count}
          </span>
        )}

        <PlusIcon
          size={14}
          className={styles.panelAdd}
          data-testid="notes-panel-add"
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
            capture();
          }}
        />
      </div>
    </div>
  );
}
