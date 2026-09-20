/**
 * 便签板作为 ui-layout 主面板的身份，以及与 sibling 面板（task-board / ssh /
 * daily-log）的互斥协调。
 *
 * 便签板**不再抢中间列的 DOM**：注册 \`main\` 的 keyed 槽 + \`sidebar.panellist\` 的
 * 同名 list id，选中与渲染都交给 ui-layout（侧栏点击 → ctx.layout.selectPanel）。
 * 侧栏那个 icon 与主面板是同一件事的两半 —— \`SidebarPanelMetadata.id\` 就是
 * main 的 key，所以两边必须用同一个常量。
 *
 * 但 sibling 三个面板仍走老的 DOM 接管，它们的 CSS 形如
 * \`[class*='centerCol'] > :not([data-dsh-xxx-view])\`，会把我们由 React 渲染的
 * 面板一并隐藏。所以保留一条薄协调：本面板激活时广播，收到它们的广播时交还
 * 中间列。等它们也迁到 main 之后，这个文件可以整体删掉。
 */

import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';

/** 便签板主面板 key，同时是 sidebar.panellist 的 list id（两者必须一致，见文件头）。 */
export const NOTES_PANEL_ID = 'notes' as MainPanelId;

/** 侧栏顶部那一行的标题：sidebar 用列表元数据渲染按钮的 title / aria-label。 */
export const NOTES_PANEL_LABEL = '智能便签';

/** 跨插件面板激活事件（与 task-board / ssh / daily-log 共用的既有协议）。 */
export const PANEL_ACTIVATE_EVENT = 'dsh-panel-activate';

/** sibling 面板在事件 detail 里用的名字（收到即交还中间列）。 */
const SIBLING_PANEL_NAMES: readonly string[] = ['taskboard', 'ssh', 'dailylog'];

/** 本面板激活时广播，让 sibling 收起它们的中间列接管。 */
export function announceNotesPanel(): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(PANEL_ACTIVATE_EVENT, { detail: 'notes' }));
}

/**
 * 监听 sibling 面板激活：任一 sibling 接管中间列时调用 onSiblingActivated
 * （调用方借此把 main 面板切回会话，避免「侧栏入口亮着但内容被盖住」）。
 * @returns 退订函数。
 */
export function watchSiblingPanels(onSiblingActivated: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const onActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail;
    if (typeof detail === 'string' && SIBLING_PANEL_NAMES.includes(detail)) onSiblingActivated();
  };
  document.addEventListener(PANEL_ACTIVATE_EVENT, onActivate);
  return () => document.removeEventListener(PANEL_ACTIVATE_EVENT, onActivate);
}
