import { useCallback, useEffect, useRef, useState } from 'react'
import { errText, memoryLinkCounts, entityMentionCounts, SCOPE_LABELS } from '../core/memory-model.ts'
import { IMPORT_PROMPT_TEXT } from '../../types.ts'
import type { Feedback, FeedbackTone, GraphLocateTarget, MemoryTab } from '../core/memory-section-types.ts'
import { graphNodeId } from '../core/graph-option.ts'
import type { MemoryAuditEntry, MemoryConfig, MemoryConflict, MemoryEdge, MemoryEntity, MemoryModelGroup, MemoryProjectSummary, MemoryRawDocument, MemoryRawId, MemoryRecord, MemoryScope, MemoryStats } from '../../types.ts'
import type { MemoryRemote } from '../core/remote.ts'
import { bundleFileName, downloadText, peekBundle, readTextFile } from '../core/bundle-file.ts'
import type { BundlePeek } from '../core/bundle-file.ts'
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
  const [graphOpen, setGraphOpen] = useState(false)
  const [graphScope, setGraphScope] = useState<MemoryScope>('global')
  const [graphProjectPath, setGraphProjectPath] = useState('')
  const [graphRecords, setGraphRecords] = useState<readonly MemoryRecord[]>([])
  /** 定位请求：图谱收到就点亮对应节点（seq 是重放键，同一个节点再点也要亮）。 */
  const [graphFocus, setGraphFocus] = useState<{ id: string; seq: number } | undefined>(undefined)
  const graphFocusSeq = useRef(0)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [raws, setRaws] = useState<readonly MemoryRawDocument[]>([])
  const [audits, setAudits] = useState<readonly MemoryAuditEntry[]>([])
  const [rawText, setRawText] = useState<Record<string, string>>({})
  const [conflicts, setConflicts] = useState<readonly MemoryConflict[]>([])
  const [modelGroups, setModelGroups] = useState<readonly MemoryModelGroup[]>([])
  const [entities, setEntities] = useState<readonly MemoryEntity[]>([])
  const [edges, setEdges] = useState<readonly MemoryEdge[]>([])
  const [busy, setBusy] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  /** 隐藏的文件框：选完同一个文件也要能再次触发，所以读后清空 value。 */
  const bundleInputRef = useRef<HTMLInputElement | null>(null)
  const [bundleImportOpen, setBundleImportOpen] = useState(false)
  const [bundleName, setBundleName] = useState('')
  const [bundleText, setBundleText] = useState('')
  const [bundlePeek, setBundlePeek] = useState<BundlePeek | null>(null)
  const [bundleMode, setBundleMode] = useState<'merge' | 'replace'>('merge')
  /** 反馈只有一条：新的顶掉旧的，视图把它画成 Toast。 */
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const feedbackSeq = useRef(0)

  const showFeedback = useCallback((tone: FeedbackTone, text: string) => {
    // '' 是旧的「清空」写法，调用点照旧。
    if (text === '') {
      setFeedback((current) => (current?.tone === tone ? null : current))
      return
    }
    feedbackSeq.current += 1
    setFeedback({ seq: feedbackSeq.current, text, tone })
  }, [])

  const setError = useCallback((text: string) => { showFeedback('error', text) }, [showFeedback])
  const setNotice = useCallback((text: string) => { showFeedback('notice', text) }, [showFeedback])
  const dismissFeedback = useCallback(() => { setFeedback(null) }, [])

  const refreshOverview = useCallback(async () => {
    const [c, s, p, k, m] = await Promise.all([
      memory.getConfig(),
      memory.stats(),
      memory.projects(),
      memory.getConflicts(),
      memory.models(),
    ])
    setModelGroups(m.ok ? m.value : [])
    if (c.ok) setConfig(c.value)
    else setError(errText(c.error))
    if (s.ok) setStats(s.value)
    else setError(errText(s.error))
    if (p.ok) setProjects(p.value)
    else setError(errText(p.error))
    if (k.ok) setConflicts(k.value)
    else setError(errText(k.error))
  }, [memory, setError])

  const refreshRecords = useCallback(async () => {
    // 实体页签不筛选作用域：拉全量（含归档），供「实体 → 关联记忆」内存映射。
    const query: Record<string, unknown> = tab === 'entity' ? { includeArchived: true } : { scope: tab }
    if (tab === 'project' && projectPath !== '') query.projectPath = projectPath
    if (tab !== 'entity' && keyword.trim() !== '') query.keyword = keyword.trim()
    if (tab !== 'entity' && includeArchived) query.includeArchived = true
    const result = await memory.list(query)
    if (result.ok) setRecords(result.value)
    else setError(errText(result.error))
  }, [memory, tab, projectPath, keyword, includeArchived, setError])

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
  }, [memory, setError])

  const loadGraphRecords = useCallback(async (scope: MemoryScope, path: string): Promise<void> => {
    const query: Record<string, unknown> = { scope }
    if (scope === 'project' && path !== '') query.projectPath = path
    if (includeArchived) query.includeArchived = true
    const result = await memory.list(query)
    if (result.ok) setGraphRecords(result.value)
    else setError(errText(result.error))
  }, [memory, includeArchived, setError])

  useEffect(() => { void refreshOverview() }, [refreshOverview])
  useEffect(() => { void refreshRecords() }, [refreshRecords])
  useEffect(() => { void refreshWiki() }, [refreshWiki])

  async function run(action: () => Promise<unknown>, done?: string): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await action()
      await refreshOverview()
      await refreshRecords()
      await refreshWiki()
      if (graphOpen) await loadGraphRecords(graphScope, graphProjectPath)
      if (done !== undefined) setNotice(done)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const detailApi = useMemoryDetail(memory, run, tab, projectPath, setError, setNotice)
  const { draft, setDraft, setEntityDraft, setOpenEntityId, setEntityEdges } = detailApi

  function patchConfig(patch: Parameters<MemoryRemote['setConfig']>[0]): void {
    void run(async () => { await memory.setConfig(patch) })
  }

  async function copyImportPrompt(): Promise<void> {
    try {
      await navigator.clipboard.writeText(IMPORT_PROMPT_TEXT)
      setNotice('提示词已复制。')
    } catch {
      setError('复制失败，请手动选中提示词复制。')
    }
  }

  function openModal(open: (value: boolean) => void): void {
    setError('')
    setNotice('')
    open(true)
  }

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

  async function runRebuildEdges(): Promise<void> {
    await run(async () => {
      const result = await memory.rebuildEdges()
      if (!result.ok) throw new Error(errText(result.error))
      setNotice('已重建关联：新增 ' + result.value.added + ' / 清理 ' + result.value.removed + '。')
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

  function openGraph(): void {
    // 从实体页签进来时看全局 —— 图谱只分全局与项目两种。
    const scope: MemoryScope = tab === 'project' ? 'project' : 'global'
    const path = scope === 'project' ? projectPath : ''
    setGraphScope(scope)
    setGraphProjectPath(path)
    setGraphOpen(true)
    void loadGraphRecords(scope, path)
  }

  function closeGraph(): void {
    setGraphOpen(false)
  }

  function switchGraphScope(scope: MemoryScope): void {
    const path = scope === 'project' ? (graphProjectPath !== '' ? graphProjectPath : projectPath) : ''
    setGraphScope(scope)
    setGraphProjectPath(path)
    void loadGraphRecords(scope, path)
  }

  function changeGraphProject(path: string): void {
    setGraphProjectPath(path)
    void loadGraphRecords('project', path)
  }

  function locateGraphNode(target: GraphLocateTarget): void {
    if (target.kind === 'memory') {
      const scope: MemoryScope = target.scope ?? 'global'
      const path = scope === 'project' ? (target.projectPath ?? '') : ''
      setGraphScope(scope)
      setGraphProjectPath(path)
      void loadGraphRecords(scope, path)
      setGraphOpen(true)
    } else if (!graphOpen) {
      openGraph()
    }
    detailApi.closeDetail()
    graphFocusSeq.current += 1
    setGraphFocus({ id: graphNodeId(target.kind, target.id), seq: graphFocusSeq.current })
  }

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

  const linkCounts = memoryLinkCounts(edges)
  const mentionCounts = entityMentionCounts(edges)



  async function exportBundleFile(): Promise<void> {
    await run(async () => {
      const result = await memory.exportBundle()
      if (!result.ok) throw new Error(errText(result.error))
      const name = bundleFileName()
      downloadText(name, JSON.stringify(result.value, null, 2))
      setNotice('已导出 ' + name + '（记忆 ' + result.value.records.length + ' 条）。')
    })
  }

  async function pickBundleFile(file: File | undefined): Promise<void> {
    if (file === undefined) return
    try {
      const text = await readTextFile(file)
      const peek = peekBundle(text)
      setBundleText(text)
      setBundlePeek(peek)
      setBundleName(file.name)
      setError('')
    } catch (e) {
      setBundleText('')
      setBundlePeek(null)
      setBundleName(file.name)
      setError(errText(e))
    }
  }

  function openBundleImport(): void {
    setBundleName('')
    setBundleText('')
    setBundlePeek(null)
    setBundleMode('merge')
    openModal(setBundleImportOpen)
  }

  /** 解析放在这里而不是 pick 时：保证解析的文本就是最终提交的那份。 */
  async function runBundleImport(): Promise<void> {
    if (bundleText === '') {
      setError('请先选择一个备份文件')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(bundleText) as unknown
    } catch {
      setError('备份文件不是合法 JSON')
      return
    }
    await run(async () => {
      const result = await memory.importBundle({ bundle: parsed, mode: bundleMode })
      if (!result.ok) throw new Error(errText(result.error))
      setBundleImportOpen(false)
      setBundleText('')
      setBundleName('')
      setBundlePeek(null)
      setNotice('导入完成：新增 ' + result.value.added + ' 条，更新 ' + result.value.merged + ' 条'
        + (result.value.removed > 0 ? '，清空 ' + result.value.removed + ' 条' : '') + '。')
    })
  }

  function onMoreSelect(id: string): void {
    setMoreOpen(false)
    if (id === 'tidy') void runTidy()
    else if (id === 'rebuild') void runRebuildEdges()
    else if (id === 'export-file') void exportBundleFile()
    else if (id === 'import-file') openBundleImport()
    else if (id === 'copy') void copyExport()
    else if (id === 'graph') openGraph()
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
    modelGroups,
    entities,
    setEntities,
    edges,
    setEdges,
    busy,
    setBusy,
    moreOpen,
    setMoreOpen,
    bundleImportOpen,
    setBundleImportOpen,
    bundleName,
    bundleInputRef,
    setBundleName,
    bundleText,
    setBundleText,
    bundlePeek,
    setBundlePeek,
    bundleMode,
    setBundleMode,
    feedback,
    dismissFeedback,
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
    graphOpen,
    graphScope,
    graphProjectPath,
    graphRecords,
    graphFocus,
    locateGraphNode,
    openGraph,
    closeGraph,
    switchGraphScope,
    changeGraphProject,
    counts,
    activeProjectLabel,
    linkCounts,
    mentionCounts,
    exportBundleFile,
    pickBundleFile,
    openBundleImport,
    runBundleImport,
    onMoreSelect,
    ...detailApi,
  }
}
