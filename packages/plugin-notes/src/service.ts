/**
 * ctx.notes：把 notes 域的 KvTable 封装成便签 CRUD；读取同步（storage-domain 权威内存态），写入经后端持久化后生效。
 *
 * Typert Remote 服务（SRC 标记，无 codegen）：端点参数 wire 名 = 方法形参名，所以方法
 * 签名不得解构参数，client 侧 descriptors 的 wire 名必须与之完全一致。
 */

import { randomUUID } from 'node:crypto'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { bridgeWaiting, type NotesAgentBridgeState } from './agent/bridge-state.ts'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { notesDomain } from './domain.ts'
import type { TaskLease } from './domain.ts'
import { DEFAULT_NOTE_COLOR } from './types.ts'
import type {
  NoteCreateInput,
  NoteId,
  NoteLane,
  NoteModelSelection,
  NoteRecord,
  NoteSchedule,
  NoteUpdateInput,
  TaskStatus,
  TaskTargets,
} from './types.ts'
import { applyRunResult, armSchedule } from './schedule.ts'
import type {
  WebdavBackupResult,
  WebdavListResult,
  WebdavRestoreResult,
  WebdavStatus,
} from './types.ts'
import type { WebdavRunner } from './webdav-backup.ts'
import { beginRun, settleRun } from './client/core/task-lanes.ts'

/** notes/watch 流推送的变更事件。 */
export interface NotesChangeEvent {
  readonly changedAt: number
}

/** 任务执行事务结果，client 只当不透明值透传。 */
export type TaskExecuteResult =
  | { readonly ok: true; readonly note: NoteRecord }
  | {
      readonly ok: false
      readonly reason: 'missing' | 'busy' | 'missing-workspace' | 'no-dispatch' | 'dispatch-failed'
    }

type NotesChangeListener = () => void

/** 空串 / undefined 都表示「用宿主默认」，不落空字段。 */
function makeTaskLane(
  status: TaskStatus,
  agentPreset: string | undefined,
  model: NoteModelSelection | undefined,
): NoteLane {
  const preset = agentPreset?.trim() ?? ''
  return {
    status,
    ...(preset !== '' ? { agentPreset: preset } : {}),
    ...(model !== undefined ? { model } : {}),
  }
}

/**
 * 任务执行运行时（host 注入；见 agent/task-dispatch.ts）。
 * 拆成四个成员是为了把「新建会话」与「投递」分成两相：租约在两相之间落地，
 * 不存在 prompt 已投出但租约未写的竞态。
 */
export interface NotesTaskRuntime {
  /** 新建执行会话（cwd = workspace）；失败抛错。给 `agentPreset` 即按该预设装配。 */
  createSession(input: {
    readonly workspace: string
    readonly agentPreset?: string
  }): Promise<string>
  /** 必须在投递 prompt 之前调用，首个 turn 才用得上模型；失败抛错。 */
  selectModel(input: {
    readonly sessionId: string
    readonly model: NoteModelSelection
  }): Promise<void>
  /** 向执行会话投递任务 prompt（agent 由此开工）。 */
  prompt(input: {
    readonly noteId: NoteId
    readonly title: string
    readonly sessionId: string
    readonly workspace: string
  }): Promise<void>
  /** 工作区候选（最近会话用过的 cwd，供 UI 下拉）；失败 / 不可用返回空数组。 */
  listWorkspaces(): Promise<readonly string[]>
  /** 宿主缺能力 / 查询失败一律返回空目录，绝不抛。 */
  listTaskTargets(): Promise<TaskTargets>
}

export interface NotesServiceConfig {
  readonly domain: Domain<typeof notesDomain>
  /** 未注入时 taskExecute 在任何状态变更前直接返回 no-dispatch。 */
  readonly task?: NotesTaskRuntime
  /** 缺省时 webdav* 端点返回结构化失败，不炸端点。 */
  readonly webdav?: WebdavRunner
}

export class NotesService extends TypertRemoteService {
  private readonly table: KvTable<NoteId, NoteRecord>
  private readonly leases: KvTable<NoteId, TaskLease>
  private readonly task: NotesServiceConfig['task']
  private readonly webdav: NotesServiceConfig['webdav']
  /** 默认 waiting：tools 服务出现后由 index.ts 推进为 installed/failed。 */
  private agentBridge: NotesAgentBridgeState = bridgeWaiting()
  /** notes/watch 每个打开的客户端流一个订阅者。 */
  private readonly changeListeners = new Set<NotesChangeListener>()

  constructor(ctx: Context, config: NotesServiceConfig) {
    super(ctx, 'notes')
    this.table = config.domain.table('notes')
    this.leases = config.domain.table('leases')
    this.task = config.task
    this.webdav = config.webdav
  }

  getAgentBridgeState(): NotesAgentBridgeState {
    return this.agentBridge
  }

  /** 只给 host 的桥装配器用，不在 markRemoteMethods 白名单里。 */
  setAgentBridgeState(next: NotesAgentBridgeState): void {
    this.agentBridge = next
  }

  list(): NoteRecord[] {
    return Array.from(this.table.entries(), ([, note]) => note)
  }

  /**
   * notes/watch 流端点。写入成功广播一次，事件只带时间戳，client 收到自行 list()。
   * signal 与等待做 race：consumer 断开时等待立即结算，不留悬置 await 卡住 return()。
   */
  async *watch(signal?: AbortSignal): AsyncGenerator<NotesChangeEvent> {
    const lifetime = signal ?? new AbortController().signal
    if (lifetime.aborted) return
    let resolveWaiter: ((reason: 'event' | 'abort') => void) | undefined
    const wake = (): void => {
      const resolve = resolveWaiter
      resolveWaiter = undefined
      if (resolve !== undefined) resolve('event')
    }
    const onAbort = (): void => {
      const resolve = resolveWaiter
      resolveWaiter = undefined
      if (resolve !== undefined) resolve('abort')
    }
    this.changeListeners.add(wake)
    lifetime.addEventListener('abort', onAbort, { once: true })
    try {
      while (true) {
        if (resolveWaiter === undefined) {
          const reason = await new Promise<'event' | 'abort'>((resolve) => { resolveWaiter = resolve })
          if (reason === 'abort') return
        }
        yield { changedAt: Date.now() }
      }
    } finally {
      this.changeListeners.delete(wake)
      lifetime.removeEventListener('abort', onAbort)
    }
  }

  /** 广播一次变更（幂等安全；订阅者抛错不扩散）。 */
  private broadcastChanged(): void {
    for (const listener of [...this.changeListeners]) {
      try {
        listener()
      } catch (error) {
        // 订阅者抛错只丢该条，不炸写操作。
        console.error('[plugin-notes] change listener failed:', error)
      }
    }
  }

  async create(input: NoteCreateInput): Promise<NoteRecord> {
    const now = Date.now()
    const schedule = input.schedule !== undefined ? armSchedule(input.schedule, now) : undefined
    if (input.schedule !== undefined && schedule === undefined) {
      throw new Error(`schedule 参数非法：mode=${input.schedule.mode} 缺少必填字段`)
    }
    const note: NoteRecord = {
      id: brandString<NoteId>(randomUUID()),
      title: input.title?.trim() || '新便签',
      text: input.text,
      pinned: false,
      archived: false,
      color: input.color ?? DEFAULT_NOTE_COLOR,
      origin: input.origin ?? 'user',
      // 缺省不落 lane：普通便签不进泳道。
      ...(input.laneStatus !== undefined
        ? { lane: makeTaskLane(input.laneStatus, input.agentPreset, input.model) }
        : {}),
      ...(input.workspace !== undefined && input.workspace.trim() !== ''
        ? { workspace: input.workspace.trim() }
        : {}),
      // 只有任务便签才落 schedule，调度器不认无 lane 的日程。
      ...(input.laneStatus !== undefined && schedule !== undefined ? { schedule } : {}),
      createdAt: now,
      updatedAt: now,
    }
    await this.table.put(note.id, note)
    this.broadcastChanged()
    return note
  }

  /** 缺省字段保持原值；`origin` 不可更新。 */
  async update(id: NoteId, patch: NoteUpdateInput): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current) return undefined
    const now = Date.now()
    // lane patch：逐字段合并；run 提供即整体替换；空 patch = no-op（不凭空造 lane）。
    // `clear: true` 优先于 status/run，移除任务身份即手动接管。
    let lane: NoteLane | undefined = current.lane
    if (patch.lane?.clear === true) {
      lane = undefined
    } else if (patch.lane !== undefined && (patch.lane.status !== undefined || patch.lane.run !== undefined)) {
      const status: TaskStatus | undefined = patch.lane.status ?? current.lane?.status
      // 无 lane 时仅凭 run 会拼出没有 status 的 lane，schema 校验会让下次打开直接炸库。
      if (status === undefined) {
        throw new Error('lane patch 缺 status：便签无 lane 时须同时提供 status，不能仅凭 run 造 lane')
      }
      // 给值即覆盖，空串 / null 即清除回宿主默认。
      const agentPreset: string | undefined =
        patch.lane.agentPreset === undefined
          ? current.lane?.agentPreset
          : patch.lane.agentPreset.trim() !== ''
            ? patch.lane.agentPreset.trim()
            : undefined
      const model: NoteModelSelection | undefined =
        patch.lane.model === undefined ? current.lane?.model : (patch.lane.model ?? undefined)
      lane = {
        ...current.lane,
        status,
        ...(patch.lane.run !== undefined ? { run: patch.lane.run } : {}),
        ...(agentPreset !== undefined ? { agentPreset } : {}),
        ...(model !== undefined ? { model } : {}),
      }
    }
    // 改到不同状态且当前 run 帧还开着时，先把该帧收尾为「用户手动接管」；
    // 否则 run.finishedAt 缺失会让 client 误以为仍在执行、编辑器一直锁着。
    const statusChanged = patch.lane?.status !== undefined && patch.lane.status !== current.lane?.status
    const currentRunOpen = current.lane?.run !== undefined && current.lane.run.finishedAt === undefined
    if (statusChanged && currentRunOpen) {
      const settled = settleRun(current.lane!, false, '用户手动接管', now)
      lane = { ...lane!, run: settled.run }
    }
    // 必须先剥离旧 lane / workspace，否则取消任务后旧值会随 ...current 残留。
    // workspace 给值即覆盖，trim 后空串 = 清除回设置默认。
    const workspace: string | undefined =
      patch.workspace === undefined
        ? current.workspace
        : patch.workspace.trim() !== ''
          ? patch.workspace.trim()
          : undefined
    // schedule：null = 清除；给对象即整体替换，但保留宿主已记的最近派发信息。
    let schedule: NoteSchedule | undefined = current.schedule
    if (patch.schedule === null) {
      schedule = undefined
    } else if (patch.schedule !== undefined) {
      const armed = armSchedule({ ...current.schedule, ...patch.schedule }, now)
      if (armed === undefined) {
        throw new Error(`schedule 参数非法：mode=${patch.schedule.mode} 缺少必填字段`)
      }
      schedule = armed
    }
    if (lane === undefined) schedule = undefined
    const { lane: _currentLane, schedule: _currentSchedule, workspace: _currentWorkspace, ...currentWithoutLane } = current
    const next: NoteRecord = {
      ...currentWithoutLane,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      archived: patch.archived ?? current.archived ?? false,
      color: patch.color ?? current.color ?? DEFAULT_NOTE_COLOR,
      // origin 一经创建不可改写。
      origin: current.origin ?? 'user',
      updatedAt: now,
      ...(workspace !== undefined ? { workspace } : {}),
      ...(lane !== undefined ? { lane } : {}),
      ...(schedule !== undefined ? { schedule } : {}),
    }
    // 用户侧改状态 / 取消任务 / 归档即接管，撤销租约；同状态不算。
    if (
      patch.lane?.clear === true ||
      (patch.lane?.status !== undefined && patch.lane.status !== current.lane?.status) ||
      patch.archived === true
    ) {
      await this.revokeTaskLease(id)
    }
    await this.table.put(id, next)
    this.broadcastChanged()
    return next
  }

  async setPinned(id: NoteId, pinned: boolean): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current) return undefined
    const next: NoteRecord = {
      ...current,
      pinned,
      color: current.color ?? DEFAULT_NOTE_COLOR,
      updatedAt: Date.now(),
    }
    await this.table.put(id, next)
    return next
  }

  /** 删除前先撤销执行租约。 */
  async delete(id: NoteId): Promise<boolean> {
    await this.revokeTaskLease(id)
    const deleted = await this.table.delete(id)
    if (deleted) this.broadcastChanged()
    return deleted
  }

  /**
   * 写 leases 行 + 置 lane running + 新 run 帧（重跑时新帧覆盖旧帧）。
   * 'busy' = 无 lane 或已有 active lease（防双跑）。host 内部方法，不经 remote 暴露。
   */
  async grantTaskLease(
    id: NoteId,
    sessionId: string,
    by: 'user' | 'schedule' = 'user',
  ): Promise<'granted' | 'missing' | 'busy'> {
    const note = this.table.get(id)
    if (!note) return 'missing'
    if (!note.lane || this.leases.get(id)) return 'busy'
    const now = Date.now()
    await this.leases.put(id, { noteId: id, sessionId, grantedAt: now })
    // run.by 供 host 超时兜底认领定时发起的那些。
    await this.table.put(id, { ...note, lane: beginRun(note.lane, now, by), updatedAt: now })
    this.broadcastChanged()
    return 'granted'
  }

  /** 只给 host 调度器：直写 schedule。不走 update，避免触发「改状态即接管」撤销租约。 */
  async setSchedule(id: NoteId, schedule: NoteSchedule | undefined): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current) return undefined
    const { schedule: _previous, ...rest } = current
    const now = Date.now()
    const next: NoteRecord = { ...rest, ...(schedule !== undefined ? { schedule } : {}), updatedAt: now }
    await this.table.put(id, next)
    this.broadcastChanged()
    return next
  }

  /** 只删 leases 行，不改 lane —— 状态由调用方决定。 */
  async revokeTaskLease(id: NoteId): Promise<boolean> {
    return this.leases.delete(id)
  }

  getTaskLease(id: NoteId): TaskLease | undefined {
    return this.leases.get(id)
  }

  /**
   * agent 工具专用。只允许置 running：完成 / 失败是 notes_task_report 的职责。
   * 直写内存表不经 update，避开「手动改状态即撤销租约」的钩子（agent 写 lane 由 lease 授权）。
   */
  async setTaskStatus(id: NoteId, status: TaskStatus): Promise<NoteRecord | undefined> {
    if (status !== 'running') {
      throw new Error('任务状态变更请用执行中的 report 结束：set_status 仅允许置为 running')
    }
    const current = this.table.get(id)
    if (!current?.lane) return undefined
    const now = Date.now()
    const lane: NoteLane =
      current.lane.run === undefined
        ? beginRun(current.lane, now)
        : { ...current.lane, status }
    const next: NoteRecord = { ...current, lane, updatedAt: now }
    await this.table.put(id, next)
    this.broadcastChanged()
    return next
  }

  /**
   * agent 工具专用：settleRun 补 finishedAt/ok/summary，status 置 done/failed，撤销 lease。
   * 循环日程例外：状态落回 'todo'，等下一周期再派发。
   */
  async settleTaskRun(id: NoteId, ok: boolean, summary: string): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current?.lane) return undefined
    const now = Date.now()
    const looping = current.schedule?.enabled === true && current.schedule.mode !== 'once'
    const status: TaskStatus = looping ? 'todo' : ok ? 'done' : 'failed'
    const lane: NoteLane = { ...settleRun(current.lane, ok, summary, now), status }
    await this.revokeTaskLease(id)
    // 成败写回日程的失败连击：成功清零、失败累加，到上限自动停用。
    const schedule = current.schedule !== undefined ? applyRunResult(current.schedule, ok, now) : undefined
    const next: NoteRecord = {
      ...current,
      lane,
      ...(schedule !== undefined ? { schedule } : {}),
      updatedAt: now,
    }
    await this.table.put(id, next)
    this.broadcastChanged()
    return next
  }

  /**
   * 执行事务：按工作区新建会话 → 选模型 → 授权租约 → 投递 prompt。
   * 工作区只看便签自己的 workspace，没有就是 missing-workspace（不新建会话、不改状态）。
   * 回滚 = revokeTaskLease + 直写恢复快照 lane（不经 update，避开接管钩子）。
   */
  async taskExecute(id: NoteId): Promise<TaskExecuteResult> {
    return this.runTaskExecute(id, 'user')
  }

  /** 只给 host 调度器：同一条事务，只是 run 帧标 by='schedule'，白名单不含它。 */
  async taskExecuteScheduled(id: NoteId): Promise<TaskExecuteResult> {
    return this.runTaskExecute(id, 'schedule')
  }

  /** 两个入口共用的本体：by 写进 run 帧。 */
  private async runTaskExecute(id: NoteId, by: 'user' | 'schedule'): Promise<TaskExecuteResult> {
    const current = this.table.get(id)
    if (!current) return { ok: false, reason: 'missing' }
    // 归档便签不得执行。
    if (current.archived || !current.lane || this.leases.get(id)) {
      return { ok: false, reason: 'busy' }
    }
    // 先于工作区解析判定：没有运行时就该报 no-dispatch。
    if (this.task === undefined) return { ok: false, reason: 'no-dispatch' }
    const workspace = (current.workspace ?? '').trim()
    if (workspace === '') return { ok: false, reason: 'missing-workspace' }
    const snapshot = current

    let sessionId: string
    try {
      sessionId = await this.task.createSession({
        workspace,
        ...(current.lane.agentPreset !== undefined ? { agentPreset: current.lane.agentPreset } : {}),
      })
    } catch {
      return { ok: false, reason: 'dispatch-failed' }
    }

    // 必须在投递前选好，第一个 turn 才用得上。
    if (current.lane.model !== undefined) {
      try {
        await this.task.selectModel({ sessionId, model: current.lane.model })
      } catch {
        return { ok: false, reason: 'dispatch-failed' }
      }
    }

    const granted = await this.grantTaskLease(id, sessionId, by)
    if (granted !== 'granted') {
      return { ok: false, reason: granted === 'missing' ? 'missing' : 'busy' }
    }

    try {
      await this.task.prompt({ noteId: id, title: current.title, sessionId, workspace })
    } catch {
      await this.rollbackTaskExecute(id, snapshot)
      return { ok: false, reason: 'dispatch-failed' }
    }

    const fresh = this.table.get(id)
    if (!fresh) return { ok: false, reason: 'missing' }
    return { ok: true, note: fresh }
  }

  /** 运行时缺省或查询失败一律空数组，纯 UI 宿主不炸端点。 */
  async listWorkspaces(): Promise<readonly string[]> {
    if (this.task === undefined) return []
    try {
      return await this.task.listWorkspaces()
    } catch {
      return []
    }
  }

  /** 缺省 / 查询抛错一律空目录，编辑器据此只显示「宿主默认」。 */
  async taskTargets(): Promise<TaskTargets> {
    if (this.task === undefined) return { models: [], presets: [] }
    try {
      return await this.task.listTaskTargets()
    } catch {
      return { models: [], presets: [] }
    }
  }

  /** 手动接管：撤销租约 + settleRun(false) + 状态置 'todo'，直写不经 update。 */
  async taskReset(id: NoteId): Promise<{ ok: true; note: NoteRecord } | { ok: false }> {
    const current = this.table.get(id)
    if (!current?.lane) return { ok: false }
    await this.revokeTaskLease(id)
    const now = Date.now()
    const lane: NoteLane = { ...settleRun(current.lane, false, '用户手动接管', now), status: 'todo' }
    const next: NoteRecord = { ...current, lane, updatedAt: now }
    await this.table.put(id, next)
    this.broadcastChanged()
    return { ok: true, note: next }
  }

  /** 删 lease 行 + 直写恢复 grant 前的整张便签。 */
  private async rollbackTaskExecute(id: NoteId, snapshot: NoteRecord): Promise<void> {
    await this.revokeTaskLease(id)
    await this.table.put(id, snapshot)
    this.broadcastChanged()
  }

  async webdavBackup(): Promise<WebdavBackupResult> {
    if (this.webdav === undefined) return { ok: false, reason: 'WebDAV 引擎未装配' }
    return this.webdav.backupNow()
  }

  /** desc 时间序，仅本插件命名。 */
  async webdavList(): Promise<WebdavListResult> {
    if (this.webdav === undefined) return { ok: false, reason: 'WebDAV 引擎未装配' }
    return this.webdav.listFiles()
  }

  /** `'latest'` = 最近一份。 */
  async webdavRestore(name: string): Promise<WebdavRestoreResult> {
    if (this.webdav === undefined) return { ok: false, reason: 'WebDAV 引擎未装配' }
    return this.webdav.restore(name)
  }

  async webdavStatus(): Promise<WebdavStatus> {
    if (this.webdav === undefined) {
      return {
        enabled: false,
        lastBackupAt: null,
        lastBackupOk: null,
        lastBackupError: null,
        lastBackupName: null,
        lastRestoreAt: null,
        lastRestoreOk: null,
        lastRestoreName: null,
      }
    }
    return this.webdav.status()
  }

  /** 清空便签与租约两表后按 payload 逐条写入，只给 host 的 WebDAV 恢复流程用。 */
  async replaceAll(notes: readonly NoteRecord[]): Promise<void> {
    for (const [id] of this.table.entries()) await this.table.delete(id)
    for (const [leaseId] of this.leases.entries()) await this.leases.delete(leaseId)
    for (const note of notes) await this.table.put(note.id, note)
    this.broadcastChanged()
  }
}

/** 手工复刻 @Remote 装饰器产物，避免构建依赖标准装饰器转译。 */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

type RemoteMethodEntry =
  | { readonly method: string; readonly mode?: undefined }
  | { readonly method: string; readonly mode: 'stream' }

function markRemoteMethods(prototype: object, methods: readonly RemoteMethodEntry[]): void {
  Object.defineProperty(prototype, REMOTE_METHODS, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(
        methods.map((entry) =>
          Object.freeze({
            method: entry.method,
            ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
            invocation: Object.freeze({ kind: 'direct' as const }),
          }),
        ),
      ),
    }),
  })
}

markRemoteMethods(NotesService.prototype, [
  { method: 'list' },
  { method: 'create' },
  { method: 'update' },
  { method: 'setPinned' },
  { method: 'delete' },
  { method: 'getAgentBridgeState' },
  { method: 'taskExecute' },
  { method: 'listWorkspaces' },
  { method: 'taskTargets' },
  { method: 'taskReset' },
  { method: 'watch', mode: 'stream' },
  { method: 'webdavBackup' },
  { method: 'webdavList' },
  { method: 'webdavRestore' },
  { method: 'webdavStatus' },
])

declare module '@deepseek-ai/cordis' {
  interface Context {
    notes: NotesService
  }
}
