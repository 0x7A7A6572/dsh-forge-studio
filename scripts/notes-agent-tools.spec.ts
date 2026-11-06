/**
 * agent 工具输出 schema 的漂移门禁：输出值就是整张 NoteRecord，
 * 校验按 additionalProperties:false 走，漏声明一个字段整次 notes_* 调用都判非法。
 */
import { describe, expect, it } from 'vitest'
import { NOTE_OUTPUT_SCHEMA } from '../packages/plugin-notes/src/agent/tools.ts'
import type { NoteLane, NoteRecord } from '../packages/plugin-notes/src/types.ts'

interface Spec {
  readonly type?: string
  readonly required?: boolean
  readonly additionalProperties?: boolean
  readonly properties?: Readonly<Record<string, Spec>>
  readonly items?: Spec
  readonly enum?: readonly unknown[]
}

const isTypeOf = (value: unknown, type: string): boolean => {
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value)
  if (type === 'array') return Array.isArray(value)
  return typeof value === type
}

function violations(value: unknown, spec: Spec, path = 'value'): string[] {
  if (spec.type !== undefined && !isTypeOf(value, spec.type)) return [`${path} is not ${spec.type}`]
  if (spec.enum !== undefined && !spec.enum.includes(value)) return [`${path} is not one of ${spec.enum.join(', ')}`]

  const out: string[] = []
  if (Array.isArray(value)) {
    const items = spec.items
    if (items !== undefined) value.forEach((item, index) => out.push(...violations(item, items, `${path}[${index}]`)))
    return out
  }
  if (typeof value !== 'object' || value === null) return out

  const record = value as Record<string, unknown>
  const properties = spec.properties ?? {}
  for (const [key, child] of Object.entries(record)) {
    const childSpec = properties[key]
    if (childSpec === undefined) {
      if (spec.additionalProperties === false) out.push(`${path}.${key} is not a declared property`)
      continue
    }
    out.push(...violations(child, childSpec, `${path}.${key}`))
  }
  for (const [key, child] of Object.entries(properties)) {
    if (child.required === true && !Object.hasOwn(record, key)) out.push(`${path}.${key} is required`)
  }
  return out
}

const NOW = 1_792_000_000_000

const TASK_LANE: NoteLane = {
  status: 'todo',
  run: { startedAt: NOW - 60_000, by: 'schedule' },
  runs: [
    { startedAt: NOW - 3_660_000, finishedAt: NOW - 3_600_000, ok: false, summary: '超时未收尾', by: 'schedule' },
    { startedAt: NOW - 60_000, finishedAt: NOW, ok: true, summary: 'ok' },
  ],
  agentPreset: 'fast',
  model: { provider: 'deepseek', model: 'deepseek-flash' },
}

const TASK_NOTE: NoteRecord = {
  id: 'n1' as NoteRecord['id'],
  title: '【演示】间隔触发的同步任务',
  text: '每 3 小时同步一次；日历只显示下一次。',
  pinned: false,
  archived: false,
  color: 'yellow',
  origin: 'user',
  createdAt: NOW - 86_400_000,
  updatedAt: NOW,
  workspace: 'F:\\codes\\dsh-forge-studio',
  dueAt: NOW + 86_400_000,
  lane: TASK_LANE,
  schedule: {
    enabled: true,
    mode: 'interval',
    everyMin: 180,
    nextAt: NOW + 3_600_000,
    lastFiredAt: NOW - 60_000,
    lastResult: '已派发',
    failureStreak: 0,
    runCount: 6,
  },
}

describe('NOTE_OUTPUT_SCHEMA', () => {
  it('带执行历史的任务便签原样通过', () => {
    expect(violations(TASK_NOTE, NOTE_OUTPUT_SCHEMA)).toEqual([])
  })

  it('无 lane / schedule 的普通便签通过', () => {
    const plain: NoteRecord = {
      id: 'n2' as NoteRecord['id'],
      title: '',
      text: '',
      pinned: true,
      archived: false,
      color: 'blue',
      origin: 'agent',
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(violations(plain, NOTE_OUTPUT_SCHEMA)).toEqual([])
  })

  it('未声明的 lane 字段会被判非法（校验器非空转）', () => {
    const drifted = { ...TASK_NOTE, lane: { ...TASK_LANE, mystery: 1 } }
    expect(violations(drifted, NOTE_OUTPUT_SCHEMA)).toContain('value.lane.mystery is not a declared property')
  })
})
