/**
 * 「复制到 AI 助手生成」用的提示词。
 *
 * 形状接口是给**别的 AI** 用的：用户不该为了写一个形状先去读 types。这段提示词把
 * 「你会拿到什么数据、怎么注册、哪些事不许自己干」一次交代清楚，只留一句「画成什么样」
 * 要用户自己写。
 *
 * 那句「画成什么样」**没有默认值，也不该有**：默认句会让 AI 朝一个猜的方向走，而形状是
 * 审美 —— 猜不对就是白干一整个包。所以 `tierShapePrompt` 直接拒绝空输入（设置页那个
 * 灰按钮是同一件事的另一道守卫，两层都要有：UI 会被绕过，函数不会）。
 *
 * 提示词里点名的每个字段都必须在契约里真实存在 —— `scripts/tier-shape-prompt.spec.ts`
 * 会拿 `TIER_SHAPE_PROMPT_TOKENS` 去契约源码里逐个核对。改契约而忘了改这里，测试会红。
 */

/**
 * 提示词承诺给 AI 的契约符号（字段名 / 类型名 / 方法名）。
 *
 * 这份清单的**唯一用途**是给门禁做交叉核对：提示词里说的东西，契约里必须真的有。
 * 所以它只收「契约源码里应该出现的标识符」，cordis 自己的词汇（`inject` 之类）不收 ——
 * 那些去契约里找不到，收进来只会让门禁变成噪声。
 */
export const TIER_SHAPE_PROMPT_TOKENS: readonly string[] = [
  'TierShapeProps',
  'TierShapeData',
  'TierEntryView',
  'workday',
  'peakWindows',
  'minute',
  'tone',
  'peak',
  'offPeak',
  'wide',
  'monthText',
  'todayText',
  'failed',
  'unpricedText',
  'showTier',
  'progress',
  'ratio',
  'level',
  'ok',
  'warn',
  'over',
  'spentText',
  'limitText',
  'bands',
  'key',
  'session',
  'workspace',
  'today',
  'TierShapeRegistry',
  'TIER_SHAPE_SERVICE',
  'usageBillingTierShape',
  'register',
  'component',
  'id',
  'label',
  'toneAtMinute',
]

/**
 * 拼出完整的提示词。`idea` 是用户写的「画成什么样」。
 *
 * 空（或只有空白）时抛错：宁可让调用点炸掉，也不要悄悄生成一份没有方向的提示词 ——
 * 那会让 AI 自由发挥出一整个不合用的插件包，代价比一个异常大得多。
 */
export function tierShapePrompt(idea: string): string {
  const want = idea.trim()
  if (want === '') throw new Error('tierShapePrompt: 「画成什么样」不能为空')

  return `我在用 dsh（DeepSeek Harness），装了 @zzerx/dsh-plugin-usage-billing。它把「侧栏计费入口
那一整块」的显示交给形状插件画（峰谷、金额、今日、预算条全由形状画），宿主只保留外壳：
那个可点的 button、无障碍名、popup 的锚点。

请为它写一个新的形状插件包。

## 先读这两个文件（唯一权威，别按记忆写）
- packages/plugin-tier-shape-api/src/index.ts —— 契约：类型、注册表、判档函数都在这里
- packages/plugin-usage-billing/src/client/shapes/builtin-entry.tsx —— 内置形状，照它的写法

## 你会拿到的数据（TierShapeProps）
  data: TierShapeData | null  // null = 没有分时价口径。这时只画金额与进度，别编一个模板出来
    workday: boolean          // 规则时区下今天算不算工作日
    peakWindows: readonly (readonly [number, number])[]  // 高峰窗口，规则时区当日分钟，左闭右开
    minute: number            // 此刻（0..1439），宿主每分钟注入
    tone: 'peak' | 'offPeak'  // 此刻档位，宿主已判好
  view: TierEntryView
    wide: boolean             // false = 收成 36px 的 rail，这时只放得下一个图标
    monthText: string         // 已格式化好的金额（含货币符号）
    todayText: string
    failed: boolean           // 数据读取失败
    unpricedText: string | null
    showTier: boolean         // 用户的「显示峰谷图」偏好，可选遵从
    progress: {               // null = 没开预算
      ratio: number           // 已用/上限。超支时 > 1，不夹
      level: 'ok' | 'warn' | 'over'
      spentText: string       // 已用，与 monthText 同源
      limitText: string       // 预算上限
      bands: { key: 'session' | 'workspace' | 'today'; ratio: number }[]  // ratio 之和 ≤ 1，0 比例的段不出现
    } | null

## 注册方式
  import { TIER_SHAPE_SERVICE } from '@zzerx/dsh-plugin-tier-shape-api'
  import type { TierShapeRegistry } from '@zzerx/dsh-plugin-tier-shape-api'

  export const inject = [TIER_SHAPE_SERVICE]
  export function apply(ctx: Context): void {
    ctx.usageBillingTierShape.register({ id: '你的形状 id', label: '设置页里显示的名字', component: MyShape })
  }

## 硬性要求
1. 按仓库 CLAUDE.md：新建 packages/plugin-<name>/，包名 @zzerx/dsh-plugin-<name>，一个功能一个包。
2. 不要自己开时钟：用 data.minute，宿主每分钟重渲染你。
3. 不要自己判档：读 data.tone；要判别的时刻用契约的 toneAtMinute(peakWindows, minute)。
4. 只 import 契约包，不要 import usage-billing 的内部模块（跨插件值引用会被构建门禁拒掉）。
5. 不新增运行时依赖；要加先说明理由。
6. 做完跑 pnpm check（lint → build → typecheck → test），必须全绿再交。

## 画成什么样
${want}
`
}
