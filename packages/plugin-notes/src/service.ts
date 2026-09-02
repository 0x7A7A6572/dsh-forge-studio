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
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { notesDomain } from './domain.ts'
import type { NoteCreateInput, NoteId, NoteRecord, NoteUpdateInput } from './types.ts'

export interface NotesServiceConfig {
  /** 已打开的 notes 域。 */
  readonly domain: Domain<typeof notesDomain>
}

export class NotesService extends TypertRemoteService {
  private readonly table: KvTable<NoteId, NoteRecord>

  constructor(ctx: Context, config: NotesServiceConfig) {
    super(ctx, 'notes')
    this.table = config.domain.table('notes')
  }

  /** 全量便签（未删除），同步读自内存。 */
  list(): NoteRecord[] {
    return Array.from(this.table.entries(), ([, note]) => note)
  }

  /** 新建便签；title 缺省时使用默认标题。 */
  async create(input: NoteCreateInput): Promise<NoteRecord> {
    const now = Date.now()
    const note: NoteRecord = {
      id: brandString<NoteId>(randomUUID()),
      title: input.title?.trim() || '新便签',
      text: input.text,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    }
    await this.table.put(note.id, note)
    return note
  }

  /** 更新便签（title/text/pinned 至少一项，缺省字段保持原值）。 */
  async update(id: NoteId, patch: NoteUpdateInput): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current) return undefined
    const next: NoteRecord = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      updatedAt: Date.now(),
    }
    await this.table.put(id, next)
    return next
  }

  /** 置顶/取消置顶。 */
  async setPinned(id: NoteId, pinned: boolean): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current) return undefined
    const next: NoteRecord = { ...current, pinned, updatedAt: Date.now() }
    await this.table.put(id, next)
    return next
  }

  /** 删除便签；返回是否确实删除。 */
  async delete(id: NoteId): Promise<boolean> {
    return this.table.delete(id)
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

markRemoteMethods(NotesService.prototype, ['list', 'create', 'update', 'setPinned', 'delete'])

declare module '@deepseek-ai/cordis' {
  interface Context {
    notes: NotesService
  }
}
