/**
 * 记忆分区的全部状态与动作（相当于 Vue SFC 的 <script setup>）。
 *
 * 视图只读它的返回值，自己永远不碰 remote、不写 await —— 想在界面上看到什么，
 * 先在这里找到对应的名字。
 *
 * 返回的是**平铺对象**：视图那边用同名解构接住，所以 JSX 里写的一直是 `records`
 * 而不是 `state.records`，拆分前后一个字都不用改。
 */

import { useCallback, useEffect, useState } from 'react'
import { errText, parseAliases, memoryLinkCounts, entityMentionCounts, SCOPE_LABELS } from '../core/memory-model.ts'
import { IMPORT_PROMPT_TEXT } from '../../types.ts'
import type { MemoryTab, Draft, EntityDraft, LinkDraft } from '../core/memory-section-types.ts'
import type { MemoryAuditEntry, MemoryConfig, MemoryConflict, MemoryEdge, MemoryEntity, MemoryId, MemoryNeighborhood, MemoryProjectSummary, MemoryRawDocument, MemoryRawId, MemoryRecord, MemoryStats } from '../../types.ts'
import type { MemoryRemote } from '../core/remote.ts'

/**
 * 记忆分区的全部状态与动作（相当于 Vue SFC 的 <script setup>）。
 *
 * 视图只读它的返回值，自己永远不碰 remote、不写 await —— 想在界面上看到什么，
 * 先在这里找到对应的名字。
 *
 * 返回的是**平铺对象**：视图那边用同名解构接住，所以 JSX 里写的一直是 `records`
 * 而不是 `state.records`，拆分前后一个字都不用改。
 */


export function useSettingsSection(memory: MemoryRemote) {
  const [config, setConfig] = useState<MemoryConfig | null>(null)
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [projects, setProjects] = useState<readonly MemoryProjectSummary[]>([])
  const [records, setRecords] = useState<readonly MemoryRecord[]>([])
  const [tab, setTab] = useState<MemoryTab>('global')
  const [projectPath, setProjectPath] = useState('')
  const [keyword, setKeyword] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [resetOpen, setResetOpen] = useState(false)
  /** 详情抽屉：当前查看的那条（快照，操作后即关闭，避免看到过期内容）。 */
  const [detail, setDetail] = useState<MemoryRecord | null>(null)
  /** 沉淀面板：原文留档 + 后台调用审计。 */
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [raws, setRaws] = useState<readonly MemoryRawDocument[]>([])
  const [audits, setAudits] = useState<readonly MemoryAuditEntry[]>([])
  /** 展开过的原文全文（按留档 id 缓存，列表本身不带全文）。 */
  const [rawText, setRawText] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<readonly MemoryConflict[]>([])
  /** wiki 图层：实体目录 + 全量边（关联数、被提及数都在内存里聚合）。 */
  const [entities, setEntities] = useState<readonly MemoryEntity[]>([])
  const [edges, setEdges] = useState<readonly MemoryEdge[]>([])
  /** 实体表单草稿（id 为 null 表示新建）。 */
  const [entityDraft, setEntityDraft] = useState<EntityDraft | null>(null)
  /** 展开查看「关联记忆」的实体 id 与它那一次 listEdges 的结果。 */
  const [openEntityId, setOpenEntityId] = useState<string | null>(null)
  const [entityEdges, setEntityEdges] = useState<readonly MemoryEdge[]>([])
  /** 详情弹窗的关联视图与「连一条边」表单。 */
  const [neighborhood, setNeighborhood] = useState<MemoryNeighborhood | null>(null)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refreshOverview = useCallback(async () => {
    const [c, s, p, k] = await Promise.all([
      memory.getConfig(),
      memory.stats(),
      memory.projects(),
      memory.getConflicts(),
    ])
    if (c.ok) setConfig(c.value)
    else setError(errText(c.error))
    if (s.ok) setStats(s.value)
    else setError(errText(s.error))
    if (p.ok) setProjects(p.value)
    else setError(errText(p.error))
    if (k.ok) setConflicts(k.value)
    else setError(errText(k.error))
  }, [memory])

  const refreshRecords = useCallback(async () => {
    // 实体页签不按作用域筛选：拉全量条目（含归档），供「实体 → 关联记忆」在内存里映射。
    const query: Record<string, unknown> = tab === 'entity' ? { includeArchived: true } : { scope: tab }
    if (tab === 'project' && projectPath !== '') query.projectPath = projectPath
    if (tab !== 'entity' && keyword.trim() !== '') query.keyword = keyword.trim()
    if (tab !== 'entity' && includeArchived) query.includeArchived = true
    const result = await memory.list(query)
    if (result.ok) setRecords(result.value)
    else setError(errText(result.error))
  }, [memory, tab, projectPath, keyword, includeArchived])

  /** wiki 图层的取数：实体目录 + 全量边（一次拉全，关联数在内存里聚合）。 */
  const refreshWiki = useCallback(async () => {
    const [entityResult, edgeResult] = await Promise.all([
      // 远程端点有形参 arity 校验：不传对象会在客户端直接抛「expected 1 argument(s), got 0」，
      // 传空对象才是「不过滤、拉全量」。
      memory.listEntities({}),
      memory.listEdges({}),
    ])
    if (entityResult.ok) setEntities(entityResult.value)
    else setError(errText(entityResult.error))
    if (edgeResult.ok) setEdges(edgeResult.value)
    else setError(errText(edgeResult.error))
  }, [memory])

  useEffect(() => { void refreshOverview() }, [refreshOverview])
  useEffect(() => { void refreshRecords() }, [refreshRecords])
  useEffect(() => { void refreshWiki() }, [refreshWiki])

  /** 统一包一层 busy/error 处理并刷新。 */
  async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await action()
      await refreshOverview()
      await refreshRecords()
      await refreshWiki()
      if (done !== undefined) setNotice(done)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * 改一条设置项。九个开关/滑杆共用这一个入口 —— 视图那边只报「把哪个字段改成什么」，
   * busy、错误、三块刷新都由 run 统一兜住。
   */
  function patchConfig(patch: Parameters<MemoryRemote['setConfig']>[0]): void {
    void run(async () => { await memory.setConfig(patch) })
  }

  /** 复制导入提示词（拿去喂别的 AI）。剪贴板可能被浏览器拒绝，所以两条分支都给提示。 */
  async function copyImportPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT_TEXT)
      setNotice('提示词已复制。')
    } catch {
      setError('复制失败，请手动选中提示词复制。')
    }
  }

  /** 打开弹窗时清掉上一轮的提示，避免旧消息串进弹窗。 */
  function openModal(open: (value: boolean) => void): void {
    setError('')
    setNotice('')
    open(true)
  }

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

  /** 切页签：顺手清掉编辑态，免得弹窗开着、内容已经换了页。 */
  function switchTab(next: MemoryTab): void {
    setTab(next)
    setDraft(null)
    setEntityDraft(null)
    setOpenEntityId(null)
    setEntityEdges([])
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

  async function toggleFlag(record: MemoryRecord, patch: { pinned?: boolean; archived?: boolean }): Promise<void> {
    await run(async () => {
      const result = await memory.updateMemory(record.id, patch)
      if (!result.ok) throw new Error(errText(result.error))
    })
  }

  async function removeRecord(record: MemoryRecord): Promise<void> {
    await run(async () => {
      const result = await memory.removeMemory(record.id)
      if (!result.ok) throw new Error(errText(result.error))
      if (!result.value) throw new Error('未找到该记忆')
      if (draft?.id === record.id) setDraft(null)
    }, '已删除。')
  }

  async function copyExport(): Promise<void> {
    if (tab === 'entity') return
    await run(async () => {
      const result = await memory.exportText(tab, tab === 'project' ? projectPath : undefined)
      if (!result.ok) throw new Error(errText(result.error))
      try {
        await navigator.clipboard.writeText(result.value)
      } catch {
        throw new Error('复制失败：浏览器拒绝了剪贴板访问，可手动选中条目内容复制')
      }
    }, '已复制当前记忆的 Markdown，可粘贴到别的 AI 工具。')
  }

  async function runTidy(): Promise<void> {
    await run(async () => {
      const result = await memory.tidy()
      if (!result.ok) throw new Error(errText(result.error))
      setNotice('整理完成：合并 ' + result.value.merged + ' 组，回收 ' + result.value.removed + ' 条。')
    })
  }

  /** 重建自动边：共享实体的记忆两两相连，并清掉不再成立的自动边。 */
  async function runRebuildEdges(): Promise<void> {
    await run(async () => {
      const result = await memory.rebuildEdges()
      if (!result.ok) throw new Error(errText(result.error))
      setNotice('已重建关联：新增 ' + result.value.added + ' / 清理 ' + result.value.removed + '。')
    })
  }

  /* ---------- wiki 图层：实体 ---------- */

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

  /* ---------- wiki 图层：详情里的关联 ---------- */

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

  async function runImport(): Promise<void> {
    if (tab === 'entity') return
    if (importText.trim() === '') {
      setError('请先粘贴要导入的内容')
      return
    }
    if (tab === 'project' && projectPath === '') {
      setError('导入到项目记忆前，请先在下方选择目标项目')
      return
    }
    await run(async () => {
      const result = await memory.importText({
        text: importText,
        scope: tab,
        ...(tab === 'project' ? { projectPath } : {}),
        mode: importMode,
      })
      if (!result.ok) throw new Error(errText(result.error))
      setImportOpen(false)
      setImportText('')
      setNotice(
        '导入完成：新增 ' + result.value.added + ' 条，合并 ' + result.value.merged
        + ' 条，跳过 ' + result.value.skipped + ' 条'
        + (result.value.removed > 0 ? '，清空 ' + result.value.removed + ' 条' : '') + '。',
      )
    })
  }

  /** 拉沉淀面板的两段数据：原文留档（不带全文）+ 后台调用审计。 */
  async function loadLedger(): Promise<void> {
    const [rawResult, auditResult] = await Promise.all([
      memory.rawDocuments({ includeText: false, limit: 100 }),
      memory.audits({ limit: 50 }),
    ])
    if (rawResult.ok) setRaws(rawResult.value)
    else setError(errText(rawResult.error))
    if (auditResult.ok) setAudits(auditResult.value)
    else setError(errText(auditResult.error))
  }

  function openLedger(): void {
    openModal(setLedgerOpen)
    setRawText({})
    void run(loadLedger)
  }

  /** 展开某份原文的全文（第一次点才取，避免列表传输整库转录）。 */
  async function showRawText(id: MemoryRawId): Promise<void> {
    await run(async () => {
      const result = await memory.getRawDocument(id)
      if (!result.ok) throw new Error(errText(result.error))
      if (result.value === undefined) throw new Error('未找到该原文留档')
      setRawText((current) => ({ ...current, [id]: result.value?.text ?? '' }))
    })
  }

  async function reingestRaw(id: MemoryRawId): Promise<void> {
    await run(async () => {
      const result = await memory.reingest(id)
      if (!result.ok) throw new Error(errText(result.error))
      await loadLedger()
      setNotice('已重新抽取：新增 ' + result.value.added + ' 条，合并 ' + result.value.merged + ' 条。')
    })
  }

  async function removeRaw(id: MemoryRawId, title: string): Promise<void> {
    await run(async () => {
      const result = await memory.removeRawDocument(id)
      if (!result.ok) throw new Error(errText(result.error))
      if (!result.value) throw new Error('未找到该原文留档')
      await loadLedger()
      setNotice('已删除原文留档「' + title + '」（已抽出的记忆条目保持不动）。')
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

  async function runReset(): Promise<void> {
    if (tab === 'entity') return
    if (tab === 'project' && projectPath === '') {
      setError('请先选择要重置的项目')
      return
    }
    await run(async () => {
      const result = await memory.reset(tab, tab === 'project' ? projectPath : undefined)
      if (!result.ok) throw new Error(errText(result.error))
      setResetOpen(false)
      setNotice('已重置 ' + SCOPE_LABELS[tab] + '：清空 ' + result.value + ' 条。')
    })
  }

  const counts: Record<MemoryTab, number> = {
    global: stats?.global ?? 0,
    project: stats?.project ?? 0,
    entity: stats?.entities ?? 0,
  }
  const activeProjectLabel = projects.find((item) => item.path === projectPath)?.label ?? projectPath

  /** 内存聚合：每条记忆的关联数 / 每个实体的被提及数（只依赖那一次 listEdges 的结果）。 */
  const linkCounts = memoryLinkCounts(edges)
  const mentionCounts = entityMentionCounts(edges)


  /** 下拉选中 → 关菜单再执行原动作（顺序：先关，免得动作打开弹窗后菜单还浮在上层）。 */
  function onMoreSelect(id: string): void {
    setMoreOpen(false)
    if (id === 'tidy') void runTidy()
    else if (id === 'rebuild') void runRebuildEdges()
    else if (id === 'copy') void copyExport()
    else if (id === 'import') openModal(setImportOpen)
    else if (id === 'reset') openModal(setResetOpen)
  }

  return {
    config,
    setConfig,
    stats,
    setStats,
    projects,
    setProjects,
    records,
    setRecords,
    tab,
    setTab,
    projectPath,
    setProjectPath,
    keyword,
    setKeyword,
    includeArchived,
    setIncludeArchived,
    draft,
    setDraft,
    importOpen,
    setImportOpen,
    importText,
    setImportText,
    importMode,
    setImportMode,
    resetOpen,
    setResetOpen,
    detail,
    setDetail,
    ledgerOpen,
    setLedgerOpen,
    raws,
    setRaws,
    audits,
    setAudits,
    rawText,
    setRawText,
    conflicts,
    setConflicts,
    entities,
    setEntities,
    edges,
    setEdges,
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
    busy,
    setBusy,
    moreOpen,
    setMoreOpen,
    error,
    setError,
    notice,
    setNotice,
    refreshOverview,
    refreshRecords,
    refreshWiki,
    run,
    patchConfig,
    copyImportPrompt,
    openModal,
    startEdit,
    startCreate,
    switchTab,
    saveDraft,
    toggleFlag,
    removeRecord,
    copyExport,
    runTidy,
    runRebuildEdges,
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
    runImport,
    loadLedger,
    openLedger,
    showRawText,
    reingestRaw,
    removeRaw,
    copyRecord,
    runReset,
    counts,
    activeProjectLabel,
    linkCounts,
    mentionCounts,
    onMoreSelect,
  }
}
