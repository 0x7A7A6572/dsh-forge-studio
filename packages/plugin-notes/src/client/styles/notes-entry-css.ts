/**
 * 入口按钮的插件级样式（注入一次，全插件共用）。
 *
 * plugin-notes 目前仍在 esbuild 构建上（见仓库 CONVENTIONS 的构建迁移说明），没有
 * CSS Modules 的哈希与自动注入，所以沿用本包既有的「TS 导出 CSS 文本 + 一次性注入
 * <style>」范式（board-view 的 FRAME_CSS 同款）。将来迁到 tsdown 时，这里应改成
 * `client/styles/notes-entry.module.css` 并删掉注入函数。
 *
 * 类名统一 `fs-note-entry-` / `fs-note-` 前缀：没有哈希保护，只能靠前缀防串台。
 * 配色一律走宿主 `--dsw-*` 令牌，明暗自适应；只有便签黄（待办小签）是便签纸语义，
 * 固定色值。
 */

export const NOTES_ENTRY_CSS = `
.fs-note-entry-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background 130ms ease, color 130ms ease;
}
.fs-note-entry-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.fs-note-entry-btn:active { transform: scale(0.94); }
.fs-note-entry-btn:focus-visible {
  outline: 2px solid var(--dsw-static-deepseek-450);
  outline-offset: -2px;
}
.fs-note-entry-btn[data-active] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-active);
}
/* 输入栏工具条（记一笔 | 打开便签板 | 待办数）：一个槽位注册，三格并排。
   底色是一层极淡的便签黄（#f0cd00 + 8% 透明度）：输入框左下角那条本来就贴边，
   没有底会看不出这是一条整体的工具条。 */
.fs-note-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: none;
  background: #f0cd0014;
  border-radius: 8px;
  padding: 1px 4px;
}
.fs-note-toolbar-count {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 7px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  transition: background 130ms ease, color 130ms ease;
}
.fs-note-toolbar-count:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.fs-note-toolbar-count:focus-visible {
  outline: 2px solid var(--dsw-static-deepseek-450);
  outline-offset: -2px;
}
/* 有待办时给一层淡便签黄（与侧栏小签同一套语义）；没有时只降调，**不移除** —— 
   工具条三格位置要稳定，否则每次计数归零按钮都会跳一格。 */
.fs-note-toolbar-count:not([data-empty]) {
  background: rgba(227, 179, 65, 0.18);
  color: var(--dsw-alias-label-primary);
}
.fs-note-toolbar-count[data-empty] { opacity: 0.55; font-weight: 500; }
/* 侧栏顶部入口那一行：图标 + 标题 + 弹簧 + 待办数 + 快捷新建 (＋)。侧栏那行只给一个
   字形位，五件东西都长在里面（见 components/NotesPanelIcon）。默认版式里只有
   图标 + 小签 + (＋) —— 标题与弹簧是给「接管整行」用的。 */
.fs-note-panel-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 3px;
}
/* 标题：默认不显示（默认版式下宿主自己会渲染标题，见下面的接管规则）。 */
.fs-note-panel-title {
  display: none;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 弹簧：把待办数与 (＋) 顶到行最右。没接管时字形宽度 = 内容宽，弹簧拿到 0 宽。 */
.fs-note-panel-spacer {
  flex: 1 1 auto;
  min-width: 6px;
}
/* ---- 接管侧栏那一行：[图标 标题 ......... 待办数 (＋)] ----
   宿主那行是 button > span（字形位） + span（标题，仅宽态渲染），两个类名都被 CSS Modules
   哈希掉了，没有稳定钩子，只能 :has() 从 button 反查。条件**逐字相同**（这个行里既有我们的
   字形、又有两个并列的直接子 span = 宽态），几条规则一起生效、一起失效 —— 宿主结构一变就
   退回它自己的「图标 小签 (＋) 标题」，不会出现两个标题。
   两条硬约束：
   1. :has() **不能嵌套**（Chromium 会把整条规则当无效丢掉），所以条件里不写 span:has(...)；
   2. 不依赖 aria-hidden、也不假定我们的节点是那个 span 的直接子元素（都是宿主的实现细节），
      字形位就按宿主源码的顺序取第一个 span。 */
button:has(.fs-note-panel-glyph):has(> span + span) > span:first-child {
  flex: 1 1 auto;
  min-width: 0;
  justify-content: flex-start;
}
button:has(.fs-note-panel-glyph):has(> span + span) .fs-note-panel-glyph {
  width: 100%;
  gap: 6px;
}
button:has(.fs-note-panel-glyph):has(> span + span) > span:not(:first-child) {
  display: none;
}
button:has(.fs-note-panel-glyph):has(> span + span) .fs-note-panel-title {
  display: block;
}
/* 接管后 (＋) 给一个 18px 的点击面（默认版式里它只有 15px 的小签尺寸）。 */
button:has(.fs-note-panel-glyph):has(> span + span) .fs-note-panel-add {
  width: 18px;
  height: 18px;
}
.fs-note-panel-count {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  border-radius: 4px;
  background: #e3b341;
  color: #2e2a22;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.fs-note-panel-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}
.fs-note-panel-add:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
/* 收起成 rail（AppFrame 打 data-sidebar-collapsed）时那行只剩 36px 圆形按钮，
   装不下三件东西：只留图标。 */
[data-sidebar-collapsed] .fs-note-panel-count,
[data-sidebar-collapsed] .fs-note-panel-add { display: none; }
/* 右侧栏 tab 里的便签板宿主：板子根节点自带 height:100% 的纵向 flex，这里只负责
   给出那 100% 的高度（并把 min-height 让出去，否则窄栏里会被内容顶开）。 */
.fs-note-sidebar-body {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}
`;

let installed = false;

/** 注入入口样式（幂等；无 DOM 环境 no-op）。 */
export function ensureNotesEntryStyle(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const el = document.createElement('style');
  el.setAttribute('data-dsh-notes-entry-style', '');
  el.textContent = NOTES_ENTRY_CSS;
  document.head.appendChild(el);
}
