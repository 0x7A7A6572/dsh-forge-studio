import { useCallback, useEffect, useState } from 'react'
import { errText, memoryLinkCounts, entityMentionCounts, SCOPE_LABELS } from '../core/memory-model.ts'
import { IMPORT_PROMPT_TEXT } from '../../types.ts'
import type { MemoryTab } from '../core/memory-section-types.ts'
import type { MemoryAuditEntry, MemoryConfig, MemoryConflict, MemoryEdge, MemoryEntity, MemoryProjectSummary, MemoryRawDocument, MemoryRawId, MemoryRecord, MemoryStats } from '../../types.ts'
import type { MemoryRemote } from '../core/remote.ts'
import { useMemoryDetail } from './useMemoryDetail.ts'

export function useSettingsSection(memory: MemoryRemote) {
  const [config, setConfig] = useState<MemoryConfig | null>(null)
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [projects, setProjects] = useState<readonly MemoryProjectSummary[]>([])
  const [records, setRecords] = useState<readonly MemoryRecord[]>([])
  const [tab, setTab] = useState<MemoryTab>('global')
  const [projectPath, setProjectPath] = useState('')
  const [keyword, setKeyword] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [resetOpen, setResetOpen] = useState(false)
  /** 详情抽屉：当前查看的那条（快照，操作后即关闭，避免看到过期内容）。 */
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
  /** 展开查看「关联记忆」的实体 id 与它那一次 listEdges 的结果。 */
  /** 详情弹窗的关联视图与「连一条边」表单。 */
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

  // 详情面（草稿 / 详情 / 实体关联）自成一块，run 与 setError/setNotice 单向传下去。
  const detailApi = useMemoryDetail(memory, run, tab, projectPath, setError, setNotice)
  // 父自己也要动其中几个态（切页签要清编辑态），所以按名取回来。
  const { draft, setDraft, setEntityDraft, setOpenEntityId, setEntityEdges } = detailApi

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

  /** 切页签：顺手清掉编辑态，免得弹窗开着、内容已经换了页。 */
  function switchTab(next: MemoryTab): void {
    setTab(next)
    setDraft(null)
    setEntityDraft(null)
    setOpenEntityId(null)
    setEntityEdges([])
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

  /* ---------- wiki 图层：详情里的关联 ---------- */

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
    importOpen,
    setImportOpen,
    importText,
    setImportText,
    importMode,
    setImportMode,
    resetOpen,
    setResetOpen,
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
    detailApi,
    patchConfig,
    copyImportPrompt,
    openModal,
    switchTab,
    toggleFlag,
    removeRecord,
    copyExport,
    runTidy,
    runRebuildEdges,
    runImport,
    loadLedger,
    openLedger,
    showRawText,
    reingestRaw,
    removeRaw,
    runReset,
    counts,
    activeProjectLabel,
    linkCounts,
    mentionCounts,
    onMoreSelect,
    ...detailApi,
  }
}
