/**
 * 记忆 —— dsh 设置面板里的一级分区（对齐 Agent 预设分区的布局语言）。
 *
 * 结构：标题 + 引言 → 记忆开关块（生成对话记忆 / 自动注入 / 注入条数与门槛）
 * → 「管理记忆」工具条（新增 / 沉淀 / 更多 ▾ —— 整理、重建关联、复制导出、导入、重置
 *   都是维护类低频操作，收进下拉，工具条只占三个位置）
 * → 页签（全局记忆 / 项目记忆 / 实体，带计数）→ 记忆条目列表（可直接改正文）
 * → 详情弹窗里的「关联」区块（wiki 图层：实体 + 边，可连边 / 断边）。
 *
 * 读写全部走 Typert remote（ctx.remote.memory.*）；开关写的是设置命名空间的用户层，
 * 与插件设置卡片同源，改完即时生效。
 */

import { useCallback, useEffect, useState } from 'react'
import { Button, IconArchiveOutline20, IconChecklistOutline14, IconCopyOutline16, IconDownloadOutline16, IconEditOutline16, IconEllipsisOutline16, IconListPenOutline16, IconPlusOutline16, IconRefreshOutline16, IconTrashOutline16, Input, Menu, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { ChevronDown } from 'lucide-react'
import { MEMORY_TABS, TAB_LABELS, errText, timeText, durationText, ORIGIN_LABELS, AUDIT_KIND_LABELS, sourceLabel, parseAliases, entityKindClass, memoryLinkCounts, entityMentionCounts, linkedMemoryIds, SCOPE_LABELS, NODE_KIND_OPTIONS, RELATION_OPTIONS, IMPORTANCE_STEPS, CAPTURE_EVERY_STEPS, CAPTURE_TURNS_STEPS, CAPTURE_CHARS_STEPS, importanceLevelAt, IMPORT_MODE_OPTIONS } from '../../core/memory-model.ts'
import type { SettingsSectionProps, MemoryTab, Draft, EntityDraft, LinkDraft } from '../../core/memory-section-types.ts'
import { pluginVersion } from '../../../version.ts'
import { IMPORT_PROMPT_TEXT, MEMORY_CONFIG_BASE, MEMORY_ENTITY_KIND_LABELS, MEMORY_KIND_LABELS, importanceLabel } from '../../../types.ts'
import type { MemoryAuditEntry, MemoryConfig, MemoryConflict, MemoryEdge, MemoryEdgeRelation, MemoryEntity, MemoryId, MemoryNeighborhood, MemoryProjectSummary, MemoryRawDocument, MemoryRawId, MemoryRecord, MemoryStats } from '../../../types.ts'
import { ScaleSlider } from '../../components/ScaleSlider.tsx'
import { ModalFeedback } from '../../components/ModalFeedback.tsx'
import { SwitchRow } from '../../components/SwitchRow.tsx'
import { Segmented } from '../../components/Segmented.tsx'
import { MemoryDraftForm } from './components/MemoryDraftForm.tsx'
import { EntityDraftForm } from './components/EntityDraftForm.tsx'
import { EdgeList } from './components/EdgeList.tsx'
import styles from '../../styles/settings-section.module.css'

/** 记忆分区。 */
export function SettingsSection(props: SettingsSectionProps): JSX.Element {
  const memory = props.memory
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

  /** 单条记忆（正常态）。 */
  function renderRecord(record: MemoryRecord): JSX.Element {
    return (
      <div className={styles.item} key={record.id}>
        <div className={styles.itemHead}>
          <Pill>{MEMORY_KIND_LABELS[record.kind]}</Pill>
          <span className={styles.itemTitle} title={record.title}>{record.title}</span>
          <Pill>{importanceLabel(record.importance)}</Pill>
          <Pill>{'关联 ' + (linkCounts.get(record.id) ?? 0)}</Pill>
          <div className={styles.itemActions}>
            <Button
              variant="ghost" size="sm" title="查看元数据、关联与全文"
              onClick={() => { void openDetail(record) }}
            >
              详情
            </Button>
            <Button
              variant="ghost" size="sm" title={record.pinned ? '取消置顶' : '置顶'}
              onClick={() => { void toggleFlag(record, { pinned: !record.pinned }) }}
            >
              {record.pinned ? '已置顶' : '置顶'}
            </Button>
            <Button
              variant="ghost" size="sm" icon={<IconArchiveOutline20 size={14} />}
              title={record.archived ? '恢复' : '归档'}
              onClick={() => { void toggleFlag(record, { archived: !record.archived }) }}
            />
            <Button
              variant="ghost" size="sm" icon={<IconEditOutline16 size={14} />} title="编辑"
              onClick={() => { startEdit(record) }}
            />
            <Button
              variant="ghost" size="sm" icon={<IconTrashOutline16 size={14} />} title="删除"
              onClick={() => { void removeRecord(record) }}
            />
          </div>
        </div>
        {record.summary !== '' && <p className={styles.itemSummary}>{record.summary}</p>}
        {record.aliases.length > 0 && (
          <span className={styles.itemAlias}>{'别名：' + record.aliases.join(' / ')}</span>
        )}
        <p className={styles.itemBody}>{record.content}</p>
        {record.archived && <span className={styles.notice}>已归档（不参与注入，可随时恢复）</span>}
      </div>
    )
  }

  /** 实体页签：目录 + 每个实体关联的记忆（点开才取那一次的边）。 */
  function renderEntities(): JSX.Element {
    const linkedIds = openEntityId === null ? [] : linkedMemoryIds(entityEdges, openEntityId)
    const linkedRecords = linkedIds
      .map((id) => records.find((record) => record.id === id))
      .filter((record): record is MemoryRecord => record !== undefined)
    return (
      <>
        <div className={styles.head}>
          <span className={styles.headTitle}>实体目录</span>
          <div className={styles.toolbar}>
            <Button
              variant="ghost" size="sm" icon={<IconPlusOutline16 size={14} />}
              disabled={locked} onClick={startCreateEntity}
            >
              新建实体
            </Button>
          </div>
        </div>
        <p className={styles.rowDesc}>
          实体是 wiki 图层里的「名词」（项目 / 工具 / 人…）：记忆通过「关于 / 提及」挂到它上面，
          共享同一个实体的记忆会自动连成「相关」。写记忆时声明实体，或在这里手工维护。
        </p>
        <div className={styles.list}>
          {entities.map((entity) => (
            <div className={styles.item} key={entity.id}>
              <div className={styles.itemHead}>
                <span className={`${styles.entityBadge} ${styles[entityKindClass(entity.kind)]}`}>
                  {MEMORY_ENTITY_KIND_LABELS[entity.kind]}
                </span>
                <button
                  type="button"
                  className={`${styles.itemTitle} ${styles.entityName}`}
                  title="查看关联的记忆"
                  onClick={() => { void toggleEntityMemories(entity.id) }}
                >
                  {entity.name}
                </button>
                <span className={styles.rawMeta}>{'被提及 ' + (mentionCounts.get(entity.id) ?? 0) + ' 条'}</span>
                <div className={styles.itemActions}>
                  <Button
                    variant="ghost" size="sm" icon={<IconEditOutline16 size={14} />} title="编辑"
                    onClick={() => { startEditEntity(entity) }}
                  />
                  <Button
                    variant="ghost" size="sm" icon={<IconTrashOutline16 size={14} />} title="删除"
                    onClick={() => { void removeEntity(entity) }}
                  />
                </div>
              </div>
              {entity.aliases.length > 0 && (
                <span className={styles.itemAlias}>{'别名：' + entity.aliases.join(' / ')}</span>
              )}
              {entity.summary !== '' && <p className={styles.itemSummary}>{entity.summary}</p>}
              {openEntityId === entity.id && (
                <div className={styles.entityLinks}>
                  {linkedRecords.length === 0 ? (
                    <span className={styles.rowDesc}>还没有记忆关联到这个实体。</span>
                  ) : linkedRecords.map((record) => (
                    <button
                      key={record.id}
                      type="button"
                      className={styles.entityLink}
                      title="查看这条记忆"
                      onClick={() => { void openDetail(record) }}
                    >
                      {record.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {entities.length === 0 && (
            <div className={styles.empty}>
              还没有实体。写记忆时声明「这条讲的是谁」，或点上面的「新建实体」手工加一个。
            </div>
          )}
        </div>
      </>
    )
  }

  // 冲突 = 硬锁：本插件整体让位，界面把所有操作入口关掉，只留红色警告。
  const locked = conflicts.length > 0

  // 「生成对话记忆」关闭时宿主侧的自动提炼直接早退（src/agent/capture.ts），
  // 高级 · 自动提炼 里的参数一律不生效 —— 界面同步置灰，免得调了没反应。
  const captureOff = !locked && config !== null && !(config.autoCapture ?? false)

  /**
   * 「更多」下拉的条目。禁用条件与它们还是独立按钮时逐条对齐：
   * 实体页签没有记忆条目可整理 / 复制 / 重置 / 导入，重建关联对两个页签都成立。
   */
  const moreEntries: MenuEntry[] = [
    {
      id: 'tidy',
      label: '整理（合并重复）',
      icon: <IconChecklistOutline14 size={14} />,
      disabled: busy || locked || tab === 'entity',
    },
    {
      id: 'rebuild',
      label: '重建关联',
      icon: <IconRefreshOutline16 size={14} />,
      disabled: busy || locked,
    },
    {
      id: 'copy',
      label: '复制导出',
      icon: <IconCopyOutline16 size={14} />,
      disabled: busy || locked || tab === 'entity',
    },
    {
      id: 'import',
      label: '导入',
      icon: <IconDownloadOutline16 size={14} />,
      disabled: locked || tab === 'entity',
    },
    { type: 'separator', id: 'mem-more-separator' },
    {
      id: 'reset',
      label: '重置当前页签',
      icon: <IconTrashOutline16 size={14} />,
      danger: true,
      disabled: locked || tab === 'entity',
    },
  ]

  /** 下拉选中 → 关菜单再执行原动作（顺序：先关，免得动作打开弹窗后菜单还浮在上层）。 */
  function onMoreSelect(id: string): void {
    setMoreOpen(false)
    if (id === 'tidy') void runTidy()
    else if (id === 'rebuild') void runRebuildEdges()
    else if (id === 'copy') void copyExport()
    else if (id === 'import') openModal(setImportOpen)
    else if (id === 'reset') openModal(setResetOpen)
  }

  return (
    <div data-dsh-memory-ui="">
      <div className={styles.titleRow}>
        <h2 className={styles.title}>记忆</h2>
        <span className={styles.version} title="插件版本">v{pluginVersion()}</span>
      </div>
      <p className={styles.intro}>
        记住你的偏好和习惯，对话越多，它就越懂你。记忆内容本地保存，仅你本人可见。
      </p>

      {locked && (
        <div className={styles.warn} role="alert">
          <strong>检测到另一个记忆插件 —— 本插件已锁定，无法开启</strong>
          <p>
            已有插件占用了 {conflicts.map((conflict) => conflict.name).join('、')}。
            本插件已整体让位：不注册任何 memory 工具、不注入记忆、不自动生成对话记忆，
            下面所有开关也都不可操作。
          </p>
          <p>
            请在「设置 → 插件」里停用另一个记忆插件，然后重启 dsh，本插件会自动解锁。
          </p>
          {conflicts[0] !== undefined && conflicts[0].description !== '' && (
            <p className={styles.warnSrc}>对方工具描述：{conflicts[0].description}</p>
          )}
        </div>
      )}

      <div className={styles.card}>
        <SwitchRow
          title="生成对话记忆"
          desc="允许从对话中提取并记住相关上下文，以便在未来对话中提供更连贯、个性化的回应。"
          checked={locked ? false : (config?.autoCapture ?? false)}
          disabled={busy || config === null || locked}
          onChange={(next) => { void run(async () => { await memory.setConfig({ autoCapture: next }) }) }}
        />
        <SwitchRow
          title="开场自动注入"
          desc="新会话开局把「全局 + 当前工作区」的高重要性记忆注入上下文，不必等你再提醒。"
          checked={locked ? false : (config?.autoInject ?? false)}
          disabled={busy || config === null || locked}
          onChange={(next) => { void run(async () => { await memory.setConfig({ autoInject: next }) }) }}
        />
        <SwitchRow
          title="写入判定"
          desc="写入前如果附近已经有很像的记忆，先让模型判一次「新建 / 并进哪一条 / 不用记」（一次一行 JSON，失败就退化成新建）。关掉只走字面阈值。"
          checked={locked ? false : (config?.autoJudge ?? false)}
          disabled={busy || config === null || locked}
          onChange={(next) => { void run(async () => { await memory.setConfig({ autoJudge: next }) }) }}
        />
        <div className={styles.fieldRow}>
          <span>单次注入条数</span>
          <Input
            type="number" min={1} max={20}
            disabled={locked}
            value={String(config?.maxInjected ?? 6)}
            onChange={(event) => {
              const value = Number(event.currentTarget.value)
              if (!Number.isFinite(value)) return
              void run(async () => { await memory.setConfig({ maxInjected: Math.min(20, Math.max(1, Math.round(value))) }) })
            }}
          />
          <span>（达到门槛或被置顶的记忆才会注入）</span>
        </div>
        <div className={styles.segRow}>
          <span className={styles.segLabel}>注入门槛</span>
          <ScaleSlider
            label="注入门槛"
            value={config?.importanceThreshold ?? MEMORY_CONFIG_BASE.importanceThreshold}
            steps={IMPORTANCE_STEPS}
            disabled={busy || config === null || locked}
            describe={(value) => {
              const level = importanceLevelAt(value)
              return <><b>{level.label}</b>{' · '}{level.desc}</>
            }}
            valueText={(value) => {
              const level = importanceLevelAt(value)
              return level.label + '（' + value + '/5）'
            }}
            onChange={(importanceThreshold) => {
              void run(async () => { await memory.setConfig({ importanceThreshold }) })
            }}
          />
        </div>
        <details className={styles.advanced}>
          <summary>
            <span>高级 · 自动提炼</span>
            <ChevronDown className={styles.advancedChevron} size={14} aria-hidden="true" />
          </summary>
          {captureOff && (
            <p className={styles.advancedHint}>「生成对话记忆」已关闭，以下参数暂不生效。</p>
          )}
          <div className={captureOff ? `${styles.advancedBody} ${styles.advancedOff}` : styles.advancedBody}>
            <ScaleSlider
              label="提炼间隔"
              value={config?.captureEveryTurns ?? MEMORY_CONFIG_BASE.captureEveryTurns}
              steps={CAPTURE_EVERY_STEPS}
              disabled={busy || config === null || locked || captureOff}
              describe={(value) => (value === 1 ? '每个回合都提炼一次' : '每 ' + value + ' 个回合提炼一次')}
              valueText={(value) => value + ' 个回合一次'}
              onChange={(captureEveryTurns) => { void run(async () => { await memory.setConfig({ captureEveryTurns }) }) }}
            />
            <ScaleSlider
              label="转录轮数"
              value={config?.captureMaxTurns ?? MEMORY_CONFIG_BASE.captureMaxTurns}
              steps={CAPTURE_TURNS_STEPS}
              disabled={busy || config === null || locked || captureOff}
              describe={(value) => '只把最近 ' + value + ' 轮对话送去提炼'}
              valueText={(value) => value + ' 轮'}
              onChange={(captureMaxTurns) => { void run(async () => { await memory.setConfig({ captureMaxTurns }) }) }}
            />
            <ScaleSlider
              label="转录字符上限"
              value={config?.captureMaxChars ?? MEMORY_CONFIG_BASE.captureMaxChars}
              steps={CAPTURE_CHARS_STEPS}
              disabled={busy || config === null || locked || captureOff}
              describe={(value) => value + ' 字，超出保留尾部'}
              valueText={(value) => value + ' 字'}
              onChange={(captureMaxChars) => { void run(async () => { await memory.setConfig({ captureMaxChars }) }) }}
            />
            <SwitchRow
              title="助手回复也作为提炼素材"
              desc="默认关闭：结论类记忆由 agent 主动写入，避免每轮顺手把排查过程也记下来。"
              checked={config?.captureIncludeAssistant ?? false}
              disabled={busy || config === null || locked || captureOff}
              onChange={(next) => { void run(async () => { await memory.setConfig({ captureIncludeAssistant: next }) }) }}
            />
          </div>
        </details>
      </div>

      <div className={styles.head}>
        <span className={styles.headTitle}>管理记忆</span>
        <div className={styles.toolbar}>
          <Button variant="ghost" size="sm" icon={<IconPlusOutline16 size={14} />} disabled={locked || tab === 'entity'} onClick={startCreate}>新增</Button>
          <Button variant="ghost" size="sm" icon={<IconListPenOutline16 size={14} />} disabled={locked} onClick={openLedger}>沉淀</Button>
          <Menu
            anchor={(
              <Button
                variant="ghost"
                size="sm"
                icon={<IconEllipsisOutline16 size={14} />}
                disabled={locked}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => { setMoreOpen((open) => !open) }}
              >更多</Button>
            )}
            open={moreOpen}
            items={moreEntries}
            onSelect={onMoreSelect}
            onClose={() => { setMoreOpen(false) }}
            align="end"
            dense
          />
        </div>
      </div>

      <div className={styles.tabs} aria-label="记忆视图">
        {MEMORY_TABS.map((item) => (
          <button
            key={item}
            type="button"
            aria-current={tab === item ? 'true' : undefined}
            className={tab === item ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => { switchTab(item) }}
          >
            {TAB_LABELS[item]}
            <span className={styles.tabCount}>{counts[item]}</span>
          </button>
        ))}
      </div>

      <datalist id="mem-project-options">
        {projects.map((item) => <option key={item.path} value={item.path} />)}
      </datalist>

      {error !== '' && <span className={styles.error}>{error}</span>}
      {notice !== '' && <span className={styles.notice}>{notice}</span>}

      {tab === 'entity' ? renderEntities() : (
        <>
          <div className={styles.fieldRow}>
            {tab === 'project' && (
              <>
                <span>项目</span>
                <select
                  className={styles.select}
                  value={projectPath}
                  onChange={(event) => { setProjectPath(event.currentTarget.value); setDraft(null) }}
                >
                  <option value="">选择工作区…</option>
                  {projects.map((item) => (
                    <option key={item.path} value={item.path}>{item.label + '（' + item.count + ' 条）'}</option>
                  ))}
                </select>
              </>
            )}
            <Input
              className={styles.search}
              value={keyword}
              placeholder="搜索标题 / 正文 / 摘要 / 别名 / 标签"
              onChange={(event) => { setKeyword(event.currentTarget.value) }}
            />
            <label className={styles.fieldRow}>
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => { setIncludeArchived(event.currentTarget.checked) }}
              />
              <span>含已归档</span>
            </label>
            <span>共 {records.length} 条</span>
            {stats !== null && (
              <span>原文 {stats.raw} · 调用 {stats.audits}</span>
            )}
          </div>

          <div className={styles.list}>
            {records.map((record) => renderRecord(record))}
            {records.length === 0 && (
              <div className={styles.empty}>
                {tab === 'global'
                  ? '还没有全局记忆。和 AI 多聊几句，它会自动记住你的偏好；也可以点「新增」或「导入」手工添加。'
                  : '还没有这个项目的记忆。在对应工作区里对话后，与项目相关的习惯会自动记到这里。'}
              </div>
            )}
          </div>
        </>
      )}

      <Modal
        className={styles.modalWide}
        contentClassName={styles.modalScroll}
        open={importOpen}
        onClose={() => { setImportOpen(false) }}
        title="导入其他记忆"
        closeLabel="关闭"
        description={tab === 'project' ? '将导入到「项目记忆 · ' + (activeProjectLabel === '' ? '未选择项目' : activeProjectLabel) + '」' : '将导入到「全局记忆」'}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setImportOpen(false) }}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void runImport() }}>添加到记忆</Button>
          </>
        )}
      >
        <div className={styles.modalBody} data-dsh-memory-ui="">
          <span className={styles.rowTitle}>1. 复制以下提示词到其他 AI 对话中</span>
          <div className={styles.prompt}>{IMPORT_PROMPT_TEXT}</div>
          <div className={styles.itemActions}>
            <Button
              variant="outline" size="sm" icon={<IconCopyOutline16 size={14} />}
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(IMPORT_PROMPT_TEXT)
                    setNotice('提示词已复制。')
                  } catch {
                    setError('复制失败，请手动选中提示词复制。')
                  }
                })()
              }}
            >
              复制提示词
            </Button>
          </div>
          <span className={styles.rowTitle}>2. 将结果粘贴到下方，添加到记忆</span>
          <textarea
            className={styles.importArea}
            value={importText}
            placeholder="粘贴整理好的画像（分类标题 + [日期] - 内容 的格式会被自动识别）"
            onChange={(event) => { setImportText(event.currentTarget.value) }}
          />
          <Segmented
            label="导入方式"
            value={importMode}
            options={IMPORT_MODE_OPTIONS}
            disabled={busy}
            onChange={setImportMode}
          />
          <ModalFeedback error={error} notice={notice} />
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => { setResetOpen(false) }}
        title="重置记忆"
        closeLabel="关闭"
        description={'将清空「' + (tab === 'project' ? SCOPE_LABELS.project : SCOPE_LABELS.global) + (tab === 'project' && activeProjectLabel !== '' ? ' · ' + activeProjectLabel : '') + '」的全部记忆'}
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setResetOpen(false) }}>取消</Button>
            <Button variant="primary" disabled={busy} onClick={() => { void runReset() }}>确认重置</Button>
          </>
        )}
      >
        <div className={styles.modalBody} data-dsh-memory-ui="">
          <p className={styles.rowDesc}>
            这一步不可撤销。如果只是想暂时不让它参与注入，建议改用「归档」——
            归档的记忆仍保留在库里，随时可以恢复。
          </p>
          <span className={styles.notice}>当前作用域共 {records.length} 条（含筛选条件）。</span>
          <ModalFeedback error={error} notice={notice} />
        </div>
      </Modal>

      <Modal
        className={styles.modalWide}
        contentClassName={styles.modalScroll}
        open={detail !== null}
        onClose={closeDetail}
        title={detail?.title ?? '记忆详情'}
        closeLabel="关闭"
        description={detail === null || detail.scope === 'global'
          ? '全局记忆'
          : '项目记忆 · ' + detail.projectPath}
        footer={(
          <>
            <Button variant="ghost" onClick={closeDetail}>关闭</Button>
            <Button variant="ghost" disabled={busy || locked} onClick={() => { if (detail !== null) void copyRecord(detail) }}>复制全文</Button>
            <Button
              variant="ghost" disabled={busy || locked}
              onClick={() => {
                if (detail === null) return
                const target = detail
                setDetail(null)
                void toggleFlag(target, { archived: !target.archived })
              }}
            >
              {detail?.archived === true ? '恢复' : '归档'}
            </Button>
            <Button
              variant="ghost" disabled={locked}
              onClick={() => { if (detail === null) return; const target = detail; setDetail(null); startEdit(target) }}
            >
              编辑
            </Button>
            <Button
              variant="primary" disabled={busy || locked}
              onClick={() => { if (detail === null) return; const target = detail; setDetail(null); void removeRecord(target) }}
            >
              删除
            </Button>
          </>
        )}
      >
        <div className={styles.modalBody} data-dsh-memory-ui="">
          {detail !== null && (
            <>
              <div className={styles.meta}>
                <span className={styles.metaKey}>分类</span>
                <span className={styles.metaValue}>{MEMORY_KIND_LABELS[detail.kind]}</span>
                {detail.summary !== '' && (
                  <>
                    <span className={styles.metaKey}>摘要</span>
                    <span className={styles.metaValue}>{detail.summary}</span>
                  </>
                )}
                {detail.aliases.length > 0 && (
                  <>
                    <span className={styles.metaKey}>别名</span>
                    <span className={styles.metaValue}>{detail.aliases.join(' / ')}</span>
                  </>
                )}
                <span className={styles.metaKey}>重要性</span>
                <span className={styles.metaValue}>{importanceLabel(detail.importance) + '（' + detail.importance + '/5）'}</span>
                <span className={styles.metaKey}>来源</span>
                <span className={styles.metaValue}>{sourceLabel(detail.source)}</span>
                <span className={styles.metaKey}>创建</span>
                <span className={styles.metaValue}>{timeText(detail.createdAt)}</span>
                <span className={styles.metaKey}>更新</span>
                <span className={styles.metaValue}>{timeText(detail.updatedAt)}</span>
                <span className={styles.metaKey}>置顶 / 归档</span>
                <span className={styles.metaValue}>
                  {(detail.pinned ? '置顶' : '未置顶') + ' · ' + (detail.archived ? '已归档（不参与注入）' : '正常')}
                </span>
                {detail.tags.length > 0 && (
                  <>
                    <span className={styles.metaKey}>标签</span>
                    <span className={styles.metaValue}>{detail.tags.join('、')}</span>
                  </>
                )}
                {detail.sessionId !== undefined && detail.sessionId !== '' && (
                  <>
                    <span className={styles.metaKey}>会话</span>
                    <span className={styles.metaValue}>{detail.sessionId}</span>
                  </>
                )}
              </div>
              <pre className={styles.detailBody}>{detail.content}</pre>

              <div className={styles.edgeBlock}>
                <span className={styles.rowTitle}>{'关联（' + (neighborhood?.edges.length ?? 0) + '）'}</span>
                {neighborhood === null && <p className={styles.rowDesc}>正在读取关联…</p>}
                {neighborhood !== null && neighborhood.edges.length === 0 && (
                  <p className={styles.rowDesc}>
                    还没有关联。写记忆时声明实体就会自动连上；也可以手动连一条边。
                  </p>
                )}
                {neighborhood !== null && neighborhood.edges.length > 0 && (
                  <EdgeList
                    edges={neighborhood.edges}
                    related={neighborhood.related}
                    disabled={busy || locked}
                    onJump={(id) => { void jumpToMemory(id) }}
                    onUnlink={(edge) => { void removeEdge(edge) }}
                  />
                )}

                {linkDraft === null ? (
                  <div className={styles.itemActions}>
                    <Button
                      variant="outline" size="sm" icon={<IconPlusOutline16 size={14} />}
                      disabled={busy || locked}
                      onClick={() => { setLinkDraft({ toKind: 'memory', toId: '', relation: 'related', note: '' }) }}
                    >
                      连一条边
                    </Button>
                  </div>
                ) : (
                  <div className={styles.linkForm}>
                    <Segmented
                      label="目标类型"
                      value={linkDraft.toKind}
                      options={NODE_KIND_OPTIONS}
                      disabled={busy || locked}
                      onChange={(toKind) => { setLinkDraft({ ...linkDraft, toKind, toId: '' }) }}
                    />
                    <div className={styles.fieldRow}>
                      <Input
                        list="mem-link-target-options"
                        value={linkDraft.toId}
                        placeholder={linkDraft.toKind === 'memory' ? '目标记忆 id（可从下拉里挑）' : '目标实体 id（可从下拉里挑）'}
                        onChange={(event) => { setLinkDraft({ ...linkDraft, toId: event.currentTarget.value }) }}
                      />
                    </div>
                    <datalist id="mem-link-target-options">
                      {(linkDraft.toKind === 'memory'
                        ? records.map((record) => ({ id: record.id as string, label: record.title }))
                        : entities.map((entity) => ({ id: entity.id as string, label: entity.name }))
                      ).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                    </datalist>
                    <div className={styles.fieldRow}>
                      <span>关系</span>
                      <select
                        className={styles.select}
                        value={linkDraft.relation}
                        disabled={busy || locked}
                        onChange={(event) => {
                          setLinkDraft({ ...linkDraft, relation: event.currentTarget.value as MemoryEdgeRelation })
                        }}
                      >
                        {RELATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                    <Input
                      value={linkDraft.note}
                      placeholder="备注（可选，写清为什么连这条边）"
                      onChange={(event) => { setLinkDraft({ ...linkDraft, note: event.currentTarget.value }) }}
                    />
                    <div className={styles.itemActions}>
                      <Button variant="primary" size="sm" disabled={busy || locked} onClick={() => { void submitLink() }}>连接</Button>
                      <Button variant="ghost" size="sm" onClick={() => { setLinkDraft(null) }}>取消</Button>
                    </div>
                  </div>
                )}
              </div>

              <ModalFeedback error={error} notice={notice} />
            </>
          )}
        </div>
      </Modal>

      <Modal
        className={styles.modalWide}
        contentClassName={styles.modalScroll}
        open={ledgerOpen}
        onClose={() => { setLedgerOpen(false) }}
        title="沉淀与后台调用"
        closeLabel="关闭"
        description="原文留档是抽取的第一段：模型抽不出、调用失败，原文都还在，可以随时重抽。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setLedgerOpen(false) }}>关闭</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { void run(loadLedger) }}>刷新</Button>
          </>
        )}
      >
        <div className={styles.modalBody} data-dsh-memory-ui="">
          <span className={styles.rowTitle}>原文留档（{raws.length}）</span>
          {raws.length === 0 && (
            <p className={styles.rowDesc}>还没有留档。导入一份画像、或在工作区里对话一轮，这里就会出现原文。</p>
          )}
          <div className={styles.rawList}>
            {raws.map((raw) => (
              <div className={styles.rawItem} key={raw.id}>
                <div className={styles.itemHead}>
                  <Pill>{ORIGIN_LABELS[raw.origin] ?? raw.origin}</Pill>
                  <span className={styles.itemTitle} title={raw.title}>{raw.title}</span>
                  <span className={styles.rawMeta}>
                    {timeText(raw.createdAt) + ' · ' + raw.textLength + ' 字 · 抽出 ' + raw.recordIds.length + ' 条'}
                  </span>
                  <div className={styles.itemActions}>
                    <Button
                      variant="ghost" size="sm" disabled={busy}
                      onClick={() => {
                        if (rawText[raw.id] !== undefined) {
                          setRawText((current) => {
                            const next = { ...current }
                            delete next[raw.id]
                            return next
                          })
                          return
                        }
                        void showRawText(raw.id)
                      }}
                    >
                      {rawText[raw.id] === undefined ? '看原文' : '收起'}
                    </Button>
                    <Button
                      variant="ghost" size="sm" disabled={busy || locked}
                      title="用当前解析器对这份原文重跑抽取"
                      onClick={() => { void reingestRaw(raw.id) }}
                    >
                      重抽
                    </Button>
                    <Button
                      variant="ghost" size="sm" icon={<IconTrashOutline16 size={14} />}
                      disabled={busy || locked} title="删除留档（不动已抽出的条目）"
                      onClick={() => { void removeRaw(raw.id, raw.title) }}
                    />
                  </div>
                </div>
                {rawText[raw.id] !== undefined && <pre className={styles.rawText}>{rawText[raw.id]}</pre>}
              </div>
            ))}
          </div>

          <span className={styles.rowTitle}>后台模型调用（{audits.length}）</span>
          {audits.length === 0 && <p className={styles.rowDesc}>还没有后台调用记录。</p>}
          <div className={styles.auditList}>
            {audits.map((entry) => (
              <div className={styles.auditItem} key={entry.id}>
                <span className={entry.ok ? styles.auditOk : styles.auditBad}>{entry.ok ? '成功' : '失败'}</span>
                <span className={styles.rawMeta}>{AUDIT_KIND_LABELS[entry.kind] ?? entry.kind}</span>
                <span className={styles.rawMeta}>{timeText(entry.at)}</span>
                <span className={styles.auditModel}>{entry.provider + ' / ' + entry.model}</span>
                <span className={styles.rawMeta}>
                  {durationText(entry.durationMs) + ' · 入 ' + entry.inputChars + ' 字 / 出 ' + entry.outputChars
                    + ' 字 · ' + entry.recordIds.length + ' 条'}
                </span>
                {entry.tokensIn !== undefined && (
                  <span className={styles.rawMeta}>{'token ' + entry.tokensIn + ' → ' + (entry.tokensOut ?? '?')}</span>
                )}
                {entry.error !== undefined && <span className={styles.auditError}>{entry.error}</span>}
              </div>
            ))}
          </div>
          <ModalFeedback error={error} notice={notice} />
        </div>
      </Modal>

      <Modal
        className={styles.modalWide}
        contentClassName={styles.modalScroll}
        open={draft !== null}
        onClose={() => { setDraft(null) }}
        title={draft?.id === null ? '新增记忆' : '编辑记忆'}
        closeLabel="关闭"
        description="用你原本的表述写清「什么时候该这么做」，以后新会话就照这个来。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setDraft(null) }}>取消</Button>
            <Button variant="primary" disabled={busy || locked} onClick={() => { void saveDraft() }}>保存</Button>
          </>
        )}
      >
        {draft !== null && (
          <MemoryDraftForm draft={draft} disabled={locked} onChange={(next) => { setDraft(next) }} />
        )}
      </Modal>

      <Modal
        className={styles.modalWide}
        contentClassName={styles.modalScroll}
        open={entityDraft !== null}
        onClose={() => { setEntityDraft(null) }}
        title={entityDraft?.id === null ? '新建实体' : '编辑实体'}
        closeLabel="关闭"
        description="实体是 wiki 图层里的名词：名称或别名命中已有实体会自动并入，不会长出重复条目。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => { setEntityDraft(null) }}>取消</Button>
            <Button variant="primary" disabled={busy || locked} onClick={() => { void saveEntityDraft() }}>保存</Button>
          </>
        )}
      >
        {entityDraft !== null && (
          <EntityDraftForm draft={entityDraft} disabled={locked} onChange={(next) => { setEntityDraft(next) }} />
        )}
      </Modal>
    </div>
  )
}
