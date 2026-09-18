/**
 * 记忆的详情面：新增/编辑草稿、详情弹窗，以及详情里挂着的实体关联图。
 *
 * 这三样**故意合成一块**。原本想拆成「表单」和「wiki」两个 hook，但它们互相写对方的状态：
 * 打开详情要取邻域、关掉要清连边草稿，而连边动作又会改详情 —— 硬拆只能靠 ref 或 context 绕，
 * 反而把一条真实的「详情里就显示关联图」的耦合藏进了间接层。
 */
import { useState } from 'react'
import { errText, parseAliases } from '../core/memory-model.ts'
import type { MemoryTab, Draft, EntityDraft, LinkDraft } from '../core/memory-section-types.ts'
import type { MemoryEdge, MemoryEntity, MemoryId, MemoryNeighborhood, MemoryRecord } from '../../types.ts'
import type { MemoryRemote } from '../core/remote.ts'

export function useMemoryDetail(memory: MemoryRemote, run: (action: () => Promise<unknown>, done?: string) => Promise<void>, tab: MemoryTab, projectPath: string, setError: (value: string) => void, setNotice: (value: string) => void) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [detail, setDetail] = useState<MemoryRecord | null>(null)
  const [entityDraft, setEntityDraft] = useState<EntityDraft | null>(null)
  const [openEntityId, setOpenEntityId] = useState<string | null>(null)
  const [entityEdges, setEntityEdges] = useState<readonly MemoryEdge[]>([])
  const [neighborhood, setNeighborhood] = useState<MemoryNeighborhood | null>(null)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)


  function startEdit(record: MemoryRecord): void {
    setDraft({
      id: record.id,
      title: record.title,
      summary: record.summary,
      aliases: record.aliases.join(' / '),
      content: record.content,
      kind: record.kind,
      importance: record.importance,
      scope: record.scope,
      projectPath: record.projectPath,
    })
  }


  function startCreate(): void {
    setDraft({
      id: null,
      title: '',
      summary: '',
      aliases: '',
      content: '',
      kind: 'fact',
      importance: 3,
      scope: tab === 'project' ? 'project' : 'global',
      projectPath: tab === 'project' ? projectPath : '',
    })
  }


  async function saveDraft(): Promise<void> {
    if (draft === null) return
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (title === '' || content === '') {
      setError('标题与内容都不能为空')
      return
    }
    if (draft.scope === 'project' && draft.projectPath.trim() === '') {
      setError('项目记忆需要选择或填写一个工作区目录')
      return
    }
    await run(async () => {
      if (draft.id === null) {
        const result = await memory.save({
          title,
          content,
          summary: draft.summary.trim(),
          aliases: parseAliases(draft.aliases),
          kind: draft.kind,
          scope: draft.scope,
          ...(draft.scope === 'project' ? { projectPath: draft.projectPath.trim() } : {}),
          importance: draft.importance,
          source: 'user',
        })
        if (!result.ok) throw new Error(errText(result.error))
      } else {
        const result = await memory.updateMemory(draft.id as MemoryId, {
          title,
          content,
          summary: draft.summary.trim(),
          aliases: parseAliases(draft.aliases),
          kind: draft.kind,
          importance: draft.importance,
          scope: draft.scope,
          ...(draft.scope === 'project' ? { projectPath: draft.projectPath.trim() } : {}),
        })
        if (!result.ok) throw new Error(errText(result.error))
      }
      setDraft(null)
    }, '已保存。')
  }


  function startCreateEntity(): void {
    setError('')
    setNotice('')
    setEntityDraft({ id: null, name: '', kind: 'project', aliases: '', summary: '' })
  }


  function startEditEntity(entity: MemoryEntity): void {
    setEntityDraft({
      id: entity.id,
      name: entity.name,
      kind: entity.kind,
      aliases: entity.aliases.join(' / '),
      summary: entity.summary,
    })
  }


  async function saveEntityDraft(): Promise<void> {
    if (entityDraft === null) return
    const name = entityDraft.name.trim()
    if (name === '') {
      setError('实体名称不能为空')
      return
    }
    await run(async () => {
      const result = await memory.upsertEntity({
        ...(entityDraft.id !== null ? { id: entityDraft.id } : {}),
        name,
        kind: entityDraft.kind,
        aliases: parseAliases(entityDraft.aliases),
        summary: entityDraft.summary.trim(),
      })
      if (!result.ok) throw new Error(errText(result.error))
      setEntityDraft(null)
    }, '已保存实体。')
  }


  async function removeEntity(entity: MemoryEntity): Promise<void> {
    await run(async () => {
      const result = await memory.removeEntity(entity.id)
      if (!result.ok) throw new Error(errText(result.error))
      if (!result.value) throw new Error('未找到该实体')
      if (openEntityId === entity.id) {
        setOpenEntityId(null)
        setEntityEdges([])
      }
    }, '已删除实体。')
  }


  /** 展开 / 收起实体的关联记忆：展开时按需拉这个实体相连的边。 */
  async function toggleEntityMemories(id: string): Promise<void> {
    if (openEntityId === id) {
      setOpenEntityId(null)
      setEntityEdges([])
      return
    }
    setOpenEntityId(id)
    setEntityEdges([])
    await run(async () => {
      const result = await memory.listEdges({ node: { kind: 'entity', id } })
      if (!result.ok) throw new Error(errText(result.error))
      setEntityEdges(result.value)
    })
  }


  /** 取一条记忆的关联视图（详情弹窗的「关联」区块）。 */
  async function loadNeighborhood(id: string): Promise<void> {
    const result = await memory.neighborhood(id)
    if (result.ok) setNeighborhood(result.value ?? null)
    else setError(errText(result.error))
  }


  /** 打开详情：先用列表里的快照立即渲染，再补取关联数据。 */
  async function openDetail(record: MemoryRecord): Promise<void> {
    setError('')
    setNotice('')
    setDetail(record)
    setNeighborhood(null)
    setLinkDraft(null)
    await run(async () => { await loadNeighborhood(record.id) })
  }


  /** 关掉详情：连关联数据一起清掉，免得下次打开先闪一眼上一条的边。 */
  function closeDetail(): void {
    setDetail(null)
    setNeighborhood(null)
    setLinkDraft(null)
  }


  /** 从关联里的记忆节点跳到它的详情（可能不在当前列表，故整条取回）。 */
  async function jumpToMemory(id: string): Promise<void> {
    setError('')
    setNotice('')
    setLinkDraft(null)
    await run(async () => {
      const result = await memory.neighborhood(id)
      if (!result.ok) throw new Error(errText(result.error))
      if (result.value === undefined) throw new Error('未找到该记忆')
      setDetail(result.value.memory)
      setNeighborhood(result.value)
    })
  }


  /** 断开一条关联。 */
  async function removeEdge(edge: MemoryEdge): Promise<void> {
    if (detail === null) return
    const memoryId = detail.id
    await run(async () => {
      const result = await memory.unlink(edge.id)
      if (!result.ok) throw new Error(errText(result.error))
      if (!result.value) throw new Error('未找到该关联')
      await loadNeighborhood(memoryId)
      setNotice('已断开关联。')
    })
  }


  /** 从详情弹窗连一条边：from 固定是当前这条记忆，to 由表单指定。 */
  async function submitLink(): Promise<void> {
    if (detail === null || linkDraft === null) return
    const toId = linkDraft.toId.trim()
    if (toId === '') {
      setError(linkDraft.toKind === 'memory' ? '请先选择或填写目标记忆' : '请先选择或填写目标实体')
      return
    }
    const memoryId = detail.id
    const note = linkDraft.note.trim()
    await run(async () => {
      const result = await memory.link({
        from: { kind: 'memory', id: memoryId },
        to: { kind: linkDraft.toKind, id: toId },
        relation: linkDraft.relation,
        ...(note !== '' ? { note } : {}),
      })
      if (!result.ok) throw new Error(errText(result.error))
      await loadNeighborhood(memoryId)
      setLinkDraft(null)
      setNotice('已建立关联。')
    })
  }


  async function copyRecord(record: MemoryRecord): Promise<void> {
    await run(async () => {
      try {
        await navigator.clipboard.writeText(record.title + '\n\n' + record.content)
      } catch {
        throw new Error('复制失败：浏览器拒绝了剪贴板访问，可手动选中正文复制')
      }
    }, '已复制全文。')
  }

  return {
    draft,
    setDraft,
    detail,
    setDetail,
    entityDraft,
    setEntityDraft,
    openEntityId,
    setOpenEntityId,
    entityEdges,
    setEntityEdges,
    neighborhood,
    setNeighborhood,
    linkDraft,
    setLinkDraft,
    startEdit,
    startCreate,
    saveDraft,
    startCreateEntity,
    startEditEntity,
    saveEntityDraft,
    removeEntity,
    toggleEntityMemories,
    loadNeighborhood,
    openDetail,
    closeDetail,
    jumpToMemory,
    removeEdge,
    submitLink,
    copyRecord,
  }
}
