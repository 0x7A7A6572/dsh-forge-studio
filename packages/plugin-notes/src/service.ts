/**
 * NotesService —— ctx.notes：把 notes 域的 KvTable 封装成便签 CRUD。
 * 读取同步（storage-domain 权威内存态）；写入经后端持久化后生效。
 * 本服务不直接感知 agent/会话：事件快照由 tools/commands 层在变更后写入。
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { notesDomain } from './domain.ts'
import type { NoteCreateInput, NoteId, NoteRecord, NoteUpdateInput } from './types.ts'

export interface NotesServiceConfig {
  /** 已打开的 notes 域。 */
  readonly domain: Domain<typeof notesDomain>
}

export class NotesService extends Service {
  private readonly table: KvTable<NoteId, NoteRecord>

  constructor(ctx: Context, config: NotesServiceConfig) {
    super(ctx, 'notes')
    this.table = config.domain.table('notes')
  }

  /** 全量便签（未删除），同步读自内存。 */
  list(): NoteRecord[] {
    return Array.from(this.table.entries(), ([, note]) => note)
  }

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

  async setPinned(id: NoteId, pinned: boolean): Promise<NoteRecord | undefined> {
    const current = this.table.get(id)
    if (!current) return undefined
    const next: NoteRecord = { ...current, pinned, updatedAt: Date.now() }
    await this.table.put(id, next)
    return next
  }

  async remove(id: NoteId): Promise<boolean> {
    return this.table.delete(id)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    notes: NotesService
  }
}
