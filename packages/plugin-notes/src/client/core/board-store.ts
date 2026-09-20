/**
 * 便签板 UI 的模块级存储：三个 UI 面共用同一份，跨挂载/跨开关保留用户选择。
 * - 便签板主面板（views/board-view）—— 选中时才挂载；
 * - 会话/侧栏入口按钮（components/Notes*）—— 只管开板与快捷新建；
 * - 快捷新建浮层（views/quick-add-dialog）—— 独立的 quickAdd 开关。
 *
 * 组件一律用 useSyncExternalStore 订阅。
 *
 * **mounted 取代了原先的 open**：DOM 接管时代面板常驻挂载、靠 <html> 属性 + CSS
 * 隐藏，所以必须自己记一个「逻辑上开着吗」；现在便签板由 ui-layout 的 main keyed
 * slot 按选中态渲染，**挂载态即可见态**，不再需要第二个真相来源。
 */

import type { NoteColor } from '../../types.ts';
import type { NoteDraft } from './notes-nav.ts';

/** 便签板显示模式：行式列表 / grid 纸卡墙 / 任务泳道（五列看板）。 */
export type BoardView = 'list' | 'grid' | 'lanes';

type Listener = () => void;

const state = {
  /** 便签板主面板挂载中（board-view 在 effect 里回写）。 */
  mounted: false,
  /** 快捷新建浮层开关（与便签板互不影响：开着浮层不代表开着板）。 */
  quickAdd: false,
  /**
   * 快捷新建的预填内容：助手消息「存成便签」把那条回答带进来。
   * 每次 showQuickAdd 整体替换 —— 不带草稿就是空编辑器。
   */
  quickAddDraft: undefined as NoteDraft | undefined,
  /** 打开序号：编辑器只在挂载那一刻读初值，草稿换了得靠它换 key（见 editor-page-dialog）。 */
  quickAddSeq: 0,
  view: 'grid' as BoardView,
  /** 颜色筛选；空数组 = 不过滤（显示全部颜色）。 */
  colors: [] as readonly NoteColor[],
  /** 文字搜索（标题/正文）；空串 = 不过滤。 */
  query: '',
};
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export const boardStore = {
  get mounted(): boolean {
    return state.mounted;
  },
  /** 由便签板主面板在挂载/卸载时回写（供 notes-stats 判断是否重复拉取）。 */
  setMounted(mounted: boolean): void {
    if (state.mounted === mounted) return;
    state.mounted = mounted;
    emit();
  },
  get quickAdd(): boolean {
    return state.quickAdd;
  },
  get quickAddDraft(): NoteDraft | undefined {
    return state.quickAddDraft;
  },
  get quickAddSeq(): number {
    return state.quickAddSeq;
  },
  /**
   * 打开快捷新建浮层。
   * @param draft - 预填内容（助手消息「存成便签」带的那条回答）；省略 = 空编辑器。
   */
  showQuickAdd(draft?: NoteDraft): void {
    // 先写草稿再判开关：浮层已经开着时再点一次「存成便签」，要换成新那条回答
    // （序号变化会让编辑器换 key 重挂，否则初值不生效）。
    state.quickAddDraft = draft;
    state.quickAddSeq += 1;
    state.quickAdd = true;
    emit();
  },
  hideQuickAdd(): void {
    if (!state.quickAdd) return;
    state.quickAdd = false;
    emit();
  },
  toggleQuickAdd(): void {
    if (state.quickAdd) boardStore.hideQuickAdd();
    else boardStore.showQuickAdd();
  },
  /** 关掉浮层时丢掉草稿：下次打开要么是空的，要么由调用方重新给。 */
  clearQuickAddDraft(): void {
    state.quickAddDraft = undefined;
  },
  get view(): BoardView {
    return state.view;
  },
  setView(view: BoardView): void {
    if (state.view === view) return;
    state.view = view;
    emit();
  },
  get colors(): readonly NoteColor[] {
    return state.colors;
  },
  /** 加入/移出色板筛选（空数组 = 不过滤）。 */
  toggleColor(color: NoteColor): void {
    state.colors = state.colors.includes(color)
      ? state.colors.filter((c) => c !== color)
      : [...state.colors, color];
    emit();
  },
  clearColors(): void {
    if (state.colors.length === 0) return;
    state.colors = [];
    emit();
  },
  get query(): string {
    return state.query;
  },
  setQuery(query: string): void {
    // 存原始输入（光标/空格可编辑）；匹配时由 searchNotes 统一 trim。
    if (state.query === query) return;
    state.query = query;
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
