/**
 * daily-log 工作区的样式：视觉语言对齐 dsh 设置页（Agent 预设分区）——
 * 0.5px 描边卡片 + 卡片栅格 + 分组小标题 + 虚线新增位，全部走宿主 --dsw-* 令牌。
 *
 * 只注入一次，选择器统一挂在 [data-dsh-dailylog-ui] 之下：这个根属性同时贴在
 * 设置分区根节点与每个 Modal 内容包一层上——Modal 是 body 级 portal，挂在分区
 * 选择器下会失配，故与分区共用同一个根标记。
 */

/**
 * 样式根标记 `data-dsh-dailylog-ui`：设置分区根节点与每个 Modal 内容包装层都带它
 * （见 views/parts.tsx 的 DialogRoot）。
 */
const STYLE_ATTR = 'data-dsh-dailylog-style'

const CSS = `
[data-dsh-dailylog-ui] {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 720px;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
}

/* 分区标题与引言（与 Agent 预设分区同规格）。 */
[data-dsh-dailylog-ui] .dl-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

[data-dsh-dailylog-ui] .dl-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

/* 版本号：贴着标题但不抢标题（基线对齐 + 弱化色 + 等宽数字）。 */
[data-dsh-dailylog-ui] .dl-version {
  font-size: 12px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}

[data-dsh-dailylog-ui] .dl-intro {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

/* 「注册 /report 指令」开关行：一个开关 + 解释文案（关掉后模型仍可自行启用，必须说清）。
   位置在分区顶部：它决定指令是否存在，属于使用前先看一眼的配置。 */
[data-dsh-dailylog-ui] .dl-switch-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 16px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 14px;
  background: var(--dsw-alias-bg-module-platform);
}

[data-dsh-dailylog-ui] .dl-switch-copy {
  display: grid;
  gap: 4px;
  min-width: 0;
}

[data-dsh-dailylog-ui] .dl-switch-title {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.5;
}

[data-dsh-dailylog-ui] .dl-switch-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-dailylog-ui] .dl-switch-hint {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-dailylog-ui] .dl-switch {
  position: relative;
  flex: none;
  width: 40px;
  height: 24px;
  margin-top: 2px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

[data-dsh-dailylog-ui] .dl-switch:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

[data-dsh-dailylog-ui] .dl-switch-on {
  /* 同 mem-switch：没有 --dsw-alias-bg-accent，品牌色是 state-business-primary。 */
  background: var(--dsw-alias-state-business-primary, var(--dsw-alias-label-primary));
  border-color: transparent;
}

[data-dsh-dailylog-ui] .dl-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--dsw-alias-label-primary);
  transition: transform 120ms ease, background 120ms ease;
}

[data-dsh-dailylog-ui] .dl-switch-on .dl-switch-knob {
  transform: translateX(16px);
  background: var(--dsw-alias-bg-module-platform);
}

/* 对话式生成：分区唯一的主操作，做成一块 framed 模块。 */
[data-dsh-dailylog-ui] .dl-generate {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 16px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 14px;
  background: var(--dsw-alias-bg-module-platform);
}

[data-dsh-dailylog-ui] .dl-generate-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

[data-dsh-dailylog-ui] .dl-generate-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

[data-dsh-dailylog-ui] .dl-generate-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-dailylog-ui] .dl-generate-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-dailylog-ui] .dl-generate-action {
  flex: none;
}

/* 分组内的页签：与设置左导航同款单元格（32px、r12、选中填充）。 */
[data-dsh-dailylog-ui] .dl-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

[data-dsh-dailylog-ui] .dl-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-dailylog-ui] .dl-tab:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover);
  color: var(--dsw-alias-label-primary);
}

[data-dsh-dailylog-ui] .dl-tab-active,
[data-dsh-dailylog-ui] .dl-tab-active:hover {
  background: var(--dsw-specific-sidebar-nav-item-active);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}

[data-dsh-dailylog-ui] .dl-tab-count {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-dailylog-ui] .dl-tab-active .dl-tab-count {
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-dailylog-ui] .dl-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

[data-dsh-dailylog-ui] .dl-group-head {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-dailylog-ui] .dl-empty,
[data-dsh-dailylog-ui] .dl-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
}

[data-dsh-dailylog-ui] .dl-empty {
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-dailylog-ui] .dl-note {
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-dailylog-ui] .dl-error {
  margin: 0;
  font-size: 12px;
  color: var(--dsw-alias-state-error-primary);
}

/* 卡片栅格：与 Agent 预设的 roster 同规格（auto-fill 268 起，行等高）。 */
[data-dsh-dailylog-ui] .dl-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  grid-auto-rows: 1fr;
  gap: 12px;
}

[data-dsh-dailylog-ui] .dl-card {
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 20px;
  background: transparent;
  transition: border-color .16s, background .16s;
}

[data-dsh-dailylog-ui] .dl-card:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

/* 展开的报告正文横跨整行：栅格列宽读长文太窄。 */
[data-dsh-dailylog-ui] .dl-card-wide {
  grid-column: 1 / -1;
}

[data-dsh-dailylog-ui] .dl-card-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 14px 16px 12px;
}

[data-dsh-dailylog-ui] .dl-card-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

[data-dsh-dailylog-ui] .dl-card-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
}

[data-dsh-dailylog-ui] .dl-card-desc {
  font-size: 13px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

[data-dsh-dailylog-ui] .dl-clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  min-height: 21px;
}

[data-dsh-dailylog-ui] .dl-card-path {
  margin-top: auto;
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Input 原语的包壳是 inline-flex：放进 flex 行里要显式长开。 */
[data-dsh-dailylog-ui] .dl-grow {
  flex: 1 1 0;
  min-width: 0;
}

[data-dsh-dailylog-ui] .dl-card-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  padding: 6px 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

/* 图标按钮：标签走 data-tip 气泡，行内保持安静。 */
[data-dsh-dailylog-ui] .dl-icon-btn {
  position: relative;
  appearance: none;
  display: inline-flex;
  align-items: center;
  padding: 6px;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}

[data-dsh-dailylog-ui] .dl-icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

[data-dsh-dailylog-ui] .dl-icon-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}

[data-dsh-dailylog-ui] .dl-icon-btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -1px;
}

[data-dsh-dailylog-ui] .dl-icon-danger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
}

[data-dsh-dailylog-ui] .dl-icon-btn::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-layer-3);
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s;
}

[data-dsh-dailylog-ui] .dl-icon-btn:hover::after,
[data-dsh-dailylog-ui] .dl-icon-btn:focus-visible::after {
  opacity: 1;
}

/* 新增位：虚线胶囊，像一个「之后会长出东西」的位置，而不是一条命令。 */
[data-dsh-dailylog-ui] .dl-add {
  box-sizing: border-box;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border: 1px dashed var(--dsw-alias-border-l3);
  border-radius: 20px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}

[data-dsh-dailylog-ui] .dl-add:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
}

[data-dsh-dailylog-ui] .dl-add:disabled {
  opacity: 0.4;
  cursor: default;
}

[data-dsh-dailylog-ui] .dl-add-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

[data-dsh-dailylog-ui] .dl-text-btn {
  border: none;
  border-radius: 7px;
  padding: 6px 8px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

[data-dsh-dailylog-ui] .dl-text-btn:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}

[data-dsh-dailylog-ui] .dl-text-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 渠道小标（Git / DSH / Claude / Codex）：命中即亮。 */
[data-dsh-dailylog-ui] .dl-chips {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

[data-dsh-dailylog-ui] .dl-chip {
  padding: 0 6px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  color: var(--dsw-alias-label-secondary);
  font-size: 10.5px;
  line-height: 16px;
  white-space: nowrap;
  flex: none;
}

[data-dsh-dailylog-ui] .dl-chip-on {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}

/* 弹窗（Modal 内容包一层带同一个根标记）。 */
[data-dsh-dailylog-ui] .dl-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

[data-dsh-dailylog-ui] .dl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

[data-dsh-dailylog-ui] .dl-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary);
}

[data-dsh-dailylog-ui] .dl-field-row {
  display: flex;
  gap: 8px;
  min-width: 0;
}

[data-dsh-dailylog-ui] .dl-textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 9px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 1.6;
  resize: vertical;
}

[data-dsh-dailylog-ui] .dl-textarea:focus {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
}

[data-dsh-dailylog-ui] .dl-textarea::placeholder {
  color: var(--dsw-alias-label-dimmed);
}

[data-dsh-dailylog-ui] .dl-seg {
  display: inline-flex;
  flex: none;
  gap: 2px;
  padding: 2px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 14px;
  background: var(--dsw-alias-bg-base);
}

[data-dsh-dailylog-ui] .dl-seg-btn {
  border: none;
  border-radius: 12px;
  padding: 4px 12px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

[data-dsh-dailylog-ui] .dl-seg-btn-active {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-weight: 600;
}

[data-dsh-dailylog-ui] .dl-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-dailylog-ui] .dl-divider::before,
[data-dsh-dailylog-ui] .dl-divider::after {
  content: '';
  flex: 1;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

/* 穿梭框（会话库导入）：左右两个滚动列表。 */
[data-dsh-dailylog-ui] .dl-transfer {
  display: flex;
  gap: 10px;
  min-height: 0;
}

[data-dsh-dailylog-ui] .dl-transfer-pane {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

[data-dsh-dailylog-ui] .dl-transfer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

[data-dsh-dailylog-ui] .dl-list-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 160px;
  max-height: 40vh;
  overflow: auto;
  padding: 8px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

[data-dsh-dailylog-ui] .dl-item {
  display: flex;
  flex-direction: column;
  flex: none;
  gap: 3px;
  padding: 7px 10px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2);
}

[data-dsh-dailylog-ui] .dl-item-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

[data-dsh-dailylog-ui] .dl-item-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 600;
}

[data-dsh-dailylog-ui] .dl-item-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary);
}

[data-dsh-dailylog-ui] .dl-item-detail {
  flex: none;
  font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary);
}

/* 长正文（报告正文 / 模板预览）：卡片内滚动，不把卡片撑长。 */
[data-dsh-dailylog-ui] .dl-code {
  margin: 0;
  padding: 12px;
  max-height: min(52vh, 420px);
  overflow: auto;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

[data-dsh-dailylog-ui] .dl-preview {
  min-height: 60px;
  max-height: 320px;
  overflow: auto;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

/* 报告正文 / 模板预览的加高滚动区（长文读起来才够用）。 */
[data-dsh-dailylog-ui] .dl-preview-tall {
  max-height: min(52vh, 420px);
}

[data-dsh-dailylog-ui] .dl-textarea-prompt {
  min-height: 200px;
}

[data-dsh-dailylog-ui] .dl-textarea-skeleton {
  min-height: 240px;
}

/* Modal 卡片宽度覆写：className 落在 portal 出去的卡片本身（不在根标记之内），
   所以这两条按插件命名空间（dl-*）直接声明，宿主默认是 min(380px,100%)。 */
.dl-dialog-md {
  width: min(560px, 100%);
}

.dl-dialog-lg {
  width: min(760px, 100%);
}
`

let installed = false

/** 幂等注入分区样式（只挂一个 <style>，卸载不回收：与侧栏入口样式同一约定）。 */
export function ensureDailyLogStyle(): void {
  if (installed || typeof document === 'undefined') return
  installed = true
  if (document.querySelector('style[' + STYLE_ATTR + ']') !== null) return
  const el = document.createElement('style')
  el.setAttribute(STYLE_ATTR, '')
  el.textContent = CSS
  document.head.appendChild(el)
}
