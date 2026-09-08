/**
 * plugin-daily-log × agent harness 桥（host 侧）—— 对话式生成报告的模型引导。
 * 三段软性约束：总则 / 收集礼仪 / 生成礼仪（无阶段状态机，靠提示 + 工具条件）。
 */

import type { Context } from '@deepseek-ai/cordis'

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

export function installDailyLogReferencePrompt(ctx: Context): void {
  ctx.systemPrompt.section({
    name: DAILY_LOG_REFERENCE_SECTION,
    order: 2950,
    text: DAILY_LOG_REFERENCE_TEXT,
  })
}
