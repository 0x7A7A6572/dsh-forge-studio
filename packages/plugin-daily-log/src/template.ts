/**
 * 报告模板：LLM 引导语义（取代旧 mustache 渲染）。
 * 模板 = 可选「指令段」+ DATA_MARKER + 「骨架段」；解析结果喂给生成阶段 LLM。
 * 纯函数模块：host 与 client 双侧都可 import。
 */

import type { DateRange } from './types.ts'

/** 指令段 / 骨架段分隔标记。 */
export const DATA_MARKER = '<!-- DATA -->'

export interface TemplateParts {
  /** 分隔线上方的指令段；无分隔线时为 null。 */
  promptSection: string | null
  /** 骨架段（无分隔线时 = 全文 trim）。 */
  skeletonSection: string
}

/** 解析模板内容：按 DATA_MARKER 拆指令段与骨架段。 */
export function parseTemplate(content: string): TemplateParts {
  const idx = content.indexOf(DATA_MARKER)
  if (idx === -1) return { promptSection: null, skeletonSection: content.trim() }
  return {
    promptSection: content.slice(0, idx).trim() || null,
    skeletonSection: content.slice(idx + DATA_MARKER.length).trim(),
  }
}

/** GUI 两段编辑保存：指令段（可空）与骨架段拼回一个 content。 */
export function joinTemplate(promptSection: string | null, skeletonSection: string): string {
  const skel = skeletonSection.trim()
  const prompt = promptSection?.trim()
  if (!prompt) return skel
  return prompt + '\n' + DATA_MARKER + '\n' + skel
}

/** 日期范围展示串。 */
export function formatDateRange(range: DateRange): string {
  return range.until ? range.since + ' ~ ' + range.until : range.since
}

/** 内置默认模板：五节业务骨架（LLM 按此撰写正文；无 mustache）。 */
export const DEFAULT_TEMPLATE_SKELETON = '# {类型} — {日期范围}\n' +
  '\n## 核心产出\n' +
  '\n<!-- 归类：feat/新增 类成果与功能交付；同功能多次提交合并为一条业务描述 -->\n' +
  '\n## 问题修复\n' +
  '\n<!-- 归类：fix 类修复，说明问题与影响 -->\n' +
  '\n## 技术优化\n' +
  '\n<!-- 归类：refactor/perf 类改进 -->\n' +
  '\n## 其他工作\n' +
  '\n<!-- 用户补充的隐性工作：协助、会议、未落进提交/会话的活动 -->\n' +
  '\n## 下一步计划\n' +
  '\n<!-- 依据当前进度推断，需用户确认 -->\n'
