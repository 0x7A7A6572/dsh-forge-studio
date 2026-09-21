/**
 * 模板摘要：取骨架段的前几个章节标题（去掉 Markdown 标记）做卡片说明。
 */
import { parseTemplate } from '../../template.ts'

export function templateSummary(content: string): string {
  const parsed = parseTemplate(content)
  const lines = parsed.skeletonSection
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim())
    .filter((line) => line !== '')
  if (lines.length === 0) return '骨架段为空'
  const head = lines.slice(0, 4).join(' · ')
  return head.length > 96 ? head.slice(0, 96) + '…' : head
}
