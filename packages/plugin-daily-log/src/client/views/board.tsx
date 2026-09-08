/**
 * daily-log 面板主视图：数据源管理 + 对话式生成报告引导 + 报告历史 + 模板自定义。
 * 数据读写走 Typert remote（ctx.remote.dailyLog.*）；报告正文由宿主聊天 agent 经 daily_log_* 工具生成。
 * 风格对齐 dsh-task-board / plugin-notes 的独立面板（内联样式，走宿主 --dsw-* 令牌）。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import { boardStore } from '../core/board-store.ts'
import type { DailyLogRemote } from '../core/remote.ts'
import type { ReportRecord, SourceRecord, TemplateRecord } from '../../types.ts'
import type { ProjectCandidate, ProjectChannels, SourceType } from '../../types.ts'
import { CHANNEL_LABELS, NO_CHANNELS, SOURCE_KINDS } from '../../types.ts'
import { DATA_MARKER, parseTemplate, joinTemplate } from '../../template.ts'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

export interface DailyLogBoardFace {
  dailyLog: DailyLogRemote
}

/** MarkdownText 本地化文案（模板预览用，引用稳定常量）。 */
const TEMPLATE_MD_LABELS = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
  footnotes: '脚注',
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

const TYPE_LABELS: Record<SourceType, string> = {
  code: '代码项目',
  other: '其他',
}

/** 项目类型徽标：代码项目用成功语义色，其他用次级文字色（明暗自适配）。 */
function typeTagStyle(type: SourceType): CSSProperties {
  return {
    padding: '0 7px',
    borderRadius: 10,
    fontSize: 11,
    lineHeight: '17px',
    border: '1px solid var(--dsw-alias-border-l2)',
    color: type === 'code' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-secondary)',
    whiteSpace: 'nowrap',
    flex: 'none',
  }
}

/* ---------- 基础样式 ---------- */

const rootStyle: CSSProperties = {
  boxSizing: 'border-box',
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '16px 18px',
  gap: 12,
  background: 'var(--dsw-alias-bg-base)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  overflow: 'hidden',
  fontFamily: 'var(--dsw-font-family, inherit)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}

const titleStyle: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600 }

const navStyle: CSSProperties = { display: 'flex', gap: 6, borderBottom: '1px solid var(--dsw-alias-border-l2)' }

const tabStyle = (active: boolean): CSSProperties => ({
  padding: '6px 12px',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid var(--dsw-alias-brand-primary)' : '2px solid transparent',
  color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: active ? 600 : 400,
})

const panelStyle: CSSProperties = { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }

const rowStyle: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }

const inputStyle: CSSProperties = {
  padding: '6px 8px',
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
}

const btnStyle: CSSProperties = {
  padding: '6px 12px',
  // 次级按钮底色用交互 hover 填充（宿主明暗自适配）；interactive-bg-active 是
  // 「选中态」语义（侧栏激活项），做常态按钮背景在暗色下过重。
  background: 'var(--dsw-alias-interactive-bg-hover)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
  color: 'var(--dsw-alias-label-primary)',
  cursor: 'pointer',
  fontSize: 13,
}

const primaryBtnStyle: CSSProperties = {
  ...btnStyle,
  // 主按钮用宿主按钮体系（button-primary-fill 明暗自适配 + 语义前景色），
  // 不再硬编码 #fff / brand-primary——暗色下文字与填充才正确。
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
  border: '1px solid transparent',
  fontWeight: 600,
}

const dangerBtnStyle: CSSProperties = { ...btnStyle, color: 'var(--dsw-alias-state-error-primary)' }

const cardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: 10,
  background: 'var(--dsw-alias-markdown-code-block)',
  borderRadius: 6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 12,
  lineHeight: 1.5,
}

const errorStyle: CSSProperties = { color: 'var(--dsw-alias-state-error-primary)', fontSize: 12 }

const hintStyle: CSSProperties = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12 }

const segmentBtnStyle: CSSProperties = {
  padding: '4px 14px',
  fontSize: 13,
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
}

const segmentActiveBtnStyle: CSSProperties = {
  ...segmentBtnStyle,
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
  fontWeight: 600,
}

/* ---------- 主组件 ---------- */

export function DailyLogBoard({ face }: { face: DailyLogBoardFace }): JSX.Element {
  const dailyLog = face.dailyLog
  const tab = useSyncExternalStore(boardStore.subscribe, () => boardStore.tab)

  const [sources, setSources] = useState<readonly SourceRecord[]>([])
  const [reports, setReports] = useState<readonly ReportRecord[]>([])
  const [templates, setTemplates] = useState<readonly TemplateRecord[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const [s, r, t] = await Promise.all([
      dailyLog.listSources(),
      dailyLog.listReports(),
      dailyLog.listTemplates(),
    ])
    if (s.ok) setSources(s.value)
    else setError(errText(s.error))
    if (r.ok) setReports(r.value)
    else setError(errText(r.error))
    if (t.ok) setTemplates(t.value)
    else setError(errText(t.error))
  }, [dailyLog])

  useEffect(() => { void refresh() }, [refresh])

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true)
    setError('')
    try {
      await action()
      await refresh()
      return true
    } catch (e) {
      setError(errText(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={rootStyle}>
      <header style={headerStyle}>
        <h2 style={titleStyle}>工作报告</h2>
        <button type="button" style={btnStyle} onClick={() => boardStore.hide()}>关闭</button>
      </header>
      <nav style={navStyle}>
        <button type="button" style={tabStyle(tab === 'board')} onClick={() => boardStore.setTab('board')}>指南</button>
        <button type="button" style={tabStyle(tab === 'sources')} onClick={() => boardStore.setTab('sources')}>数据源（{sources.length}）</button>
        <button type="button" style={tabStyle(tab === 'reports')} onClick={() => boardStore.setTab('reports')}>报告（{reports.length}）</button>
        <button type="button" style={tabStyle(tab === 'templates')} onClick={() => boardStore.setTab('templates')}>模板（{templates.length}）</button>
      </nav>
      {error !== '' && <div style={errorStyle}>{error}</div>}
      <div style={panelStyle}>
        {tab === 'board' && <GuidanceTab sources={sources} templates={templates} />}
        {tab === 'sources' && <SourcesTab dailyLog={dailyLog} sources={sources} busy={busy} run={run} />}
        {tab === 'reports' && <ReportsTab dailyLog={dailyLog} reports={reports} busy={busy} run={run} />}
        {tab === 'templates' && <TemplatesTab dailyLog={dailyLog} templates={templates} busy={busy} run={run} />}
      </div>
    </div>
  )
}

/* ---------- 指南（对话式生成入口） ---------- */

/** 指南页：纯引导（无操作按钮）——整页文案用 Markdown 渲染；页首为品牌花体字。 */
function GuidanceTab(props: {
  sources: readonly SourceRecord[]
  templates: readonly TemplateRecord[]
}): JSX.Element {
  const defaultTemplate = props.templates.find((t) => t.isDefault) ?? props.templates.find((t) => t.isBuiltin)
  const sourceText = props.sources.length === 0
    ? '0 个 —— 请先到「数据源」页添加项目'
    : props.sources.map((s) => s.label).join('、')
  const guideMd = [
    '## 对话式生成报告',
    '',
    '在本窗口左侧的聊天里对 AI 说一句话（如 **「帮我生成本周周报」**）：AI 会先确认时间范围与项目、',
    '扫描 Git 提交与本地 agent 会话，再亲自把活动归纳成业务化报告',
    '（合并同功能提交、按模板结构归类），经你确认后保存到「报告」页并可按需导出。',
    '',
    '## 当前状态',
    '',
    '- **默认模板：** ' + (defaultTemplate?.name ?? '无') + (defaultTemplate?.isBuiltin ? '（内置）' : ''),
    '- **数据源：** ' + sourceText,
  ].join('\n')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: 1, color: 'var(--dsw-alias-label-primary)' }}>
        𝖉𝖆𝖎𝖑𝖞 𝖑𝖔𝖌
      </div>
      <div style={cardStyle}>
        <MarkdownText text={guideMd} labels={TEMPLATE_MD_LABELS} />
      </div>
    </div>
  )
}
/* ---------- 数据源 ---------- */

/** 来源徽标样式：命中（亮）与未命中（暗）明暗自适配。 */
function channelBadgeStyle(hit: boolean): CSSProperties {
  return {
    padding: '0 6px',
    borderRadius: 4,
    fontSize: 10.5,
    lineHeight: '16px',
    border: '1px solid var(--dsw-alias-border-l2)',
    color: hit ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
    background: hit ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
    opacity: hit ? 1 : 0.5,
    whiteSpace: 'nowrap',
    flex: 'none',
  }
}

/** 多来源徽标：Git / DSH / Claude / Codex，命中即亮（多个同时显示）。 */
function ChannelBadges({ channels }: { channels: ProjectChannels | undefined }): JSX.Element {
  const ch = channels ?? NO_CHANNELS
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flex: 'none' }}>
      {SOURCE_KINDS.map((k) => (
        <span
          key={k}
          style={channelBadgeStyle(ch[k])}
          title={`${CHANNEL_LABELS[k]}：${ch[k] ? '该项目在此来源有活动' : '该项目在此来源暂无活动'}`}
        >
          {CHANNEL_LABELS[k]}
        </span>
      ))}
    </span>
  )
}

/** 候选项目行：名称 + 类型 + 来源徽标 + 路径 + 添加/已添加。 */
function CandidateRow(props: {
  c: ProjectCandidate
  busy: boolean
  onAdd: (c: ProjectCandidate) => void
}): JSX.Element {
  return (
    <div style={rowStyle}>
      <strong>{props.c.title}</strong>
      <span style={typeTagStyle(props.c.type)}>{TYPE_LABELS[props.c.type]}</span>
      <ChannelBadges channels={props.c.channels} />
      <span
        style={{ ...hintStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={props.c.path}
      >
        {props.c.path}
      </span>
      {props.c.detail !== undefined && <span style={{ ...hintStyle, flex: 'none' }}>{props.c.detail}</span>}
      {props.c.added ? (
        <span style={hintStyle}>已添加</span>
      ) : (
        <button type="button" style={btnStyle} disabled={props.busy} onClick={() => props.onAdd(props.c)}>添加</button>
      )}
    </div>
  )
}

/* ---------- 会话库一键导入（弹窗 + 穿梭框） ---------- */

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  zIndex: 1000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
}
const dialogStyle: CSSProperties = {
  width: 'min(820px, 94vw)',
  maxHeight: 'min(86vh, 760px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  padding: 18,
  boxShadow: '0 12px 40px rgba(0,0,0,0.28)',
}
const paneStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  overflow: 'auto',
  minHeight: 160,
  maxHeight: 380,
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  flex: 1,
}

/** 会话库发现结果穿梭框：左侧可导入 → 选中移入右侧 → 批量导入。 */
function ImportProjectsDialog(props: {
  dailyLog: DailyLogRemote
  onClose: () => void
  onImported: () => void
}): JSX.Element {
  const [discovered, setDiscovered] = useState<readonly ProjectCandidate[] | null>(null)
  const [left, setLeft] = useState<readonly ProjectCandidate[]>([])
  const [right, setRight] = useState<readonly ProjectCandidate[]>([])
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError('')
    void (async () => {
      const res = await props.dailyLog.discoverSessionProjects()
      if (cancelled) return
      if (!res.ok) {
        setDiscovered([])
        setError(errText(res.error))
        return
      }
      setDiscovered(res.value)
      setLeft(res.value.filter((c) => !c.added))
    })()
    return () => { cancelled = true }
  }, [props.dailyLog])

  function moveToRight(c: ProjectCandidate): void {
    setLeft((prev) => prev.filter((x) => x.path !== c.path))
    setRight((prev) => (prev.some((x) => x.path === c.path) ? prev : [...prev, c]))
  }
  function moveToLeft(c: ProjectCandidate): void {
    setRight((prev) => prev.filter((x) => x.path !== c.path))
    setLeft((prev) =>
      prev.some((x) => x.path === c.path)
        ? prev
        : [...prev, c].sort((a, b) => a.path.localeCompare(b.path)),
    )
  }
  function pickAll(): void {
    setRight((prev) => [...prev, ...left.filter((x) => !prev.some((y) => y.path === x.path))])
    setLeft([])
  }
  function clearAll(): void {
    setLeft((prev) => [...prev, ...right].sort((a, b) => a.path.localeCompare(b.path)))
    setRight([])
  }

  async function importSelected(): Promise<void> {
    if (right.length === 0 || busy) return
    setBusy(true)
    setResult('')
    const failed: string[] = []
    let okCount = 0
    for (const c of right) {
      const res = await props.dailyLog.addSource({ path: c.path, label: c.title, type: c.type })
      if (res.ok) okCount++
      else failed.push(`${c.title}（${errText(res.error)}）`)
    }
    setRight([])
    setResult(
      failed.length > 0
        ? `已导入 ${okCount} 个，失败 ${failed.length} 个：${failed.join('；')}`
        : `已导入 ${okCount} 个项目`,
    )
    props.onImported()
    // 导入后重扫，把已添加项从「可导入」移走。
    const res = await props.dailyLog.discoverSessionProjects()
    if (res.ok) {
      setDiscovered(res.value)
      setLeft(res.value.filter((c) => !c.added))
    }
    setBusy(false)
  }

  /** 穿梭框条目：两行卡片 —— 第一行项目名（短文件路径）+ 类型/来源徽标 + 操作；
   *  第二行完整路径弱化小字 + 会话数。 */
  const transferItemStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    padding: '7px 10px',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    flex: 'none',
    background: 'var(--dsw-alias-bg-layer-1)',
  }
  const paneRow = (c: ProjectCandidate, trailing: JSX.Element): JSX.Element => (
    <div key={c.path} style={transferItemStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <strong
          style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}
          title={c.title}
        >
          {c.title}
        </strong>
        <span style={typeTagStyle(c.type)}>{TYPE_LABELS[c.type]}</span>
        <ChannelBadges channels={c.channels} />
        {trailing}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span
          style={{ ...hintStyle, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}
          title={c.path}
        >
          {c.path}
        </span>
        {c.detail !== undefined && (
          <span style={{ ...hintStyle, flex: 'none', fontSize: 10.5 }}>{c.detail}</span>
        )}
      </div>
    </div>
  )

  return (
    <div style={overlayStyle} onClick={props.onClose}>
      <div
        style={dialogStyle}
        onClick={(e) => { e.stopPropagation() }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>导入 Claude Code / Codex 项目</strong>
          <span style={hintStyle}>扫描会话库 · 按会话工作目录归集为项目 · 已添加的自动跳过</span>
        </div>
        {discovered === null ? (
          <span style={hintStyle}>正在扫描 ~/.claude/projects 与 ~/.codex/sessions…（会话多时需数秒）</span>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={hintStyle}>可导入（{left.length}）</span>
                  {left.length > 0 && (
                    <button type="button" style={btnStyle} onClick={pickAll}>全部加入 →</button>
                  )}
                </div>
                <div style={paneStyle}>
                  {left.length === 0 ? (
                    <span style={hintStyle}>{discovered.length === 0 ? '没有发现会话项目（对应工具可能尚未使用）' : '没有可导入的新项目'}</span>
                  ) : (
                    left.map((c) => paneRow(c, (
                      <button type="button" style={btnStyle} onClick={() => moveToRight(c)}>→</button>
                    )))
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={hintStyle}>待导入（{right.length}）</span>
                  {right.length > 0 && (
                    <button type="button" style={btnStyle} onClick={clearAll}>← 全部退回</button>
                  )}
                </div>
                <div style={paneStyle}>
                  {right.length === 0 ? (
                    <span style={hintStyle}>从左侧选择项目</span>
                  ) : (
                    right.map((c) => paneRow(c, (
                      <button type="button" style={dangerBtnStyle} onClick={() => moveToLeft(c)}>×</button>
                    )))
                  )}
                </div>
              </div>
            </div>
            {error !== '' && <div style={errorStyle}>{error}</div>}
            {result !== '' && <div style={hintStyle}>{result}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
              <button type="button" style={btnStyle} onClick={props.onClose}>关闭</button>
              <button
                type="button"
                style={primaryBtnStyle}
                disabled={busy || right.length === 0}
                onClick={() => void importSelected()}
              >
                {busy ? '导入中…' : `导入 ${right.length} 个项目`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- 新增数据源（弹窗：DSH 工作区项目 + 手动添加） ---------- */

function SourcesAddDialog(props: {
  dailyLog: DailyLogRemote
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
  sourcesLength: number
  onClose: () => void
}): JSX.Element {
  const [path, setPath] = useState('')
  const [label, setLabel] = useState('')
  const [author, setAuthor] = useState('')
  // DSH 工作区候选：null=加载中；[]=空。
  const [candidates, setCandidates] = useState<readonly ProjectCandidate[] | null>(null)
  const [wsError, setWsError] = useState('')

  async function addManual(): Promise<void> {
    if (path.trim() === '') return
    await props.run(async () => {
      const res = await props.dailyLog.addSource({
        path: path.trim(),
        ...(label.trim() !== '' ? { label: label.trim() } : {}),
        ...(author.trim() !== '' ? { author: author.trim() } : {}),
      })
      if (!res.ok) throw new Error(errText(res.error))
      setPath(''); setLabel(''); setAuthor('')
    })
  }

  async function addCandidate(c: ProjectCandidate): Promise<void> {
    await props.run(async () => {
      const res = await props.dailyLog.addSource({ path: c.path, label: c.title, type: c.type })
      if (!res.ok) throw new Error(errText(res.error))
    })
  }

  // 打开即拉取；添加成功后（run 内刷新 → sources 数变化）重拉以刷新「已添加」标记。
  useEffect(() => {
    let cancelled = false
    setWsError('')
    void (async () => {
      const res = await props.dailyLog.listWorkspaceCandidates()
      if (cancelled) return
      if (res.ok) setCandidates(res.value)
      else {
        setCandidates([])
        setWsError(errText(res.error))
      }
    })()
    return () => { cancelled = true }
  }, [props.dailyLog, props.sourcesLength])

  return (
    <div style={overlayStyle} onClick={props.onClose}>
      <div style={dialogStyle} onClick={(e) => { e.stopPropagation() }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>新增数据源</strong>
          <span style={hintStyle}>数据源 = 项目路径 · 报告自动聚合该项目的 Git / DSH / Claude / Codex 活动</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          {/* DSH 工作区项目：自动 async 展示，行内来源徽标多亮。 */}
          <div style={{ ...paneStyle, flex: '0 1 auto', maxHeight: '42vh' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12.5 }}>DSH 工作区项目</strong>
              <span style={hintStyle}>徽标 = 该项目在哪些来源有活动</span>
            </div>
            {candidates === null ? (
              <span style={hintStyle}>读取中…</span>
            ) : candidates.length === 0 ? (
              <span style={hintStyle}>暂无工作区项目。可在 DSH 工作区添加项目目录后回到本页，或使用下方手动添加。</span>
            ) : (
              candidates.map((c) => (
                <CandidateRow key={c.path} c={c} busy={props.busy} onAdd={(cc) => void addCandidate(cc)} />
              ))
            )}
            {wsError !== '' && <div style={errorStyle}>{wsError}</div>}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
            <span style={{ flex: 1, borderTop: '1px solid var(--dsw-alias-border-l2)' }} />
            <span style={hintStyle}>或手动添加项目路径</span>
            <span style={{ flex: 1, borderTop: '1px solid var(--dsw-alias-border-l2)' }} />
          </div>

          {/* 手动添加路径（类型由 host 自动判定：含 .git → 代码项目，否则其他）。 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none' }}>
            <input style={inputStyle} placeholder="项目绝对路径" value={path} onChange={(e) => setPath(e.target.value)} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input style={{ ...inputStyle, flex: 1 }} placeholder="显示名（可选）" value={label} onChange={(e) => setLabel(e.target.value)} />
              <input style={{ ...inputStyle, flex: 1.2 }} placeholder="作者邮箱（可选，仅 Git 提交过滤）" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" style={primaryBtnStyle} disabled={props.busy || path.trim() === ''} onClick={() => void addManual()}>
                添加该项目
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" style={btnStyle} onClick={props.onClose}>完成</button>
        </div>
      </div>
    </div>
  )
}

/* ---------- 新增 / 编辑模板（弹窗） ---------- */

function TemplateEditDialog(props: {
  dailyLog: DailyLogRemote
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
  editing: TemplateRecord | null
  onClose: () => void
}): JSX.Element {
  const initial = props.editing !== null ? parseTemplate(props.editing.content) : null
  const [name, setName] = useState(props.editing?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.promptSection ?? '')
  const [skeleton, setSkeleton] = useState(initial?.skeletonSection ?? '')
  const [preview, setPreview] = useState(false)

  async function save(): Promise<void> {
    if (name.trim() === '' || skeleton.trim() === '') return
    const content = joinTemplate(prompt, skeleton)
    await props.run(async () => {
      const res =
        props.editing !== null
          ? await props.dailyLog.updateTemplate(props.editing.id, { name: name.trim(), content })
          : await props.dailyLog.createTemplate({ name: name.trim(), content })
      if (!res.ok) throw new Error(errText(res.error))
      props.onClose()
    })
  }

  return (
    <div style={overlayStyle} onClick={props.onClose}>
      <div style={dialogStyle} onClick={(e) => { e.stopPropagation() }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{props.editing !== null ? '编辑模板' : '新增模板'}</strong>
          <span style={hintStyle}>指令段（可选） + {DATA_MARKER} + 骨架段；内容作为结构引导喂给生成 AI</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...inputStyle, flex: 1 }} placeholder='模板名' value={name} onChange={(e) => setName(e.target.value)} />
          <div style={{ display: 'flex', gap: 2, padding: 2, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, background: 'var(--dsw-alias-bg-base)' }}>
            <button type='button' style={preview ? segmentBtnStyle : segmentActiveBtnStyle} onClick={() => setPreview(false)}>编辑</button>
            <button type='button' style={preview ? segmentActiveBtnStyle : segmentBtnStyle} onClick={() => setPreview(true)}>预览</button>
          </div>
        </div>
        {preview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={hintStyle}>指令段（可选）预览{prompt.trim() === '' ? ' —— 未填写' : ''}</span>
              {prompt.trim() !== '' && (
                <div style={{ border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '8px 12px', minHeight: 60, maxHeight: 140, overflowY: 'auto', background: 'var(--dsw-alias-bg-base)' }}>
                  <MarkdownText text={prompt} labels={TEMPLATE_MD_LABELS} />
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={hintStyle}>骨架段（必填）预览</span>
              <div style={{ border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 6, padding: '8px 12px', minHeight: 180, maxHeight: 320, overflowY: 'auto', background: 'var(--dsw-alias-bg-base)' }}>
                <MarkdownText text={skeleton} labels={TEMPLATE_MD_LABELS} />
              </div>
            </div>
          </div>
        ) : (
          <>
            <textarea
              style={{ ...inputStyle, minHeight: 90, fontFamily: 'monospace', resize: 'vertical' }}
              placeholder={'指令段（可选）：给生成 AI 的额外撰写要求，如「按周维度组织，每周一个小节」'}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, borderTop: '1px solid var(--dsw-alias-border-l2)' }} />
              <span style={hintStyle}>骨架段（报告章节结构，必填）</span>
              <span style={{ flex: 1, borderTop: '1px solid var(--dsw-alias-border-l2)' }} />
            </div>
            <textarea
              style={{ ...inputStyle, minHeight: 260, fontFamily: 'monospace', resize: 'vertical' }}
              placeholder={'章节标题，示例：\n## 核心产出\n## 问题修复\n## 技术优化\n## 其他工作\n## 下一步计划'}
              value={skeleton}
              onChange={(e) => setSkeleton(e.target.value)}
            />
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type='button' style={btnStyle} onClick={props.onClose}>取消</button>
          <button type='button' style={primaryBtnStyle} disabled={props.busy || name.trim() === '' || skeleton.trim() === ''} onClick={() => void save()}>
            {props.editing !== null ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SourcesTab(props: {
  dailyLog: DailyLogRemote
  sources: readonly SourceRecord[]
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
}): JSX.Element {
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 页面级操作：新增数据源（弹窗）与会话库一键导入。 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" style={btnStyle} onClick={() => setImportOpen(true)}>
          导入 Claude Code / Codex 项目
        </button>
        <button type="button" style={primaryBtnStyle} onClick={() => setAddOpen(true)}>
          新增数据源
        </button>
      </div>

      {/* 已添加项目（列表）。 */}
      {props.sources.length > 0 ? (
        <div style={cardStyle}>
          <strong>已添加项目（{props.sources.length}）</strong>
          {props.sources.map((s) => (
            <div key={s.id} style={rowStyle}>
              <strong>{s.label}</strong>
              <span style={typeTagStyle(s.type ?? 'other')}>{TYPE_LABELS[s.type ?? 'other']}</span>
              {s.author !== undefined && <span style={hintStyle}>@{s.author}</span>}
              <span style={{ ...hintStyle, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.path}>{s.path}</span>
              <button
                type="button"
                style={dangerBtnStyle}
                disabled={props.busy}
                onClick={() => void props.run(async () => {
                  const res = await props.dailyLog.removeSource(s.id)
                  if (!res.ok) throw new Error(errText(res.error))
                })}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : (
        <span style={hintStyle}>尚无数据源。点击右上「新增数据源」从 DSH 工作区项目选择或手动添加路径（报告将聚合该项目在 Git/DSH/Claude/Codex 各来源的活动），或用「导入 Claude Code / Codex 项目」批量导入。</span>
      )}
      </div>
      {addOpen && (
        <SourcesAddDialog
          dailyLog={props.dailyLog}
          busy={props.busy}
          run={props.run}
          sourcesLength={props.sources.length}
          onClose={() => setAddOpen(false)}
        />
      )}
      {importOpen && (
        <ImportProjectsDialog
          dailyLog={props.dailyLog}
          onClose={() => setImportOpen(false)}
          onImported={() => void props.run(async () => undefined)}
        />
      )}
    </>
  )
}

/* ---------- 报告 ---------- */

function ReportsTab(props: {
  dailyLog: DailyLogRemote
  reports: readonly ReportRecord[]
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
}): JSX.Element {
  const [openId, setOpenId] = useState('')
  const open = props.reports.find((r) => r.id === openId)

  async function doExport(id: string): Promise<void> {
    await props.run(async () => {
      const res = await props.dailyLog.exportReport(id as never)
      if (res.ok) window.alert('已导出：' + res.value)
      else throw new Error(errText(res.error))
    })
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {props.reports.map((r) => (
        <div key={r.id} style={cardStyle}>
          <div style={rowStyle}>
            <strong style={{ flex: 1 }}>{r.title}</strong>
            <span style={hintStyle}>{r.dateRange.since}{r.dateRange.until ? ' ~ ' + r.dateRange.until : ''}</span>
            {r.reportType !== undefined && <span style={hintStyle}>{r.reportType}</span>}
            <button type="button" style={btnStyle} onClick={() => setOpenId(openId === r.id ? '' : r.id)}>
              {openId === r.id ? '收起' : '查看'}
            </button>
            <button type="button" style={btnStyle} disabled={props.busy} onClick={() => void doExport(r.id)}>导出</button>
            <button type="button" style={dangerBtnStyle} disabled={props.busy} onClick={() => void props.run(async () => {
              const res = await props.dailyLog.deleteReport(r.id)
              if (!res.ok) throw new Error(errText(res.error))
            })}>删除</button>
          </div>
          {openId === r.id && open !== undefined && <pre style={preStyle}>{open.markdown}</pre>}
        </div>
      ))}
      {props.reports.length === 0 && <span style={hintStyle}>尚无报告。在左侧聊天里让 AI 生成（如：帮我生成本周周报），确认后报告会出现在这里。</span>}
    </div>
  )
}

/* ---------- 模板 ---------- */

function TemplatesTab(props: {
  dailyLog: DailyLogRemote
  templates: readonly TemplateRecord[]
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
}): JSX.Element {
  const [dialog, setDialog] = useState<{ editing: TemplateRecord | null } | null>(null)

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" style={primaryBtnStyle} onClick={() => setDialog({ editing: null })}>
          新增模板
        </button>
      </div>
      {props.templates.map((t) => (
        <div key={t.id} style={cardStyle}>
          <div style={rowStyle}>
            <strong>{t.name}</strong>
            {t.isBuiltin && <span style={hintStyle}>内置</span>}
            {t.isDefault && <span style={hintStyle}>默认</span>}
            <span style={{ flex: 1 }} />
            {!t.isBuiltin && (
              <>
                <button type="button" style={btnStyle} onClick={() => setDialog({ editing: t })}>编辑</button>
                {!t.isDefault && (
                  <button type="button" style={btnStyle} disabled={props.busy} onClick={() => void props.run(async () => {
                    const res = await props.dailyLog.setDefaultTemplate(t.id)
                    if (!res.ok) throw new Error(errText(res.error))
                  })}>设为默认</button>
                )}
                <button type="button" style={dangerBtnStyle} disabled={props.busy} onClick={() => void props.run(async () => {
                  const res = await props.dailyLog.deleteTemplate(t.id)
                  if (!res.ok) throw new Error(errText(res.error))
                })}>删除</button>
              </>
            )}
          </div>
        </div>
      ))}
      {props.templates.length === 0 && <span style={hintStyle}>尚无模板。点击右上「新增模板」创建两段式模板（指令段可选 + 骨架段必填）。</span>}
      </div>
      {dialog !== null && (
        <TemplateEditDialog
          dailyLog={props.dailyLog}
          busy={props.busy}
          run={props.run}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}
