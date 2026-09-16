/**
 * usage-billing 样式（按 fiber 注入，以 data 属性作用域）。
 * 配色只走宿主已声明的 10 个 --dsw-* 令牌，明暗自适应。
 */

import type { Context } from '@deepseek-ai/cordis'

export const TOKENS = {
  bgBase: 'var(--dsw-alias-bg-base)',
  bgLayer1: 'var(--dsw-alias-bg-layer-1)',
  bgLayer2: 'var(--dsw-alias-bg-layer-2)',
  bgOverlay: 'var(--dsw-alias-bg-overlay)',
  borderL1: 'var(--dsw-alias-border-l1)',
  brand: 'var(--dsw-alias-brand-primary)',
  labelPrimary: 'var(--dsw-alias-label-primary)',
  labelSecondary: 'var(--dsw-alias-label-secondary)',
  error: 'var(--dsw-alias-state-error-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
} as const

const CSS = `
[data-dsh-usage-billing] { box-sizing: border-box; font-variant-numeric: tabular-nums; }
[data-dsh-usage-billing] * { box-sizing: border-box; }
[data-dsh-ub-entry] {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border: none; border-radius: 8px; background: transparent;
  color: ${TOKENS.labelSecondary}; cursor: pointer; text-align: left; font: inherit;
}
[data-dsh-ub-entry]:hover { background: ${TOKENS.bgLayer2}; color: ${TOKENS.labelPrimary}; }
[data-dsh-ub-entry][data-wide="false"] { justify-content: center; width: 36px; height: 36px; padding: 0; }
[data-dsh-ub-entry][data-wide="false"] [data-dsh-ub-entry-text] { display: none; }
[data-dsh-ub-amount] { font-size: 13px; font-weight: 600; color: ${TOKENS.labelPrimary}; }
[data-dsh-ub-sub] { font-size: 11px; color: ${TOKENS.labelSecondary}; }
[data-dsh-ub-badge] {
  margin-left: auto; padding: 1px 5px; border-radius: 4px; font-size: 10px;
  background: ${TOKENS.bgLayer2}; color: ${TOKENS.labelSecondary};
}
[data-dsh-ub-badge][data-kind="warn"] { color: ${TOKENS.warn}; }
[data-dsh-ub-badge][data-kind="error"] { color: ${TOKENS.error}; }
[data-dsh-ub-overlay] {
  position: fixed; inset: 0; pointer-events: auto;              /* 浮层本身 click-through，这里 opt-in */
  background: color-mix(in srgb, ${TOKENS.bgBase} 72%, transparent);
  display: flex; align-items: center; justify-content: center; z-index: 60;
}
[data-dsh-ub-panel] {
  width: min(1040px, 92vw); max-height: 86vh; overflow: auto;
  background: ${TOKENS.bgOverlay}; color: ${TOKENS.labelPrimary};
  border: 1px solid ${TOKENS.borderL1}; border-radius: 12px; padding: 20px;
  box-shadow: 0 12px 40px rgb(0 0 0 / 32%);
}
[data-dsh-ub-hero] { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; }
[data-dsh-ub-kpis] { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
[data-dsh-ub-kpi] { padding: 10px; border: 1px solid ${TOKENS.borderL1}; border-radius: 8px; background: ${TOKENS.bgLayer1}; }
[data-dsh-ub-estimate] { color: ${TOKENS.warn}; font-size: 11px; }
[data-dsh-ub-bar] { height: 8px; border-radius: 4px; background: ${TOKENS.bgLayer2}; overflow: hidden; }
[data-dsh-ub-bar] > i { display: block; height: 100%; background: ${TOKENS.brand}; }
[data-dsh-ub-bar][data-level="warn"] > i { background: ${TOKENS.warn}; }
[data-dsh-ub-bar][data-level="over"] > i { background: ${TOKENS.error}; }
[data-dsh-ub-heat] { display: grid; grid-auto-flow: column; gap: 2px; }
[data-dsh-ub-heat] > span { width: 10px; height: 10px; border-radius: 2px; background: ${TOKENS.bgLayer2}; }
[data-dsh-ub-heat] > span[data-level="1"] { background: color-mix(in srgb, ${TOKENS.brand} 25%, ${TOKENS.bgLayer2}); }
[data-dsh-ub-heat] > span[data-level="2"] { background: color-mix(in srgb, ${TOKENS.brand} 45%, ${TOKENS.bgLayer2}); }
[data-dsh-ub-heat] > span[data-level="3"] { background: color-mix(in srgb, ${TOKENS.brand} 70%, ${TOKENS.bgLayer2}); }
[data-dsh-ub-heat] > span[data-level="4"] { background: ${TOKENS.brand}; }
[data-dsh-ub-tabs] { display: flex; gap: 4px; border-bottom: 1px solid ${TOKENS.borderL1}; margin-bottom: 14px; }
[data-dsh-ub-tabs] > button {
  padding: 6px 10px; background: transparent; border: none; border-bottom: 2px solid transparent;
  color: ${TOKENS.labelSecondary}; cursor: pointer; font: inherit;
}
[data-dsh-ub-tabs] > button[data-active] { color: ${TOKENS.labelPrimary}; border-bottom-color: ${TOKENS.brand}; }
[data-dsh-ub-empty] { color: ${TOKENS.labelSecondary}; padding: 24px; text-align: center; }
`

/**
 * 注入样式（按 fiber 幂等；无 DOM 环境时 no-op，便于在 node 里跑测试）。
 *
 * 追加走 `ctx.effect`：fiber stop / 重新 apply 时节点随 fiber 一起回收，
 * 不再有「模块级 `installed` 把节点留到进程结束」的泄漏。同进程并发 apply
 * 会各留一份（内容逐字相同，且各自由自己的 fiber 回收），这里的插件只 apply 一次。
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
