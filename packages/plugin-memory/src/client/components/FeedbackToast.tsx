/**
 * 分区里所有操作反馈的唯一出口（成功与失败都从这里冒出来）。
 *
 * 反馈不能写在分区正文里：弹窗是 body portal，盖在正文之上，弹窗里
 * （新增记忆 / 新建实体 / 新增关联）的失败写在正文就是「点了没反应」。
 */
import { IconWarningOutline16, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Feedback } from '../core/memory-section-types.ts'

/** 停留时长跟字数走：短提示 3 秒够看，导入结果那种长句要多留一会儿。 */
function holdMsFor(text: string): number {
  return Math.min(7000, 3000 + Math.max(0, text.length - 12) * 120)
}

/** 当前这一条反馈；没有就不画东西。 */
export function FeedbackToast(props: { feedback: Feedback | null; onDone: () => void }): JSX.Element | null {
  if (props.feedback === null) return null
  return (
    <Toast
      key={props.feedback.seq}
      text={props.feedback.text}
      holdMs={holdMsFor(props.feedback.text)}
      icon={props.feedback.tone === 'error' ? <IconWarningOutline16 size={14} /> : undefined}
      onDone={props.onDone}
    />
  )
}
