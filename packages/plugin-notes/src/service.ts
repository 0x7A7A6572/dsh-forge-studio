/**
 * NotesService —— ctx.notes：把 notes 域的 KvTable 封装成便签 CRUD。
 * 读取同步（storage-domain 权威内存态）；写入经后端持久化后生效。
 *
 * 本服务同时是 Typert Gateway 的 Remote 服务（SRC 标记模式，无 codegen）：
 * - 继承 TypertRemoteService ⇒ 自动绑定 wire 命名空间 `notes`（服务 key）；
 * - 公开方法在类定义后手动挂 marker（等价于 @Remote 装饰器产物，见
 *   markRemoteMethods）⇒ gateway 以 <namespace>/<method> 端点暴露，
 *   参数/结果按 src-json 透传；client 端 ctx.remote.notes.* 直接调用。
 * 端点参数 wire 名 = 方法形参名（gateway 从函数源码解析），故方法签名
 * 不得解构参数，且 client 侧 descriptors 的 wire 名必须与之完全一致。
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
import type { NoteCreateInput, NoteId, NoteLane, NoteRecord, NoteUpdateInput, TaskStatus } from './types.ts'
import { beginRun, settleRun } from './client/core/task-lanes.ts'

export interface NotesServiceConfig {
  /** 已打开的 notes 域。 */
  readonly domain: Domain<typeof notesDomain>
  /**
   * 任务执行投递回调（host 注入，可缺省）：把「泳道卡执行」投成对承载便签板会话的
   * 一次 prompt（见 index.ts 装配 / spec §8 缝 1）。未注入时 taskExecute 在 grant 后
   * 立即回滚并返回 no-dispatch；注入后抛错则同样回滚并返回 dispatch-failed。
   */
  readonly dispatch?: (input: {
    readonly noteId: NoteId
    readonly sessionId: string
    readonly title: string
  }) => Promise<void>
}

export class NotesService extends TypertRemoteService {
  private readonly table: KvTable<NoteId, NoteRecord>
  private readonly leases: KvTable<NoteId, TaskLease>
  private readonly dispatch: NotesServiceConfig['dispatch']
  /**
   * agent 桥装配状态（见 agent/bridge-state.ts）。默认 waiting：tools 服务出现后由
   * index.ts 的桥装配器推进为 installed/failed；纯 UI 宿主保持 waiting。
   */
  private agentBridge: NotesAgentBridgeState = bridgeWaiting()

  constructor(ctx: Context, config: NotesServiceConfig) {
    super(ctx, 'notes')
    this.table = config.domain.table('notes')
    this.leases = config.domain.table('leases')
    this.dispatch = config.dispatch
  }

  /** 当前 agent 桥装配状态快照（同步；client 经 notes/getAgentBridgeState 端点可读）。 */
  getAgentBridgeState(): NotesAgentBridgeState {
    return this.agentBridge
  }

  /**
   * 仅供 host 侧 agent 桥装配器（index.ts installNotes*WhenReady）推进桥状态。
   * 不参与 Typert remote（markRemoteMethods 白名单不包含本方法）。
   */
  setAgentBridgeState(next: NotesAgentBridgeState): void {
    this.agentBridge = next
  }

  /** 全量便签（未删除），同步读自内存。 */
  list(): NoteRecord[] {
    return Array.from(this.table.entries(), ([, note]) => note)
  }

  /** 新建便签；title/color/origin 缺省时使用默认值（origin 默认 'user'）。 */
  async create(input: NoteCreateInput): Promise<NoteRecord> {
    const now = Date.now()
    const note: NoteRecord = {
      id: brandString<NoteId>(randomUUID()),
      title: input.title?.trim() || '新便签',
      text: input.text,
      pinned: false,
      archived: false,
      color: input.color ?? DEFAULT_NOTE_COLOR,
      // 来源：agent 工具层显式传 'agent'；UI/缺省落 'user'。
      origin: input.origin ?? 'user',
      // 新建即任务：列头「＋新建任务」传 laneStatus → 落 lane: { status }；
      // 缺省不落 lane（普通便签，不进泳道）。
      ...(input.laneStatus !== undefined ? { lane: { status: input.laneStatus } } : {}),
      createdAt: now,
      updatedAt: now,
    }
    await this.table.put(note.id, note)
    return note
  }

  /** 更新便签（title/text/pinned/archived/color 至少一项，缺省字段保持原值）。origin 不可更新。 */
  async update(id: NoteId, patch: NoteUpdateInput): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current) return undefined
    const now = Date.now()
    // lane patch：与顶层同语义——缺省字段保留、逐字段合并（next.lane =
    // { ...current.lane, ...patch.lane }）；run 提供即整体替换（非逐字段合并）；
    // 空 patch 对象（既无 status 也无 run 且无 clear）= no-op，不改动 lane
    // （含不凭空造 lane）。
    // `clear: true` 优先（取消任务）：删除 lane 身份（next.lane = undefined），
    // 与 status/run 互斥、并存时 clear 胜出（status/run 被忽略）。移除任务身份
    // 即手动接管，随后的 revoke 一并撤销租约。
    let lane: NoteLane | undefined = current.lane
    if (patch.lane?.clear === true) {
      lane = undefined
    } else if (patch.lane !== undefined && (patch.lane.status !== undefined || patch.lane.run !== undefined)) {
      // 合成 status：patch 未给则沿用当前 lane 的 status。
      const status: TaskStatus | undefined = patch.lane.status ?? current.lane?.status
      // 守卫：patch 仅给 run 没给 status 且当前无 lane 时，会拼出无 status 的 lane，
      // 下次打开 domain 会因 schema 校验失败炸库。拒绝而非静默落库。（clear 走上面
      // 分支，不会误触发本守卫。）
      if (status === undefined) {
        throw new Error('lane patch 缺 status：便签无 lane 时须同时提供 status，不能仅凭 run 造 lane')
      }
      lane = {
        ...current.lane,
        status,
        ...(patch.lane.run !== undefined ? { run: patch.lane.run } : {}),
      }
    }
    // M3 手动接管收尾：仅「改到不同状态」的接管路径、且当前 lane 有开着（未
    // finishedAt）的 run 帧时，先把该帧收尾为「用户手动接管」（closed as
    // interrupted）。否则状态变了但 run.finishedAt 仍缺，client isRunOpen 恒真、
    // 编辑器误锁「执行中」。clear（取消任务）删除整段 lane，run 随 lane 一并消失，
    // 无需收尾（settle 无意义）；归档不改状态，也不在此收尾。status 由用户 patch
    // 决定——收尾只关闭 run 帧（标记为中断），不覆盖用户选定的结果状态。
    const statusChanged = patch.lane?.status !== undefined && patch.lane.status !== current.lane?.status
    const currentRunOpen = current.lane?.run !== undefined && current.lane.run.finishedAt === undefined
    if (statusChanged && currentRunOpen) {
      const settled = settleRun(current.lane!, false, '用户手动接管', now)
      lane = { ...lane!, run: settled.run }
    }
    // 剥离 current 的 lane，最后按合并结果显式写回（clear 时 lane=undefined 即删除
    // 身份；否则维持「缺省字段保留」）。若不剥离，...current 会带出旧 lane，导致
    // 「取消任务」后旧 lane 残留。
    const { lane: _currentLane, ...currentWithoutLane } = current
    const next: NoteRecord = {
      ...currentWithoutLane,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      // archived 显式归一：patch 未带时保留原值。
      archived: patch.archived ?? current.archived ?? false,
      // color 显式归一：patch 未带时保留原值，原值为空（理论上不存在）回默认黄。
      color: patch.color ?? current.color ?? DEFAULT_NOTE_COLOR,
      // origin 永远保留原值：来源一经创建不可改写（agent 无法把自己的便签标成 user）。
      origin: current.origin ?? 'user',
      updatedAt: now,
      ...(lane !== undefined ? { lane } : {}),
    }
    // 撤销租约（D5 手动接管）：任何用户侧 lane.status 变更即接管；取消任务
    // （clear）同样接管；归档同样撤销。与当前状态相同则不算接管，不撤销。
    if (
      patch.lane?.clear === true ||
      (patch.lane?.status !== undefined && patch.lane.status !== current.lane?.status) ||
      patch.archived === true
    ) {
      await this.revokeTaskLease(id)
    }
    await this.table.put(id, next)
    return next
  }

  /** 置顶/取消置顶。 */
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

  /** 删除便签；返回是否确实删除。删除前先撤销其执行租约（若有）。 */
  async delete(id: NoteId): Promise<boolean> {
    await this.revokeTaskLease(id)
    return this.table.delete(id)
  }

  /**
   * 授权任务执行：写 leases 行并把该便签 lane 置 running + 新 run 帧（重跑时
   * 新帧覆盖旧帧），其余字段不动。'missing' = 无此便签；'busy' = 便签无 lane
   * （非任务）或已有 active lease（防双跑）。便签必须先有 lane（今日唯一路径：
   * create 时带 laneStatus）。此为 host 内部方法，不经 Typert remote 暴露。
   */
  async grantTaskLease(id: NoteId, sessionId: string): Promise<'granted' | 'missing' | 'busy'> {
    const note = this.table.get(id)
    if (!note) return 'missing'
    if (!note.lane || this.leases.get(id)) return 'busy'
    const now = Date.now()
    await this.leases.put(id, { noteId: id, sessionId, grantedAt: now })
    // beginRun 首参按签名透传当前 lane（其实现未使用该参），返回 { status:'running', run:{ startedAt } }。
    await this.table.put(id, { ...note, lane: beginRun(note.lane, now), updatedAt: now })
    return 'granted'
  }

  /** 撤销执行租约：只删 leases 行（幂等），不改 lane——状态由调用方决定。 */
  async revokeTaskLease(id: NoteId): Promise<boolean> {
    return this.leases.delete(id)
  }

  /** 同步读当前 active lease（agent guard 判定用；无则 undefined）。 */
  getTaskLease(id: NoteId): TaskLease | undefined {
    return this.leases.get(id)
  }

  /**
   * agent 工具专用：置任务状态。通道已收窄（M6 裁定）：仅允许 status='running'
   * ——完成/失败是 notes_task_report 的职责（自动写结果 + settle + 撤销租约）。
   * 直接写内存表、不经 update——update 的「手动改状态即撤销租约」钩子面向用户侧
   * UI 改动，agent 写 lane 由 lease 授权，不得触发该撤销。置 running 且无 run 帧
   * 时补 beginRun 初始帧；已 running 时 re-assert 为无害 no-op（不重建帧）。
   */
  async setTaskStatus(id: NoteId, status: TaskStatus): Promise<NoteRecord | undefined> {
    // 防御性拒绝（host 内部方法，双保险：agent 工具层已先行校验，此处兜底）。
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
    return next
  }

  /**
   * agent 工具专用：收尾本次执行 —— settleRun 补 finishedAt/ok/summary，status
   * 置 done（ok）/ failed（!ok），并撤销 lease。note 无 lane 时返回 undefined。
   */
  async settleTaskRun(id: NoteId, ok: boolean, summary: string): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current?.lane) return undefined
    const now = Date.now()
    const status: TaskStatus = ok ? 'done' : 'failed'
    const lane: NoteLane = { ...settleRun(current.lane, ok, summary, now), status }
    await this.revokeTaskLease(id)
    const next: NoteRecord = { ...current, lane, updatedAt: now }
    await this.table.put(id, next)
    return next
  }

  /**
   * 执行事务（host 投递会话，spec §7/§8）：
   * 1. 快照当前便签（回滚基准）；missing = 无此便签；busy = 归档 / 无 lane / 已有 lease。
   * 2. grantTaskLease（置 running + 新 run 帧 + 写 lease）；非 granted 按对应 reason 返回。
   * 3. 无 dispatch → 回滚（revoke + 直写快照）→ no-dispatch。
   * 4. await dispatch(...)；抛错 → 同样回滚 → dispatch-failed。
   * 5. 成功 → 返回投递后最新便签（running + run 帧）。
   *
   * 回滚语义：grant 是「写 lease + 直写 running」两次独立 put（非原子），故回滚 =
   * revokeTaskLease（只删 lease 行）+ 直写恢复快照 lane——不经 update（update 的「手动
   * 改状态即撤销租约」钩子面向用户侧 UI，此处直写避免触发，且幂等无碍）。快照存的是
   * grant 前的整张便签，直写即彻底清掉 grant 造出的 running/run 帧。
   */
  async taskExecute(
    id: NoteId,
    sessionId: string,
  ): Promise<{ ok: true; note: NoteRecord } | { ok: false; reason: 'missing' | 'busy' | 'no-dispatch' | 'dispatch-failed' }> {
    const current = this.table.get(id)
    if (!current) return { ok: false, reason: 'missing' }
    // T4 forward-minor b：归档便签不得执行（归档即离开工作流）。
    if (current.archived || !current.lane || this.leases.get(id)) {
      return { ok: false, reason: 'busy' }
    }
    const snapshot = current

    const granted = await this.grantTaskLease(id, sessionId)
    if (granted !== 'granted') {
      return { ok: false, reason: granted === 'missing' ? 'missing' : 'busy' }
    }

    if (this.dispatch === undefined) {
      await this.rollbackTaskExecute(id, snapshot)
      return { ok: false, reason: 'no-dispatch' }
    }

    try {
      await this.dispatch({ noteId: id, sessionId, title: current.title })
    } catch {
      await this.rollbackTaskExecute(id, snapshot)
      return { ok: false, reason: 'dispatch-failed' }
    }

    const fresh = this.table.get(id)
    if (!fresh) return { ok: false, reason: 'missing' }
    return { ok: true, note: fresh }
  }

  /**
   * 手动接管（重置为待办，spec M3）：撤销租约 + settleRun(ok:false, '用户手动接管') +
   * 状态置 'todo'，直写（不经 update 的接管钩子）。无此便签 / 非任务（无 lane）→ ok:false。
   */
  async taskReset(id: NoteId): Promise<{ ok: true; note: NoteRecord } | { ok: false }> {
    const current = this.table.get(id)
    if (!current?.lane) return { ok: false }
    await this.revokeTaskLease(id)
    const now = Date.now()
    const lane: NoteLane = { ...settleRun(current.lane, false, '用户手动接管', now), status: 'todo' }
    const next: NoteRecord = { ...current, lane, updatedAt: now }
    await this.table.put(id, next)
    return { ok: true, note: next }
  }

  /** 执行事务回滚：删 lease 行 + 直写恢复 grant 前的整张便签（含原 lane/run/updatedAt）。 */
  private async rollbackTaskExecute(id: NoteId, snapshot: NoteRecord): Promise<void> {
    await this.revokeTaskLease(id)
    await this.table.put(id, snapshot)
  }
}

/**
 * Typert SRC 标记：协议内部以字符串 key 在类原型上存
 * `{version: 1, methods: [{method, invocation: {kind:'direct'}}]}` 的冻结对象。
 * 这里手工复刻 @Remote 装饰器的产物（同 alpha.3 train 的稳定契约），
 * 避免宿主/测试构建对标准装饰器转译的依赖。
 */
const REMOTE_METHODS = '@deepseek-ai/dsh-typert-protocol/remote-methods'

function markRemoteMethods(prototype: object, methods: readonly string[]): void {
  Object.defineProperty(prototype, REMOTE_METHODS, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(
        methods.map((method) =>
          Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' as const }) }),
        ),
      ),
    }),
  })
}

markRemoteMethods(NotesService.prototype, ['list', 'create', 'update', 'setPinned', 'delete', 'getAgentBridgeState', 'taskExecute', 'taskReset'])

declare module '@deepseek-ai/cordis' {
  interface Context {
    notes: NotesService
  }
}
