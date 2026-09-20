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

import type { Context } from "@deepseek-ai/cordis";

// 样式正文在 ui-css.css（真 CSS 文件，编辑器有高亮/补全；`?inline` 查询返回
// 编译后的 CSS 文本且不自动注入，语义等价于原先 esbuild 的 text loader）。
import CSS from './ui-css.css?inline';

/**
 * 注入样式（按 fiber 幂等；无 DOM 环境时 no-op，便于在 node 里跑测试）。
 *
 * 追加走 `ctx.effect`：fiber stop / 重新 apply 时节点随 fiber 一起回收，
 * 不再有「模块级 installed 把节点留到进程结束」的泄漏。
 */
export function ensureUsageBillingStyle(ctx: Context): void {
  if (typeof document === "undefined") return;
  ctx.effect(() => {
    const el = document.createElement("style");
    el.setAttribute("data-dsh-usage-billing-style", "");
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  });
}
