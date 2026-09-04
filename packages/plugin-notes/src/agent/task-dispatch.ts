/**
 * 任务执行投递薄层（host 侧）：把「泳道卡执行」接成对承载便签板会话的一次 prompt
 * 投递（spec §8 缝 1：host 侧 ctx.sessionController）。
 *
 * 投递通道 = `SessionController.prompt(request, signal)`（宿主装配的会话控制器，
 * cordis key `sessionController`，与 web 会话 UI 同款通道）。queue 语义：mode='queue'
 * → `agent.followup(message)`（会话忙时排队追加一个 turn）；mode='steer' → 打断当前
 * turn（默认不用，对齐 spec §8「默认选普通排队」）。投递失败（无目标会话 / 不可达 /
 * 会话忙）由 taskExecute 捕获并回滚（见 service.ts）。
 *
 * 时序（关键）：sessionController 是重服务（依赖 agents/sessions/typert 等），宿主装配
 * service-availability 驱动、几乎必然晚于本插件 apply——故 dispatch 闭包在调用时（用户
 * 点「执行」）才惰性解析 `ctx.get('sessionController')`，避免 apply 时一次性判存漏挂
 * （同 tools 桥教训，见 index.ts 头注释）。宿主从不装配 sessionController 时，闭包在调用
 * 时抛错 → taskExecute 回滚并返回 dispatch-failed（UI 侧给提示，Task 7）。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
// 仅类型导入（build 时擦除，不进 bundle）：加载 cordis Context 增广（ctx.sessionController）
// 与 prompt 请求形状；SessionId 通过 SessionPromptRequest['sessionId'] 取型，免直接 import。
import type { SessionPromptRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type { NotesServiceConfig } from '../service.ts'
import type { NoteId } from '../types.ts'
import { formatNoteMention } from '../types.ts'

/** 投递消息模板（spec §8 / M5）：agent-readable，mention 复用 formatNoteMention。 */
export function buildTaskDispatchMessage(input: { readonly noteId: NoteId; readonly title: string }): string {
  const mention = formatNoteMention(input.noteId, input.title)
  return [
    `【任务执行】请执行便签 ${mention} 中描述的任务。`,
    '步骤：1) notes_get 读全文（含 lane.run.summary 上次结论，如有）；2) 若未 running，notes_task_set_status 置 running；',
    '3) 执行；4) 收尾 notes_task_report：成功 ok=true + 摘要，失败 ok=false + 原因。',
    '只允许操作该任务的 lane 状态与结果，不得修改正文/标题/颜色。',
  ].join('\n')
}

/**
 * 装配 taskExecute 的 dispatch 回调（host 侧）。返回的闭包在调用时惰性解析
 * sessionController 并投递；任何抛错（无 sessionController / prompt 拒绝）都由
 * taskExecute 捕获 → 回滚 + dispatch-failed。
 */
export function installTaskDispatch(ctx: Context): NotesServiceConfig['dispatch'] {
  return async (input) => {
    const sessionController = ctx.get('sessionController')
    if (sessionController === undefined) {
      throw new Error('sessionController 不可用：宿主未装配会话控制器，任务执行无法投递')
    }
    const request: SessionPromptRequest = {
      requestId: randomUUID() as SessionRequestId,
      sessionId: input.sessionId as SessionPromptRequest['sessionId'],
      mode: 'queue',
      content: [{ type: 'text', text: buildTaskDispatchMessage({ noteId: input.noteId, title: input.title }) }],
    }
    await sessionController.prompt(request, new AbortController().signal)
  }
}
