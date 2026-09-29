/**
 * 便签草稿「改动判定」的门禁（core/note-draft-diff.ts）。
 *
 * 背景（issue #2）：便签只有关闸一道 —— X / 「取消」/ Esc / 点遮罩，关掉就等于丢弃这次
 * 编辑；新建便签没有库记录，关掉更是全丢。所以关闭前必须先答一个问题「用户改过东西吗」，
 * 而这个答案只由这一份签名说了算：
 * - 漏一个字段（纸色 / 任务状态 / 定时…）→ 改了却判成没改 → 静默丢改动；
 * - 多算一个字段（标题首尾空白）→ 什么都没改也弹窗 → 白弹。
 * 两条都是「不报错但用户会骂」的错，故逐字段钉在这里。
 */
import { describe, expect, it } from 'vitest'
import {
  isNoteDraftDirty,
  noteDraftSignature,
  type NoteDraftFields,
} from '../packages/plugin-notes/src/client/core/note-draft-diff.ts'

const SCHEDULE = { enabled: true, mode: 'interval', everyMin: 30 } as const

/** 基线草稿：普通黄色便签、一条待办正文。 */
const BASE: NoteDraftFields = {
  title: '买菜',
  body: '- 西红柿\n- 鸡蛋',
  color: 'yellow',
  taskOn: false,
  taskStatus: 'todo',
  workspace: '',
  agentPreset: '',
  modelValue: '',
}

/** 每个可变字段各改一处（漏字段就是漏一条用例，加字段时一并加在这里）。 */
const FIELD_CHANGES: ReadonlyArray<readonly [string, Partial<NoteDraftFields>]> = [
  ['标题', { title: '买菜（改）' }],
  ['正文', { body: '- 西红柿' }],
  ['纸色', { color: 'blue' }],
  ['任务开关', { taskOn: true }],
  ['任务状态', { taskStatus: 'running' }],
  ['工作区', { workspace: 'F:\\codes\\demo' }],
  ['agent 预设', { agentPreset: 'fast' }],
  ['模型', { modelValue: 'deepseek/deepseek-flash' }],
  ['定时日程', { schedule: SCHEDULE }],
]

describe('noteDraftSignature —— 逐字段敏感', () => {
  it('同一份草稿 → 签名稳定（判据不能自己抖）', () => {
    expect(noteDraftSignature(BASE)).toBe(noteDraftSignature({ ...BASE }))
  })

  it.each(FIELD_CHANGES)('%s 改了 → 签名跟着变', (_label, patch) => {
    expect(noteDraftSignature({ ...BASE, ...patch })).not.toBe(noteDraftSignature(BASE))
  })

  it('停用的日程与启用的日程不是同一个草稿', () => {
    const off = noteDraftSignature({ ...BASE, schedule: { ...SCHEDULE, enabled: false } })
    expect(off).not.toBe(noteDraftSignature({ ...BASE, schedule: SCHEDULE }))
  })

  it('标题首尾空白不算改动（点一下标题框不该变成「有改动」）', () => {
    expect(noteDraftSignature({ ...BASE, title: '  买菜  ' })).toBe(noteDraftSignature(BASE))
  })

  it('字段值里含分隔符也不会串味（用 JSON 而不是自拼分隔符的理由）', () => {
    const a = noteDraftSignature({ ...BASE, title: 'a,b', body: 'c' })
    const b = noteDraftSignature({ ...BASE, title: 'a', body: 'b,c' })
    expect(a).not.toBe(b)
  })
})

describe('isNoteDraftDirty —— 关闭前问不问', () => {
  it('还没有基线（编辑器未就绪）→ 一律算没改动，不弹', () => {
    expect(isNoteDraftDirty(null, BASE)).toBe(false)
    expect(isNoteDraftDirty(null, { ...BASE, title: '刚敲的' })).toBe(false)
  })

  it('与基线一致 → 没改动（直接关，不问）', () => {
    expect(isNoteDraftDirty(noteDraftSignature(BASE), { ...BASE })).toBe(false)
  })

  it.each(FIELD_CHANGES)('%s 改了 → 有改动（关前要问一句）', (_label, patch) => {
    expect(isNoteDraftDirty(noteDraftSignature(BASE), { ...BASE, ...patch })).toBe(true)
  })

  it('改了又改回原样 → 又变回没改动（编辑态打字后手动撤销，不该再问）', () => {
    const saved = noteDraftSignature(BASE)
    expect(isNoteDraftDirty(saved, { ...BASE, title: '临时' })).toBe(true)
    expect(isNoteDraftDirty(saved, { ...BASE })).toBe(false)
  })
})
