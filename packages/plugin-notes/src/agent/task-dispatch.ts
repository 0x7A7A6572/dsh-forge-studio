/**
 * 任务执行运行时（host 侧）：把「泳道卡执行」接成
 * 「按工作区**新建会话** → 在新会话里投一次 prompt」（spec §8 缝 1：host 侧
 * ctx.sessionController）。
 *
 * 为什么新建会话：任务执行要改文件/跑命令，工作目录（cwd）是它的第一等输入；
 * 把它塞回便签板所在会话会污染用户正在聊的上下文，且无法指定工作区。新建会话的
 * cwd = 工作区，用户可以单独打开、续聊、随时接管。执行租约绑定的是**新会话 id**
 * （见 service.ts taskExecute），所以 agent 在新会话里调 notes_task_report 能通过
 * 租约校验。
 *
 * 通道 = `SessionController`（宿主装配的会话控制器，cordis key
 * `sessionController`，与 web 会话 UI 同款通道）：
 * - `create({ workspaceId })` → 新会话 id（工作区 = 该注册工作区的路径）；宿主装了
 *   workspaceRegistry 时优先走这条，会话才会归进会话列表里对应的**工作区分组**；
 *   反查不到（无注册表 / 目录不存在 / 目录未注册）退回 `create({ cwd })`——工作目录
 *   一样，只是分组为「（未分组）」；
 * - `prompt(request, signal)` → mode='queue' 走 agent.followup（排队追加一个 turn）；
 *   mode='steer' 会打断当前 turn，默认不用（对齐 spec §8「默认选普通排队」）。
 * - `list({}, signal)` → 会话列表，取其中的 cwd 去重作为工作区候选（下拉用）。
 *
 * 时序（关键）：sessionController 是重服务（依赖 agents/sessions/typert 等），宿主装配
 * service-availability 驱动、几乎必然晚于本插件 apply——故运行时闭包在调用时（用户
 * 点「执行」）才惰性解析 `ctx.get('sessionController')`，避免 apply 时一次性判存漏挂
 * （同 tools 桥教训，见 index.ts 头注释）。宿主从不装配 sessionController 时，闭包在
 * 调用时抛错 → taskExecute 回滚并返回 dispatch-failed（UI 侧给提示）。
 * 例外是 listWorkspaces：拿不到候选只是「没有候选」，一律降级空数组、不抛。
 *
 * 默认工作区（defaultWorkspace）三层兜底，保证「总有默认值」：
 * 1) 设置命名空间 `forge-studio-notes` 的 defaultWorkspace（用户显式配置）；
 * 2) 最近会话用过的目录（会话列表按活动序，取首条）；
 * 3) 宿主进程目录 process.cwd()（恒存在——纯 UI 宿主、零会话时也能执行）。
 * cordis 规则：`ctx.settings` 必须在声明了 inject(['settings']) 的上下文里读——这里在
 * 装配时派生一次带 settings 的上下文并缓存，读取时同步取值（改配置立即生效）；
 * settings 服务缺席/读取抛错都降级到下一层。
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
// 仅类型导入（build 时擦除，不进 bundle）：加载 cordis Context 增广（ctx.sessionController）
// 与请求形状；SessionId 通过 SessionPromptRequest['sessionId'] 取型，免直接 import。
import type {
  SessionCreateRequest,
  SessionListRequest,
  SessionPromptRequest,
  SessionRequestId,
} from '@deepseek-ai/dsh-api-session-controller'
import type { NotesTaskRuntime } from '../service.ts'
import { NOTES_NAMESPACE } from '../types.ts'
import type { NoteId, NotesConfig } from '../types.ts'

/** 工作区候选上限：下拉不该无限长（会话列表按活动时间序，取最近若干）。 */
export const WORKSPACE_CANDIDATE_LIMIT = 12

/**
 * 工作区注册表（`ctx.workspaceRegistry`）的结构面：只取「按规范路径反查工作区」
 * 这一个能力。故意不 import @deepseek-ai/dsh-workspace——本插件不对它建立依赖
 * （纯 UI / 无工作区的宿主照常可用），宿主装配了就走结构化匹配，没装配就降级。
 */
interface WorkspaceLookup {
  resolveByPath(path: string): Promise<{ readonly id: string } | undefined>
}

/** 派发消息首行标记：一眼认出「这是任务派发」，且几乎不占宽度。 */
export const TASK_DISPATCH_MARK = '⇲'

/**
 * 投递消息模板（spec §8 / M5）：**首行只有标记 + 标题**，正式说明压到末尾。
 *
 * 为什么：这条文本会作为**用户消息**逐字出现在会话记录（左侧列表 + 会话首条）里，
 * 而列表只显示第一行——原来的 `【任务执行】请执行便签「…」…` 前缀占满整行，
 * 一屏派发会话长得一模一样，扫一眼看不出「在跑哪张便签」。所以：
 * - 首行 = `⇲ 标题`：标记固定、标题最靠前，列表里天然可区分；
 * - 末尾一行才是那句完整说明（含 id，供 notes_get 调用）——协议细节依旧由工具
 *   说明承担（notes_get / notes_task_set_status / notes_task_report 的 description）。
 */
export function buildTaskDispatchMessage(input: { readonly noteId: NoteId; readonly title: string }): string {
  const title = input.title || '无标题'
  return `${TASK_DISPATCH_MARK} ${title}\n\n【任务执行】请执行便签「${title}」（id: ${input.noteId}）中描述的任务。`
}

/**
 * 装配任务执行运行时（host 侧）。返回的对象在调用时才惰性解析 sessionController；
 * 新建会话/投递的任何抛错（无 sessionController / create / prompt 拒绝）都由
 * taskExecute 捕获 → 回滚 + dispatch-failed。
 */
export function installTaskRuntime(ctx: Context): NotesTaskRuntime {
  /** 惰性取会话控制器：缺省即抛（调用方按 dispatch-failed 处理）。 */
  const controller = () => {
    const sessionController = ctx.get('sessionController')
    if (sessionController === undefined) {
      throw new Error('sessionController 不可用：宿主未装配会话控制器，任务执行无法新建会话')
    }
    return sessionController
  }

  /** 带 settings 的派生上下文（装配时声明 inject；缺席则保持 undefined → 无默认工作区）。 */
  let settingsCtx: Context | undefined
  void ctx.inject(['settings'], (injected) => {
    settingsCtx = injected
  })

  /** 设置里的默认工作区（未配置/未注入 settings/读取异常一律 undefined）。 */
  const configuredDefaultWorkspace = (): string | undefined => {
    try {
      const raw = settingsCtx?.settings.get(NOTES_NAMESPACE) as Partial<NotesConfig> | undefined
      const value = raw?.defaultWorkspace?.trim()
      return value !== undefined && value !== '' ? value : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 把「工作区目录」解析成宿主的工作区 **id**：新建会话时优先传 workspaceId，
   * 会话才会落进该工作区的分组（只传 cwd 的话会话列表里显示为「（未分组）」）。
   * 注册表缺席 / 目录不存在（realpath 抛错）/ 目录没注册成工作区 → undefined，
   * 调用方退回 cwd 路径（工作目录不变，只是不归组）。
   */
  const resolveWorkspaceId = async (path: string): Promise<string | undefined> => {
    // ctx.get：服务名不在 Context 类型面上时返回 any，且不像属性访问那样抛 inject 错。
    const registry = ctx.get('workspaceRegistry') as WorkspaceLookup | undefined
    if (registry === undefined) return undefined
    try {
      const workspace = await registry.resolveByPath(path)
      return workspace?.id
    } catch {
      return undefined
    }
  }

  /** 工作区候选：会话列表里出现过的 cwd（去重、按活动序、截断）；失败降级空数组。 */
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
    /**
     * 新建执行会话：**优先按 workspaceId**（会话归入该工作区分组），这样「设了工作区」
     * 的执行会话就出现在会话列表对应目录下，而不是掉进「（未分组）」——那是「没设工作区」
     * 该有的样子。反查不到工作区（注册表缺席 / 目录不存在 / 目录未注册）才退回 cwd：
     * 工作目录一样对，只是分组信息丢了（与旧行为一致）。
     * 宿主按目录解析/校验（workspaceId → 注册表路径；cwd → 宿主 realpath），本层不碰文件系统。
     */
    async createSession(input) {
      const workspaceId = await resolveWorkspaceId(input.workspace)
      const request: SessionCreateRequest =
        workspaceId !== undefined
          ? { workspaceId: workspaceId as NonNullable<SessionCreateRequest['workspaceId']> }
          : { cwd: input.workspace }
      const created = await controller().create(request)
      return String(created.sessionId)
    },
    /** 向执行会话投递任务 prompt（queue 语义：不打断会话里正在跑的 turn）。 */
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
    /**
     * 任务执行的默认工作区（三层兜底，见文件头注释）：设置值 → 最近会话目录 →
     * 宿主进程目录。除极端情况（process.cwd() 为空）外恒有值，故任务便签不再因
     * 「没配工作区」被拒。
     */
    async defaultWorkspace() {
      const configured = configuredDefaultWorkspace()
      if (configured !== undefined) return configured
      const candidates = await listWorkspaces()
      return candidates.length > 0 ? candidates[0] : process.cwd()
    },
  }
}
