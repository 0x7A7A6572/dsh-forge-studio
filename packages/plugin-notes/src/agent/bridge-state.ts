/**
 * plugin-notes × agent 桥的装配状态（host 侧一等状态）。
 *
 * 起因：旧实现里工具注册失败只有一行 logger.warn，会话侧没有任何可见信号，
 * 而 note:// 引用提示照常挂载——“便签以 notes_* 工具暴露”变成空头支票：
 * 执行会话按提示调用 notes_get 只会撞 unknown tool（泳道任务执行协议全线失败，
 * 即「工具注册好像有问题」bug）。现在把桥接结果提为显式状态机
 * `waiting → installed | failed`（一次装配只单向迁移一次），并约定：
 * - ctx.notes.getAgentBridgeState() 同步直读（host 侧任何代码/测试可取）；同
 *   一快照经 `notes/getAgentBridgeState` 远端端点透出给 client（后续 UI 消费点，
 *   如便签板状态条/帮助弹窗，可直接渲染，无需再改 host）；
 * - index.ts 的桥装配器只在 installed 之后挂载引用提示；failed 时不挂——agent
 *   不再被告知“存在 notes_* 工具却调不到”，避免再次误导执行会话。
 *
 * 纯数据模块：不依赖 cordis / dsh 服务，host、client 镜像、单测均可安全引用。
 */
export type NotesAgentBridgeWaiting = {
  /** tools 服务尚未就绪（纯 UI 宿主可能永远停在这一态）。 */
  readonly status: 'waiting'
}

export type NotesAgentBridgeInstalled = {
  /** 8 个 notes_* 工具已注册进 ctx.tools（引用提示随之挂载）。 */
  readonly status: 'installed'
  /** 注册完成的时间戳（ms）。 */
  readonly at: number
}

export type NotesAgentBridgeFailed = {
  /** 工具注册抛错，notes_* 对会话不可用（引用提示不会挂载）。 */
  readonly status: 'failed'
  /** 失败时间戳（ms）。 */
  readonly at: number
  /** 人类可读原因（原 error 的 message）。 */
  readonly reason: string
}

/** tools 服务就绪后的两种收束态。 */
export type NotesAgentBridgeSettled = NotesAgentBridgeInstalled | NotesAgentBridgeFailed

/** 完整桥状态（含等待态）。 */
export type NotesAgentBridgeState = NotesAgentBridgeWaiting | NotesAgentBridgeSettled

/** 状态字面量枚举（client 镜像/日志引用用）。 */
export const NOTES_BRIDGE_STATUSES = ['waiting', 'installed', 'failed'] as const
export type NotesBridgeStatus = (typeof NOTES_BRIDGE_STATUSES)[number]

export function bridgeWaiting(): NotesAgentBridgeWaiting {
  return { status: 'waiting' }
}

export function bridgeInstalled(at: number = Date.now()): NotesAgentBridgeInstalled {
  return { status: 'installed', at }
}

export function bridgeFailed(reason: string, at: number = Date.now()): NotesAgentBridgeFailed {
  return { status: 'failed', at, reason }
}

/** 把任意 thrown value 归一为状态可存的 reason 文案。 */
export function bridgeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
