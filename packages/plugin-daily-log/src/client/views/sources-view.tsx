/**
 * 工作报告 · 数据源页。
 *
 * 布局：已添加项目做成卡片栅格（卡片脚 = 图标操作），栅格下方才是虚线「新增数据源」
 * 与会话库导入入口——新增位在卡片之后，读作「之后会长出东西的位置」。
 * 两个弹窗走宿主 Modal 原语（body portal），内容包 DialogRoot 以命中分区样式。
 */

import { useEffect, useState } from 'react'
import {
  Button, IconPlusOutline16, IconTrashOutline16, Input, Modal, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DailyLogRemote } from '../core/remote.ts'
import type { ProjectCandidate, SourceRecord } from '../../types.ts'
import { AddButton, ChannelChips, DialogRoot, IconAction, TYPE_LABELS, errText } from './parts.tsx'

function emptyHint(text: string): JSX.Element {
  return <p className="dl-empty">{text}</p>
}

/** 数据源页：已添加列表 + 两条添加入口。 */
export function SourcesView(props: {
  dailyLog: DailyLogRemote
  sources: readonly SourceRecord[]
  busy: boolean
  run: (action: () => Promise<unknown>) => Promise<boolean>
}): JSX.Element {
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  return (
    <div className="dl-pane">
            <AddButton
        label="新增数据源"
        icon={<IconPlusOutline16 size={16} />}
        disabled={props.busy}
        onClick={() => { setAddOpen(true) }}
      />
      <div className="dl-add-row">
        <button type="button" className="dl-text-btn" style={
          {color: 'var(--dsw-alias-state-business-primary)'}
        } onClick={() => { setImportOpen(true) }}>
          从 Claude Code / Codex 会话库导入项目
        </button>
      </div>
      {props.sources.length === 0
        ? emptyHint('还没有数据源。数据源 = 一个项目路径，报告会聚合该项目在 Git / DSH / Claude / Codex 各渠道的活动。')
        : (
          <>
            <h3 className="dl-group-head">已添加项目</h3>
            <ul className="dl-cards">
              {props.sources.map((s) => (
                <li key={s.id} className="dl-card">
                  <div className="dl-card-body">
                    <div className="dl-card-head">
                      <span className="dl-card-name" title={s.label}>{s.label}</span>
                      <Pill>{TYPE_LABELS[s.type ?? 'other']}</Pill>
                      {s.author !== undefined && <span className="dl-chip">@{s.author}</span>}
                    </div>
                    <span className="dl-card-path" title={s.path}>{s.path}</span>
                  </div>
                  <div className="dl-card-foot">
                    <IconAction
                      label="删除数据源"
                      danger
                      disabled={props.busy}
                      icon={<IconTrashOutline16 size={16} />}
                      onClick={() => void props.run(async () => {
                        const res = await props.dailyLog.removeSource(s.id)
                        if (!res.ok) throw new Error(errText(res.error))
                      })}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

      {addOpen && (
        <SourcesAddDialog
          dailyLog={props.dailyLog}
          busy={props.busy}
          run={props.run}
          sourcesLength={props.sources.length}
          onClose={() => { setAddOpen(false) }}
        />
      )}
      {importOpen && (
        <ImportProjectsDialog
          dailyLog={props.dailyLog}
          onClose={() => { setImportOpen(false) }}
          onImported={() => void props.run(async () => undefined)}
        />
      )}
    </div>
  )
}

/* ---------- 新增数据源（DSH 工作区项目 + 手动路径） ---------- */

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
  // DSH 工作区候选：null=读取中；[]=空。
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
    <Modal
      open
      onClose={props.onClose}
      title="新增数据源"
      closeLabel="关闭"
      description="数据源 = 项目路径；报告会自动聚合该项目在 Git / DSH / Claude / Codex 各渠道的活动。"
      className="dl-dialog-md"
      footer={(
        <Button variant="outline" onClick={props.onClose}>完成</Button>
      )}
    >
      <DialogRoot>
        <div className="dl-field">
          <div className="dl-card-head">
            <span className="dl-field-label">DSH 工作区项目</span>
            <span className="dl-item-detail">徽标 = 该项目在哪些渠道有活动</span>
          </div>
          <div className="dl-list-box">
            {candidates === null
              ? <span className="dl-item-detail">读取中…</span>
              : candidates.length === 0
                ? <span className="dl-item-detail">暂无工作区项目。可在 DSH 工作区添加项目目录后回到本页，或用下方手动添加。</span>
                : candidates.map((c) => (
                  <div key={c.path} className="dl-item">
                    <div className="dl-item-row">
                      <span className="dl-item-name" title={c.title}>{c.title}</span>
                      <Pill>{TYPE_LABELS[c.type]}</Pill>
                      <ChannelChips channels={c.channels} />
                      {c.added
                        ? <span className="dl-item-detail">已添加</span>
                        : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={props.busy}
                            onClick={() => void addCandidate(c)}
                          >
                            添加
                          </Button>
                        )}
                    </div>
                    <div className="dl-item-row">
                      <span className="dl-item-path" title={c.path}>{c.path}</span>
                      {c.detail !== undefined && <span className="dl-item-detail">{c.detail}</span>}
                    </div>
                  </div>
                ))}
            {wsError !== '' && <p className="dl-error" role="alert">{wsError}</p>}
          </div>
        </div>

        <div className="dl-divider">或手动添加项目路径</div>

        <div className="dl-field">
          <Input
            className="dl-grow"
            placeholder="项目绝对路径"
            value={path}
            onChange={(event) => { setPath(event.target.value) }}
          />
          <div className="dl-field-row">
            <Input
              className="dl-grow"
              placeholder="显示名（可选）"
              value={label}
              onChange={(event) => { setLabel(event.target.value) }}
            />
            <Input
              className="dl-grow"
              placeholder="作者邮箱（可选，仅 Git 提交过滤）"
              value={author}
              onChange={(event) => { setAuthor(event.target.value) }}
            />
          </div>
          <div className="dl-add-row">
            <Button
              size="sm"
              disabled={props.busy || path.trim() === ''}
              onClick={() => void addManual()}
            >
              添加该项目
            </Button>
            <span className="dl-item-detail">绝对路径；目录下含 .git 时按代码项目扫描提交</span>
          </div>
        </div>
      </DialogRoot>
    </Modal>
  )
}

/* ---------- 会话库一键导入（穿梭框） ---------- */

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
      else failed.push(c.title + '（' + errText(res.error) + '）')
    }
    setRight([])
    setResult(
      failed.length > 0
        ? '已导入 ' + okCount + ' 个，失败 ' + failed.length + ' 个：' + failed.join('；')
        : '已导入 ' + okCount + ' 个项目',
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

  const item = (c: ProjectCandidate, trailing: JSX.Element): JSX.Element => (
    <div key={c.path} className="dl-item">
      <div className="dl-item-row">
        <span className="dl-item-name" title={c.title}>{c.title}</span>
        <Pill>{TYPE_LABELS[c.type]}</Pill>
        <ChannelChips channels={c.channels} />
        {trailing}
      </div>
      <div className="dl-item-row">
        <span className="dl-item-path" title={c.path}>{c.path}</span>
        {c.detail !== undefined && <span className="dl-item-detail">{c.detail}</span>}
      </div>
    </div>
  )

  return (
    <Modal
      open
      onClose={props.onClose}
      title="导入 Claude Code / Codex 项目"
      closeLabel="关闭"
      description="扫描会话库，按会话工作目录归集为项目；已在数据源里的自动跳过。"
      className="dl-dialog-lg"
      footer={(
        <>
          <Button variant="outline" onClick={props.onClose}>关闭</Button>
          <Button disabled={busy || right.length === 0} onClick={() => void importSelected()}>
            {busy ? '导入中…' : '导入 ' + right.length + ' 个项目'}
          </Button>
        </>
      )}
    >
      <DialogRoot>
        {discovered === null
          ? <span className="dl-item-detail">正在扫描 ~/.claude/projects 与 ~/.codex/sessions…（会话多时需数秒）</span>
          : (
            <>
              <div className="dl-transfer">
                <div className="dl-transfer-pane">
                  <div className="dl-transfer-head">
                    <span className="dl-field-label">可导入（{left.length}）</span>
                    {left.length > 0 && (
                      <button type="button" className="dl-text-btn" onClick={pickAll}>全部加入 →</button>
                    )}
                  </div>
                  <div className="dl-list-box">
                    {left.length === 0
                      ? (
                        <span className="dl-item-detail">
                          {discovered.length === 0 ? '没有发现会话项目（对应工具可能尚未使用）' : '没有可导入的新项目'}
                        </span>
                      )
                      : left.map((c) => item(c, (
                        <Button size="sm" variant="outline" onClick={() => { moveToRight(c) }}>加入</Button>
                      )))}
                  </div>
                </div>
                <div className="dl-transfer-pane">
                  <div className="dl-transfer-head">
                    <span className="dl-field-label">待导入（{right.length}）</span>
                    {right.length > 0 && (
                      <button type="button" className="dl-text-btn" onClick={clearAll}>← 全部退回</button>
                    )}
                  </div>
                  <div className="dl-list-box">
                    {right.length === 0
                      ? <span className="dl-item-detail">从左侧选择要导入的项目</span>
                      : right.map((c) => item(c, (
                        <Button size="sm" variant="outline" onClick={() => { moveToLeft(c) }}>退回</Button>
                      )))}
                  </div>
                </div>
              </div>
              {error !== '' && <p className="dl-error" role="alert">{error}</p>}
              {result !== '' && <p className="dl-note">{result}</p>}
            </>
          )}
      </DialogRoot>
    </Modal>
  )
}
