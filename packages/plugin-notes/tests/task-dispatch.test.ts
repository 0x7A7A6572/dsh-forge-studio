/**
 * 投递消息模板契约测试（spec §8 / M5）：agent-readable 执行协议。
 * mention 复用 formatNoteMention；模板文本逐字锁定，改动须同步 spec。
 */

import { describe, expect, it } from 'vitest'
import { buildTaskDispatchMessage } from '../src/agent/task-dispatch.ts'
import { formatNoteMention } from '../src/types.ts'
import type { NoteId } from '../src/types.ts'

describe('task dispatch 消息模板', () => {
  it('模板含 mention 与执行协议（M5），逐字匹配', () => {
    const id = 'abc-123' as NoteId
    const msg = buildTaskDispatchMessage({ noteId: id, title: '买菜' })
    const expected = [
      `【任务执行】请执行便签 ${formatNoteMention(id, '买菜')} 中描述的任务。`,
      '步骤：1) notes_get 读全文（含 lane.run.summary 上次结论，如有）；2) 若未 running，notes_task_set_status 置 running；',
      '3) 执行；4) 收尾 notes_task_report：成功 ok=true + 摘要，失败 ok=false + 原因。',
      '只允许操作该任务的 lane 状态与结果，不得修改正文/标题/颜色。',
    ].join('\n')
    expect(msg).toBe(expected)
  })
})
