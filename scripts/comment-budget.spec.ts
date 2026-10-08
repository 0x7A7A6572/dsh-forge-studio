/**
 * 注释门禁：冻结存量，只挡新增。判据见 COMMENT-RULES.md 与 CONVENTIONS.md 的「注释」一节，
 * 范围是 packages/<pkg>/src 下随包发布的 .ts/.tsx。
 *
 * 收紧基线：`COMMENT_BUDGET_REPORT=1` 跑本文件打出各文件行数与三项存量，
 * 填进 CLEANED 并下调对应预算。只许降不许升。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 硬指标，与 CONVENTIONS.md 的「注释」一节保持一致。 */
const MAX_HAN_PER_LINE = 30
const MAX_DOCBLOCK_LINES = 3

/**
 * 已清扫文件：注释内容行数冻结在此，只许降。
 * 数值取自 `COMMENT_BUDGET_REPORT=1` 的报表，不要手估。
 */
const CLEANED: Record<string, number> = {
  'packages/plugin-daily-log/src/service.ts': 18,
  'packages/plugin-daily-log/src/types.ts': 15,
  'packages/plugin-memory/src/agent/capture.ts': 7,
  'packages/plugin-memory/src/agent/tools.ts': 2,
  'packages/plugin-memory/src/client/hooks/useSettingsSection.ts': 9,
  'packages/plugin-memory/src/service.ts': 61,
  'packages/plugin-memory/src/types.ts': 75,
  'packages/plugin-notes/src/agent/task-dispatch.ts': 15,
  'packages/plugin-notes/src/agent/tools.ts': 26,
  'packages/plugin-notes/src/client/components/NoteEditor.tsx': 9,
  'packages/plugin-notes/src/client/core/note-richtext.ts': 12,
  'packages/plugin-notes/src/client/core/notes-remote.ts': 18,
  'packages/plugin-notes/src/client/core/task-lanes.ts': 22,
  'packages/plugin-notes/src/client/hooks/useNoteEditor.ts': 50,
  'packages/plugin-notes/src/client/index.ts': 26,
  'packages/plugin-notes/src/client/views/notes-board/useNotesBoard.ts': 25,
  'packages/plugin-notes/src/index.ts': 18,
  'packages/plugin-notes/src/schedule.ts': 29,
  'packages/plugin-notes/src/service.ts': 64,
  'packages/plugin-notes/src/types.ts': 64,
  'packages/plugin-usage-billing/src/client/components/BillingPopover.tsx': 12,
  'packages/plugin-usage-billing/src/client/components/TierCurveMini.tsx': 6,
  'packages/plugin-usage-billing/src/client/core/tier-curve.ts': 59,
  'packages/plugin-usage-billing/src/client/hooks/useEntryCard.ts': 40,
  'packages/plugin-usage-billing/src/client/index.ts': 20,
  'packages/plugin-usage-billing/src/client/views/settings-section/useSettingsSection.ts': 33,
  'packages/plugin-usage-billing/src/domain.ts': 20,
  'packages/plugin-usage-billing/src/index.ts': 14,
  'packages/plugin-usage-billing/src/pricing/catalog.ts': 12,
  'packages/plugin-usage-billing/src/pricing/fetch.ts': 8,
  'packages/plugin-usage-billing/src/pricing/tiers.ts': 12,
  'packages/plugin-usage-billing/src/service.ts': 27,
  'packages/plugin-usage-billing/src/settings.ts': 8,
  'packages/plugin-usage-billing/src/shape/contract.ts': 27,
  'packages/plugin-usage-billing/src/storage-key.ts': 20,
  'packages/plugin-usage-billing/src/themes/route.ts': 10,
  'packages/plugin-usage-billing/src/themes/transpile.ts': 31,
  'packages/plugin-usage-billing/src/types.ts': 25,
  'packages/plugin-usage-billing/src/view.ts': 17,
}

/** 全仓存量，只许降。三项都由 `COMMENT_BUDGET_REPORT=1` 的报表量出。 */
const TOTAL_BUDGET = 3949
const OVER30_BUDGET = 247
const LONG_DOCBLOCK_BUDGET = 184

const MARKDOWN_HEADING = /^#{1,6}\s/
const EMOJI = /[\u{1F000}-\u{1FAFF}\u26A0\u2705\u274C\u2757\u2753\u2728\u2B50\uFE0F]/u
const HAN_CHAR = /[\u4e00-\u9fff]/g

interface CommentLine { line: number; text: string }

interface CommentAudit {
  lines: CommentLine[]
  /** 内容行超过硬指标的 Docblock，报起始行号。 */
  longDocblocks: number[]
}

/**
 * 逐行扫注释。识别 `//`、`/* *​/`、`/** *​/`、JSX 的 `{/* *​/}`；
 * 「内容行」指剥掉注释符与行首 `*` 之后还有字的行，空行与整行 `*` 不算。
 * 已知盲区：跟在代码后面的行尾块注释不计（仓里只有个别行尾 `//`，且对基线与新增口径一致）。
 */
function auditComments(source: string): CommentAudit {
  const lines: CommentLine[] = []
  const longDocblocks: number[] = []
  let inBlock = false
  let isDoc = false
  let docStart = 0
  let docCount = 0

  const closeBlock = (): void => {
    inBlock = false
    if (isDoc && docCount > MAX_DOCBLOCK_LINES) longDocblocks.push(docStart)
  }

  source.split('\n').forEach((raw, index) => {
    const trimmed = raw.trim()
    if (inBlock) {
      const close = trimmed.indexOf('*/')
      const body = (close >= 0 ? trimmed.slice(0, close) : trimmed).replace(/^\*+\s*/, '').trim()
      if (body !== '') {
        lines.push({ line: index + 1, text: body })
        docCount++
      }
      if (close >= 0) closeBlock()
      return
    }

    if (trimmed.startsWith('//')) {
      const body = trimmed.slice(2).trim()
      if (body !== '') lines.push({ line: index + 1, text: body })
      return
    }

    const open = trimmed.startsWith('{/*') ? 3 : trimmed.startsWith('/*') ? 2 : -1
    if (open < 0) return

    isDoc = trimmed.startsWith('/**')
    docStart = index + 1
    docCount = 0
    const close = trimmed.indexOf('*/', open)
    const body = (close >= 0 ? trimmed.slice(open, close) : trimmed.slice(open))
      .replace(/^\*+\s*/, '').trim()
    if (body !== '') {
      lines.push({ line: index + 1, text: body })
      docCount++
    }
    if (close >= 0) closeBlock()
    else inBlock = true
  })

  return { lines, longDocblocks }
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

function hanCount(text: string): number {
  return (text.match(HAN_CHAR) ?? []).length
}

const audited = walk(join(REPO_ROOT, 'packages'))
  .filter(file => /[/\\]src[/\\]/.test(file))
  .map(file => ({
    path: relative(REPO_ROOT, file).replace(/\\/g, '/'),
    audit: auditComments(readFileSync(file, 'utf8')),
  }))

describe('注释门禁', () => {
  it('注释里没有 Markdown 标题与 emoji', () => {
    const violations: string[] = []
    for (const { path, audit } of audited) {
      for (const { line, text } of audit.lines) {
        if (MARKDOWN_HEADING.test(text)) violations.push(`${path}:${line} 标题 ${text}`)
        if (EMOJI.test(text)) violations.push(`${path}:${line} emoji ${text}`)
      }
    }
    expect(violations, '注释不是设计文档：小节标题放 docs，表情与符号不要往注释里塞').toEqual([])
  })

  it('已清扫文件守住硬指标，注释行数不再增长', () => {
    const byPath = new Map(audited.map(item => [item.path, item.audit]))
    const problems: string[] = []
    for (const [path, budget] of Object.entries(CLEANED)) {
      const audit = byPath.get(path)
      if (audit === undefined) {
        problems.push(`${path} 不在扫描结果里（文件被移动或改名了？）`)
        continue
      }
      if (audit.lines.length > budget) {
        problems.push(`${path} 注释 ${audit.lines.length} 行 > 冻结 ${budget}`)
      }
      for (const { line, text } of audit.lines) {
        if (hanCount(text) > MAX_HAN_PER_LINE) {
          problems.push(`${path}:${line} 单行 ${hanCount(text)} 汉字 > ${MAX_HAN_PER_LINE}`)
        }
      }
      for (const line of audit.longDocblocks) {
        problems.push(`${path}:${line} Docblock 内容超过 ${MAX_DOCBLOCK_LINES} 行`)
      }
    }
    expect(problems, '清扫过的文件不许退化；新增注释请先自查 CONVENTIONS.md 的判据').toEqual([])
  })

  it('全仓注释内容行总数不超过预算', () => {
    const total = audited.reduce((sum, item) => sum + item.audit.lines.length, 0)
    expect(total, `全仓注释内容行 ${total} > 预算 ${TOTAL_BUDGET}；收紧请下调 TOTAL_BUDGET`)
      .toBeLessThanOrEqual(TOTAL_BUDGET)
  })

  it('全仓超长注释行与超长 Docblock 不超过存量', () => {
    const over30 = audited.reduce((sum, item) =>
      sum + item.audit.lines.filter(line => hanCount(line.text) > MAX_HAN_PER_LINE).length, 0)
    const longDoc = audited.reduce((sum, item) => sum + item.audit.longDocblocks.length, 0)
    expect(over30, `单行超过 ${MAX_HAN_PER_LINE} 汉字的注释行 ${over30} > 存量 ${OVER30_BUDGET}`)
      .toBeLessThanOrEqual(OVER30_BUDGET)
    expect(longDoc, `内容超过 ${MAX_DOCBLOCK_LINES} 行的 Docblock ${longDoc} > 存量 ${LONG_DOCBLOCK_BUDGET}`)
      .toBeLessThanOrEqual(LONG_DOCBLOCK_BUDGET)
  })

  it.runIf(process.env.COMMENT_BUDGET_REPORT === '1')('报表：基线数值（收紧基线用）', () => {
    const rows = audited
      .map(item => ({ path: item.path, lines: item.audit.lines.length }))
      .filter(row => row.lines > 0)
      .sort((a, b) => b.lines - a.lines)
    for (const row of rows) console.log(`${String(row.lines).padStart(4)}  '${row.path}': ${row.lines},`)
    const over30 = audited.reduce((sum, item) =>
      sum + item.audit.lines.filter(line => hanCount(line.text) > MAX_HAN_PER_LINE).length, 0)
    const longDoc = audited.reduce((sum, item) => sum + item.audit.longDocblocks.length, 0)
    const total = audited.reduce((sum, item) => sum + item.audit.lines.length, 0)
    console.log(`总计 ${total} / 超 ${MAX_HAN_PER_LINE} 汉字行 ${over30} / 超长 Docblock ${longDoc}`)
    expect(rows.length).toBeGreaterThan(0)
  })
})
