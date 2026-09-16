/**
 * usage-billing 样式（按 fiber 注入一次；类名统一 `ub-` 前缀）。
 *
 * 视觉语言对齐 dsh 设置页与 plugin-memory：0.5px 描边卡片（--dsw-alias-border-l4）、
 * 分组小标题、卡片栅格、tabular-nums 数字。
 *
 * 两条硬规则，都是真的踩过坑：
 *
 * 1. **颜色只走 design-platform.css 里确实定义了的 --dsw-* alias token**。
 *    未定义的 var() 不会报错 —— 它让整条声明在 computed-value 阶段失效（连上一行的
 *    兜底也一起没），症状是「改了跟没改一样」。白名单由 tests/theme-tokens.test.ts 守着。
 * 2. **样式不依赖任何祖先属性**。弹窗是 createPortal(..., document.body)，弹窗内容不在
 *    设置分区的 DOM 子树里，写 `[data-dsh-usage-billing] .ub-card` 这类后代选择器会在弹窗里
 *    失配；所有规则因此只挂在插件自己的 ub- 类名上（类名前缀就是命名空间）。
 *    同理，给 Modal 加宽必须自带更高权重（`[role='dialog'].ub-modal`），否则会被
 *    Modal.module.css 的单类规则按「源码顺序」压住。
 */

import type { Context } from '@deepseek-ai/cordis'

/** 已核对的 alias token（见 docs：client/ui-theme/src/styles/design-platform.css）。 */
export const TOKENS = {
  bgBase: 'var(--dsw-alias-bg-base)',
  bgLayer1: 'var(--dsw-alias-bg-layer-1)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  bgModule: 'var(--dsw-alias-bg-module-platform)',
  bgOverlay: 'var(--dsw-alias-bg-overlay)',
  bgHover: 'var(--dsw-alias-interactive-bg-hover)',
  borderL1: 'var(--dsw-alias-border-l1)',
  borderL4: 'var(--dsw-alias-border-l4)',
  brand: 'var(--dsw-alias-brand-primary)',
  business: 'var(--dsw-alias-state-business-primary)',
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  labelTertiary: 'var(--dsw-alias-label-tertiary)',
  error: 'var(--dsw-alias-state-error-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
} as const

const CSS = `
/* ---------- 基础 ---------- */
[data-dsh-usage-billing] { box-sizing: border-box; font-variant-numeric: tabular-nums; }
[data-dsh-usage-billing] * { box-sizing: border-box; }

.ub-section {
  display: flex; flex-direction: column; gap: 12px;
  min-width: 0; max-width: 100%;
  color: ${TOKENS.labelPrimary}; font-family: inherit; font-variant-numeric: tabular-nums;
}

.ub-sub, .ub-muted { font-size: 12px; line-height: 1.6; color: ${TOKENS.labelTertiary}; }
.ub-estimate { color: ${TOKENS.warn}; font-size: 12px; }

/* ---------- 标题区 ---------- */
.ub-title-row { display: flex; align-items: baseline; gap: 8px; }
.ub-title { margin: 0; font-size: 18px; font-weight: 600; }
.ub-version {
  font-size: 12px; font-weight: 400; color: ${TOKENS.labelTertiary};
  font-variant-numeric: tabular-nums;
}
.ub-intro { margin: 0; font-size: 13px; line-height: 1.6; color: ${TOKENS.labelTertiary}; }

.ub-head { display: flex; align-items: center; gap: 8px; }
.ub-head-title { font-size: 14px; font-weight: 600; }
.ub-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ub-head .ub-toolbar { margin-left: auto; }

/* ---------- 卡片 ---------- */
.ub-card {
  display: flex; flex-direction: column; gap: 10px;
  padding: 14px 16px;
  border: 0.5px solid ${TOKENS.borderL4};
  border-radius: 14px;
  background: ${TOKENS.bgModule};
}
.ub-card-head { display: flex; align-items: baseline; gap: 8px; }
.ub-card-title { font-size: 14px; font-weight: 600; }
.ub-card-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.ub-card-flat { background: ${TOKENS.bgLayer2}; }

/* 开关行 / 说明行：左文案右控件。 */
.ub-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.ub-row-copy { display: grid; gap: 4px; min-width: 0; }
.ub-row-title { font-size: 14px; font-weight: 600; }
.ub-row-desc { margin: 0; font-size: 12.5px; line-height: 1.55; color: ${TOKENS.labelTertiary}; }

/* 表单行：标签 + 控件（标签在行内，控件自然宽度）。 */
.ub-field { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ub-field-label { font-size: 13px; color: ${TOKENS.labelSecondary}; }
.ub-field-note { font-size: 12px; color: ${TOKENS.labelTertiary}; }
/* 只给显式加了 .ub-input-sm 的输入定宽：裸的 .ub-field input 选择器会连 Input 原语内部的
   <input> 一起压窄（原语的权重更低），搜索框和复选框会被连带压成一条。 */
.ub-input-sm { width: 96px; }
.ub-input-md { width: 220px; }

/* ---------- 页签 ---------- */
.ub-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

/* ---------- 统计卡 ---------- */
.ub-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.ub-stat {
  display: grid; gap: 2px; padding: 12px 14px;
  border: 0.5px solid ${TOKENS.borderL4}; border-radius: 12px;
  background: ${TOKENS.bgLayer2};
}
.ub-stat-label { font-size: 12px; color: ${TOKENS.labelTertiary}; }
.ub-stat-value {
  font-size: 19px; font-weight: 600; letter-spacing: -0.01em;
  color: ${TOKENS.labelPrimary}; font-variant-numeric: tabular-nums;
}
.ub-stat-hint { font-size: 11.5px; color: ${TOKENS.labelTertiary}; }
.ub-hero {
  font-size: 34px; font-weight: 700; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

/* ---------- 预算进度条 ---------- */
.ub-bar {
  display: block; width: 100%; height: 8px; overflow: hidden;
  border-radius: 999px; background: ${TOKENS.bgLayer2};
}
.ub-bar > i {
  display: block; height: 100%; border-radius: 999px;
  background: ${TOKENS.business};
  transition: width 180ms ease, background 180ms ease;
}
.ub-bar[data-level='warn'] > i { background: ${TOKENS.warn}; }
.ub-bar[data-level='over'] > i { background: ${TOKENS.error}; }
.ub-bar[data-thin='true'] { height: 4px; }
.ub-bar-meta {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 11.5px; color: ${TOKENS.labelTertiary};
}

/* ---------- 表格（primitives 里没有 Table 原语，这里是本插件的唯一实现） ---------- */
.ub-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ub-table th {
  padding: 6px 10px; text-align: left; font-weight: 500; white-space: nowrap;
  color: ${TOKENS.labelTertiary}; border-bottom: 0.5px solid ${TOKENS.borderL4};
}
.ub-table td {
  padding: 7px 10px; vertical-align: top; color: ${TOKENS.labelPrimary};
  border-bottom: 0.5px solid ${TOKENS.borderL4};
}
.ub-table tbody tr:last-child td { border-bottom: none; }
.ub-table tbody tr:hover td { background: ${TOKENS.bgHover}; }
.ub-table .ub-num { text-align: right; font-variant-numeric: tabular-nums; }
.ub-table .ub-cell-main { font-weight: 500; }
.ub-table-empty { padding: 24px; text-align: center; color: ${TOKENS.labelTertiary}; font-size: 12.5px; }
.ub-table-wrap { overflow-x: auto; }
.ub-table-wrap .ub-table { min-width: 520px; }

/* ---------- 列表（工作区 → 会话下钻） ---------- */
.ub-list { display: flex; flex-direction: column; gap: 6px; }
.ub-item {
  border: 0.5px solid ${TOKENS.borderL4}; border-radius: 10px;
  background: ${TOKENS.bgModule}; overflow: hidden;
}
.ub-item-head {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 9px 12px; border: none; background: transparent; font: inherit;
  color: ${TOKENS.labelPrimary}; text-align: left; cursor: pointer;
}
.ub-item-head:hover { background: ${TOKENS.bgHover}; }
.ub-item-title {
  flex: 1 1 auto; min-width: 0; font-size: 12.5px; font-weight: 500;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ub-item-meta { font-size: 11.5px; color: ${TOKENS.labelTertiary}; white-space: nowrap; }
.ub-item-actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.ub-item-body {
  display: flex; flex-direction: column; gap: 4px;
  padding: 8px 12px 10px 26px; border-top: 0.5px solid ${TOKENS.borderL4};
}
.ub-item-body-line { font-size: 12px; color: ${TOKENS.labelSecondary}; }

/* ---------- 提示条 ---------- */
.ub-notice {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px; font-size: 12.5px; line-height: 1.6;
  border: 0.5px solid ${TOKENS.borderL4}; border-radius: 12px;
  background: ${TOKENS.bgModule}; color: ${TOKENS.labelSecondary};
}
.ub-notice-foot { display: flex; justify-content: flex-end; gap: 6px; }
/* 未收录 / 未计价：不写成 ¥0.00，而是明确说「未收录」。 */
.ub-unpriced { color: ${TOKENS.warn}; }
.ub-danger { color: ${TOKENS.error}; }

/* 检测到跨档/回填这类需要「看一眼」的提示：左侧一道色条，比整块染色克制。 */
.ub-notice[data-kind='warn'] { border-left: 3px solid ${TOKENS.warn}; }
.ub-notice[data-kind='error'] { border-left: 3px solid ${TOKENS.error}; }
.ub-notice[data-kind='info'] { border-left: 3px solid ${TOKENS.business}; }

.ub-empty {
  padding: 28px 16px; text-align: center;
  color: ${TOKENS.labelTertiary}; font-size: 12.5px;
}

/* ---------- 热力图 ---------- */
/*
 * 日历热力图：7 行 = 一周 7 天，1 列 = 一周。只写 grid-auto-flow: column 而没给
 * grid-template-rows 时，隐式网格只有一行 —— 整个日历会摊成一条横线（踩过）。
 * （注意：这段注释在模板字面量里，一个反引号就会把 CSS 从中间截断。）
 * matrix.flat() 是「按周优先」展开的，正好和列填充顺序一致。
 */
.ub-heat {
  display: grid; grid-template-rows: repeat(7, 10px); grid-auto-flow: column;
  grid-auto-columns: 10px; gap: 2px; overflow-x: auto; padding-bottom: 2px;
}
.ub-heat > span { width: 10px; height: 10px; border-radius: 2px; background: ${TOKENS.bgLayer2}; }
.ub-heat > span[data-level='1'] {
  background: color-mix(in srgb, ${TOKENS.business} 25%, ${TOKENS.bgLayer2});
}
.ub-heat > span[data-level='2'] {
  background: color-mix(in srgb, ${TOKENS.business} 45%, ${TOKENS.bgLayer2});
}
.ub-heat > span[data-level='3'] {
  background: color-mix(in srgb, ${TOKENS.business} 70%, ${TOKENS.bgLayer2});
}
.ub-heat > span[data-level='4'] { background: ${TOKENS.business}; }

/* ---------- 图表 ---------- */
.ub-chart { width: 100%; min-height: 180px; }
.ub-chart-fallback { min-height: 180px; display: flex; align-items: center; justify-content: center; }

/* ---------- 弹窗（portal 到 body） ---------- */
[role='dialog'].ub-modal { width: min(1040px, 94vw); max-height: 88vh; }
.ub-modal-content { overflow: auto; }

/* ---------- 别名行 ---------- */
.ub-alias-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 6px 0; border-bottom: 0.5px solid ${TOKENS.borderL4};
}
.ub-alias-row:last-child { border-bottom: none; }
.ub-alias-text { font-size: 12.5px; color: ${TOKENS.labelSecondary}; word-break: break-all; }
.ub-item-body-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }

/* 裸 select 必须自己受控：宿主没有 select 原语，这里只给它一条与 Input 同高的外观。 */
.ub-select {
  padding: 4px 8px; border: 0.5px solid ${TOKENS.borderL4}; border-radius: 8px;
  background: ${TOKENS.bgModule}; color: ${TOKENS.labelPrimary}; font: inherit; font-size: 12.5px;
}
.ub-tag-inline { margin-left: 6px; }

/* ---------- 侧栏入口卡 ---------- */
.ub-entry {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border: none; border-radius: 8px; background: transparent;
  color: ${TOKENS.labelSecondary}; cursor: pointer; text-align: left; font: inherit;
}
.ub-entry:hover { background: ${TOKENS.bgHover}; color: ${TOKENS.labelPrimary}; }
.ub-entry[data-wide='false'] { justify-content: center; width: 36px; height: 36px; padding: 0; }
.ub-entry[data-wide='false'] .ub-entry-text { display: none; }
.ub-entry-text { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; }
.ub-entry-line { display: flex; align-items: baseline; gap: 6px; }
.ub-entry-amount {
  font-size: 13px; font-weight: 600; color: ${TOKENS.labelPrimary};
  font-variant-numeric: tabular-nums;
}
.ub-entry-today {
  font-size: 11px; color: ${TOKENS.labelTertiary};
  font-variant-numeric: tabular-nums;
}
.ub-entry-budget { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ub-entry-budget .ub-bar { flex: 1 1 auto; min-width: 24px; }
.ub-entry-pct {
  flex: none; font-size: 10.5px; color: ${TOKENS.labelTertiary};
  font-variant-numeric: tabular-nums;
}
.ub-entry-icon { flex: none; display: inline-flex; align-items: center; color: ${TOKENS.brand}; }
.ub-badge { flex: none; font-size: 10px; color: ${TOKENS.error}; }
`

/**
 * 注入样式（按 fiber 幂等；无 DOM 环境时 no-op，便于在 node 里跑测试）。
 *
 * 追加走 `ctx.effect`：fiber stop / 重新 apply 时节点随 fiber 一起回收，
 * 不再有「模块级 installed 把节点留到进程结束」的泄漏。
 */
export function ensureUsageBillingStyle(ctx: Context): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => {
    const el = document.createElement('style')
    el.setAttribute('data-dsh-usage-billing-style', '')
    el.textContent = CSS
    document.head.appendChild(el)
    return () => { el.remove() }
  })
}
