/**
 * plugin-daily-log × agent harness 桥（host 侧）—— 对话式生成报告的模型引导。
 * 三段软性约束：总则 / 收集礼仪 / 生成礼仪（无阶段状态机，靠提示 + 工具条件）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentScopeContext } from './tool-gate.ts'

export const DAILY_LOG_REFERENCE_SECTION = 'forge-daily-log:reporting'

/** 可测试的提示文本常量。 */
export const DAILY_LOG_REFERENCE_TEXT = [
  '## Daily work log (plugin-daily-log)',
  '',
  'Generate daily/weekly/monthly work reports conversationally from Git commits and local agent conversations',
  '(deepseek / claude / codex) via the daily_log_* tools.',
  '',
  '### 总则',
  '- data-driven：一切结论必须来自 daily_log_* 工具返回的真实数据，绝不编造或推测。',
  '- 诚实透明：空数据、工具失败如实告知，不用默认值掩盖。',
  '- 中文交流；报告用业务语言，不用代码流水账。',
  '',
  '### 收集（扫描前）',
  '- 先确认时间范围与项目集（daily_log_list_sources 查看已添加项目）；用户指令不完整时反问，不自行猜测。',
  '- 扫描结果为空/明显过少、提交信息过简（update/fix/wip 之类）→ 反问是否遗漏项目或范围有误。',
  '- 扫描后口头询问「是否有未提交/未完成/未体现在扫描结果里的工作（协助、会议、进行中会话等）」。',
  '',
  '### 生成（撰写正文）',
  '- 调用 daily_log_prepare_report 获取所选模板的指令/骨架引导，然后【你亲自撰写正文】。',
  '- 按骨架归类：feat/新增 → 核心产出；fix → 问题修复；refactor/perf → 技术优化；隐性工作 → 其他工作。',
  '- 同功能多次提交合并为一条业务描述。坏例：「修改了 user.ts 的 login 方法」；好例：「完成用户登录模块重构，提升可维护性」。',
  '- 写完先在回复中展示正文并询问是否调整；用户要求调整则按意见修改正文，改完再次询问；未经用户确认不得调用 daily_log_save_report / daily_log_export_report。',
].join('\n')

export const DAILY_LOG_POINTER_SECTION = 'forge-daily-log:reporting-entry'
export const DAILY_LOG_POINTER_ORDER = 2949

/** 常驻短指针：只说「按需启用」与触发方式，不点名任何具体工具。 */
export const DAILY_LOG_POINTER_TEXT = [
  '## 工作报告能力（plugin-daily-log）· 按需启用',
  '',
  '这项能力默认不加载，以免占用日常上下文。当用户要求生成日报 / 周报 / 月报、汇报「这段时间做了什么」、',
  '统计提交或整理工作内容时，先调用 daily_log 工具启用。',
  '启用后本轮即可使用全部工作报告工具，并会附带详细的工作流引导。',
].join('\n')

/** 把详细引导注册进 agent scope；宿主未装配 systemPrompt 时安静跳过。 */
export function registerDailyLogGuidance(scope: AgentScopeContext): () => void {
  if (scope.systemPrompt === undefined) return () => {}
  return scope.systemPrompt.section({
    name: DAILY_LOG_REFERENCE_SECTION,
    order: 2950,
    text: DAILY_LOG_REFERENCE_TEXT,
  })
}

/** 常驻短指针（全局，每轮都在；指针本身不含具体工具名）。 */
export function installDailyLogPointerPrompt(ctx: Context): void {
  ctx.systemPrompt.section({
    name: DAILY_LOG_POINTER_SECTION,
    order: DAILY_LOG_POINTER_ORDER,
    text: DAILY_LOG_POINTER_TEXT,
  })
}
