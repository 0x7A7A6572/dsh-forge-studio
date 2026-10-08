/**
 * 任务执行运行时：按工作区新建会话，再往新会话投一次 prompt。
 * sessionController 是晚挂的重服务，故调用时才惰性解析；租约绑定新会话 id。
 * 预设 / 模型必须在 prompt 之前落到新会话；工作区无默认值，本层不兜底。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
// type-only：载入 Context 增广（ctx.sessionController）与请求形状。
import type {
  ModelCatalog,
  SessionCreateRequest,
  SessionListRequest,
  SessionPromptRequest,
  SessionRequestId,
  SessionSelectModelRequest,
} from '@deepseek-ai/dsh-api-session-controller'
import type { NotesTaskRuntime } from '../service.ts'
import type { NoteId, TaskModelGroup, TaskTargets } from '../types.ts'

/** 工作区候选上限：会话列表按活动时间序，取最靠前的若干个。 */
export const WORKSPACE_CANDIDATE_LIMIT = 12

/** 只取「按路径反查工作区」的结构面：故意不 import 该包，缺席即降级。 */
interface WorkspaceLookup {
  resolveByPath(path: string): Promise<{ readonly id: string } | undefined>
}

/** agent 预设目录的结构面：同样不 import 该包，缺席时下拉只剩「宿主默认」。 */
interface PresetLookup {
  list(): Promise<readonly {
    readonly id: string
    readonly name?: string
    readonly broken?: string
  }[]>
}

export const TASK_DISPATCH_MARK = '⇲'

/** 首行必须只是「标记 + 标题」：会话列表只显示首行，据此区分会话。 */
export function buildTaskDispatchMessage(input: { readonly noteId: NoteId; readonly title: string }): string {
  const title = input.title || '无标题'
  return `${TASK_DISPATCH_MARK} ${title}\n\n【任务执行】请执行便签「${title}」（id: ${input.noteId}）中描述的任务。`
}

/** 本层抛错一律交 taskExecute 转成 dispatch-failed。 */
export function installTaskRuntime(ctx: Context): NotesTaskRuntime {
  const controller = () => {
    const sessionController = ctx.get('sessionController')
    if (sessionController === undefined) {
      throw new Error('sessionController 不可用：宿主未装配会话控制器，任务执行无法新建会话')
    }
    return sessionController
  }

  const resolveWorkspaceId = async (path: string): Promise<string | undefined> => {
    // ctx.get 不触发 inject 校验，服务缺席只返回 undefined。
    const registry = ctx.get('workspaceRegistry') as WorkspaceLookup | undefined
    if (registry === undefined) return undefined
    try {
      const workspace = await registry.resolveByPath(path)
      return workspace?.id
    } catch {
      return undefined
    }
  }

  /** 失败降级空数组，不抛：没有候选不是错误。 */
  const listWorkspaces = async (): Promise<readonly string[]> => {
    const sessionController = ctx.get('sessionController')
    if (sessionController === undefined) return []
    try {
      const request: SessionListRequest = {}
      const value = await sessionController.list(request, new AbortController().signal)
      const seen = new Set<string>()
      const workspaces: string[] = []
      for (const item of value.items) {
        const cwd = item.cwd?.trim()
        if (cwd === undefined || cwd === '' || seen.has(cwd)) continue
        seen.add(cwd)
        workspaces.push(cwd)
        if (workspaces.length >= WORKSPACE_CANDIDATE_LIMIT) break
      }
      return workspaces
    } catch {
      return []
    }
  }

  return {
    /** 优先 workspaceId（会话才归组）；本层不碰文件系统，路径由宿主解析。 */
    async createSession(input) {
      const workspaceId = await resolveWorkspaceId(input.workspace)
      const request: SessionCreateRequest = {
        ...(workspaceId !== undefined
          ? { workspaceId: workspaceId as NonNullable<SessionCreateRequest['workspaceId']> }
          : { cwd: input.workspace }),
        ...(input.agentPreset !== undefined ? { agentPreset: input.agentPreset } : {}),
      }
      const created = await controller().create(request)
      return String(created.sessionId)
    },
    /** 必须在 prompt 之前调用：模型对第一个 turn 生效。 */
    async selectModel(input) {
      const request: SessionSelectModelRequest = {
        sessionId: input.sessionId as SessionSelectModelRequest['sessionId'],
        provider: input.model.provider,
        model: input.model.model,
        ...(input.model.reasoningEffort !== undefined
          ? { reasoningEffort: input.model.reasoningEffort }
          : {}),
      }
      await controller().selectModel(request)
    },
    /** queue：不打断会话里正在跑的 turn。 */
    async prompt(input) {
      const request: SessionPromptRequest = {
        requestId: randomUUID() as SessionRequestId,
        sessionId: input.sessionId as SessionPromptRequest['sessionId'],
        mode: 'queue',
        content: [{ type: 'text', text: buildTaskDispatchMessage({ noteId: input.noteId, title: input.title }) }],
      }
      await controller().prompt(request, new AbortController().signal)
    },
    listWorkspaces,
    /** 两个来源独立降级，永远返回可用的（可能为空的）目录。 */
    async listTaskTargets(): Promise<TaskTargets> {
      const [models, presets] = await Promise.all([listModels(), listPresets()])
      return { models, presets }
    },
  }

  async function listModels(): Promise<readonly TaskModelGroup[]> {
    const sessionController = ctx.get('sessionController')
    if (sessionController === undefined) return []
    try {
      const catalog: ModelCatalog = await sessionController.modelCatalog()
      return catalog.groups.map((group) => ({
        id: group.id,
        name: group.name,
        models: group.models.map((entry) => ({ id: entry.id, name: entry.name })),
      }))
    } catch {
      return []
    }
  }

  async function listPresets(): Promise<readonly { readonly id: string; readonly name: string }[]> {
    const presets = ctx.get('agentPresets') as PresetLookup | undefined
    if (presets === undefined) return []
    try {
      const rows = await presets.list()
      return rows
        .filter((row) => row.broken === undefined)
        .map((row) => ({ id: row.id, name: row.name ?? row.id }))
    } catch {
      return []
    }
  }
}
