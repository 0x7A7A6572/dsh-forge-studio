/**
 * 「复制到 AI 助手生成」用的提示词。
 *
 * 主题接口是给**别的 AI** 用的：用户不该为了写一个主题先去读 types。这段提示词把
 * 「文件放哪里、你会拿到什么数据、哪些事不许自己干」一次交代清楚，只留一句「画成什么样」
 * 要用户自己写。
 *
 * 那句「画成什么样」**没有默认值，也不该有**：默认句会让 AI 朝一个猜的方向走，而主题是
 * 审美 —— 猜不对就是白干一整个主题。所以 `themePrompt` 直接拒绝空输入（设置页那个
 * 灰按钮是同一件事的另一道守卫，两层都要有：UI 会被绕过，函数不会）。
 *
 * 提示词里点名的每个字段都必须在契约里真实存在 —— `scripts/theme-prompt.spec.ts`
 * 会拿 `THEME_PROMPT_TOKENS` 去契约源码里逐个核对。改契约而忘了改这里，测试会红。
 */

/**
 * 提示词承诺给 AI 的契约符号（字段名 / 类型名 / 方法名）。
 *
 * 这份清单的**唯一用途**是给门禁做交叉核对：提示词里说的东西，契约里必须真的有。
 * 所以它只收「契约源码里应该出现的标识符」，提示词里的路径与文件名（`index.tsx` /
 * `styles.css` 之类）不收 —— 那些去契约里找不到，收进来只会让门禁变成噪声。
 */
export const THEME_PROMPT_TOKENS: readonly string[] = [
  'ThemeProps',
  'TierShapeData',
  'TierEntryView',
  'TierEntryProgress',
  'TierEntryBand',
  'minute',
  'tone',
  'peakWindows',
  'workday',
  'wide',
  'monthText',
  'todayText',
  'failed',
  'unpricedText',
  'showTier',
  'progress',
  'toneAtMinute',
  'clockText',
  'BUILTIN_THEME_ID',
  'THEME_ALLOWED_MODULES',
]

/**
 * 拼出完整的提示词。`idea` 是用户写的「画成什么样」。
 *
 * 空（或只有空白）时抛错：宁可让调用点炸掉，也不要悄悄生成一份没有方向的提示词 ——
 * 那会让 AI 自由发挥出一整个不合用的主题，代价比一个异常大得多。
 */
export function themePrompt(idea: string): string {
  const want = idea.trim()
  if (want === '') throw new Error('themePrompt: 「画成什么样」不能为空')

  return `我在用 dsh（DeepSeek Harness），装了 @zzerx/dsh-plugin-usage-billing。它把「侧栏计费入口
那一整块」的显示交给一个主题文件画（峰谷、金额、今日、预算条全由主题画），宿主只保留外壳：
那个可点的 button、无障碍名、popup 的锚点。

请为它写一个新的主题文件。

## 你要产出什么

一个文件：$DSH_HOME/themes/usage-billing/<id>/index.tsx（<id> 用小写字母/数字/连字符）。
放进去、刷新页面就会出现，不需要改任何配置、不需要 build、不需要注册插件。
可选再放一个 styles.css（普通 CSS，全局作用域，类名请自己带前缀）。

内置那张卡是同一个接口的另一个实现，它的 id 是 BUILTIN_THEME_ID（设置里默认选它）——
你的主题与它平级，替换掉它就是替换掉侧栏那一整块。

## 文件长这样

import { useState } from 'react'
import type { ThemeProps } from '@zzerx/dsh-plugin-usage-billing/shape'
import { toneAtMinute } from '@zzerx/dsh-plugin-usage-billing/shape'

export const theme = {
  label: '设置页下拉里显示的名字',
  component: (props: ThemeProps) => { … },
}

## 你能 import 什么

只有 THEME_ALLOWED_MODULES 里那几个（react / react/jsx-runtime /
@deepseek-ai/dsh-client-ui-primitives / 契约子路径），外加主题目录内的相对文件。
别的一律转译期报错，错误会显示在 设置 → 用量计费 → 显示。

## 你会拿到的数据（ThemeProps）

data: TierShapeData | null   // null = 没有分时价口径
  workday        今天是不是工作日
  peakWindows    高峰时段 [[起, 止), …]，左闭右开，单位是「当日分钟」
  minute         此刻（当日分钟）—— 宿主每分钟推进，别自己开时钟
  tone           此刻档位 'peak' | 'offPeak' —— 别自己判档
view: TierEntryView
  wide           侧栏是不是宽态。false = 36px 的 rail，那种宽度只放得下一个饼图
  monthText      本月已用（已格式化，含货币符号）
  todayText      今日已用（已格式化）
  failed         数据读取失败 —— 要把它说出来
  unpricedText   没有定价口径时的提示文案；null = 一切正常
  showTier       用户「显示峰谷时段图」那个开关（可选遵从，不是硬要求）
  progress       TierEntryProgress | null（null = 没设预算，不该画进度条）
    ratio        已用 / 上限，**可能大于 1**（超支），要画得下溢出
    level        'ok' | 'warn' | 'over'
    spentText    已用金额（已格式化）
    limitText    预算上限（已格式化）
    bands        TierEntryBand[]：已用段的构成，按数组顺序画，每项 { key: 'session' | 'workspace' | 'today', ratio }

要把 minute 写成 HH:MM 就用契约里的 clockText(minute)。

## 两条不许破的规则

1. 不要自己开时钟：用 props.data.minute，宿主每分钟推进。
2. 不要自己判档：读 props.data.tone；要判别的时刻用契约的 toneAtMinute ——
   判档只有那一份实现，两边各判一遍迟早会错开一分钟。

## 画成什么样
${want}
`
}
