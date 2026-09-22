/**
 * 任务执行目标（模型 / agent 预设）与「设为任务」保存决策的门禁。
 *
 * 背景：M2 给任务便签加了两个可选执行目标（模型 / agent 预设），落库位置是 lane 上
 * 的可选字段。保存决策一旦算错，轻则把用户选的目标静默丢掉（看起来「选了没用」），
 * 重则用陈旧快照覆盖宿主已写回的值。所以把决策压成纯函数钉在这里。
 *
 * 另：第 4 条改造后「任务必须有工作区」是硬约束，错在编辑器侧（UI）与 host 侧
 * （missing-workspace）各挡一道，这里只钉纯函数那一部分。
 */
import { describe, expect, it } from 'vitest'
import {
  lanePatchForSave,
  modelKey,
  modelSelectGroups,
  parseModelKey,
  taskTargetCreateInput,
} from '../packages/plugin-notes/src/client/core/task-lanes.ts'
import type { NoteLane, NoteModelSelection } from '../packages/plugin-notes/src/types.ts'

const MODEL_A: NoteModelSelection = { provider: 'deepseek', model: 'deepseek-flash' }
const MODEL_B: NoteModelSelection = { provider: 'deepseek', model: 'deepseek-v4-pro' }

function lane(extra: Partial<NoteLane>): NoteLane {
  return { status: 'todo', ...extra }
}

describe('lanePatchForSave —— 既有语义（不含执行目标）', () => {
  it('开关关且原本不是任务 → 不发 lane（纯内容更新）', () => {
    expect(lanePatchForSave(false, 'todo', undefined)).toBeUndefined()
  })

  it('开关关且原本是任务 → clear（取消任务）', () => {
    expect(lanePatchForSave(false, 'todo', lane({}))).toEqual({ clear: true })
  })

  it('开关开且状态未变 → 不发 lane（避免陈旧快照回滚宿主状态）', () => {
    expect(lanePatchForSave(true, 'todo', lane({}))).toBeUndefined()
  })

  it('开关开且状态变了 → 只发 status', () => {
    expect(lanePatchForSave(true, 'running', lane({ status: 'todo' }))).toEqual({ status: 'running' })
  })

  it('开关开且原本无 lane → 发 status（普通便签转任务）', () => {
    expect(lanePatchForSave(true, 'todo', undefined)).toEqual({ status: 'todo' })
  })
})

describe('lanePatchForSave —— 执行目标（模型 / agent 预设）', () => {
  it('目标与既有值一致 → 不发这两个字段', () => {
    const current = lane({ agentPreset: 'fast', model: MODEL_A })
    expect(lanePatchForSave(true, 'todo', current, { agentPreset: 'fast', model: MODEL_A })).toBeUndefined()
  })

  it('预设改了 → 只发 agentPreset', () => {
    const current = lane({ agentPreset: 'fast', model: MODEL_A })
    expect(lanePatchForSave(true, 'todo', current, { agentPreset: 'thorough', model: MODEL_A }))
      .toEqual({ agentPreset: 'thorough' })
  })

  it('预设清空（回到宿主默认）→ 发空串（唯一清除信号）', () => {
    const current = lane({ agentPreset: 'fast' })
    expect(lanePatchForSave(true, 'todo', current, { agentPreset: '   ' })).toEqual({ agentPreset: '' })
  })

  it('模型改了 → 只发 model', () => {
    const current = lane({ model: MODEL_A })
    expect(lanePatchForSave(true, 'todo', current, { agentPreset: '', model: MODEL_B }))
      .toEqual({ model: MODEL_B })
  })

  it('模型清空（回到宿主默认）→ 发 null（唯一清除信号）', () => {
    const current = lane({ model: MODEL_A })
    expect(lanePatchForSave(true, 'todo', current, { agentPreset: '' })).toEqual({ model: null })
  })

  it('原本无 lane、目标是宿主默认 → 只发 status（不凭空写空字段）', () => {
    expect(lanePatchForSave(true, 'todo', undefined, { agentPreset: '' })).toEqual({ status: 'todo' })
  })

  it('状态与目标同时变 → 三项合并成一次 patch', () => {
    const current = lane({ status: 'todo', agentPreset: 'fast', model: MODEL_A })
    expect(lanePatchForSave(true, 'running', current, { agentPreset: 'thorough', model: MODEL_B }))
      .toEqual({ status: 'running', agentPreset: 'thorough', model: MODEL_B })
  })

  it('reasoningEffort 不同即视为模型变了', () => {
    const current = lane({ model: { ...MODEL_A, reasoningEffort: 'low' } })
    expect(lanePatchForSave(true, 'todo', current, { agentPreset: '', model: { ...MODEL_A, reasoningEffort: 'high' } }))
      .toEqual({ model: { ...MODEL_A, reasoningEffort: 'high' } })
  })

  it('开关关掉时不看目标：一律 clear', () => {
    const current = lane({ agentPreset: 'fast', model: MODEL_A })
    expect(lanePatchForSave(false, 'todo', current, { agentPreset: '', model: MODEL_B })).toEqual({ clear: true })
  })
})
describe('模型下拉的取值编解码', () => {
  it('往返一致（含 model id 里的斜杠）', () => {
    for (const model of [MODEL_A, MODEL_B, { provider: 'p', model: 'a/b/c' }]) {
      expect(parseModelKey(modelKey(model))).toEqual(model)
    }
  })

  it('空串 / 残破 key 一律回落「宿主默认」（undefined）', () => {
    expect(modelKey(undefined)).toBe('')
    expect(parseModelKey('')).toBeUndefined()
    expect(parseModelKey('onlyprovider')).toBeUndefined()
    expect(parseModelKey('provider\u0001')).toBeUndefined()
  })
})

describe('模型下拉的选项投影', () => {
  const GROUPS = [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'Flash' }] },
    { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-x', name: 'GPT X' }] },
  ]

  it('未选（undefined）→ 目录原样搬过来', () => {
    expect(modelSelectGroups(GROUPS, undefined).map((g) => [g.id, g.options.map((o) => o.key)]))
      .toEqual([['deepseek', [modelKey({ provider: 'deepseek', model: 'deepseek-flash' })]],
                ['openai', [modelKey({ provider: 'openai', model: 'gpt-x' })]]])
  })

  it('当前值在目录里 → 不重复补', () => {
    const groups = modelSelectGroups(GROUPS, { provider: 'openai', model: 'gpt-x' })
    expect(groups).toHaveLength(2)
    expect(groups[1]!.options).toHaveLength(1)
  })

  it('当前值的 provider 在目录里、模型不在 → 补进该组（不新增组）', () => {
    const groups = modelSelectGroups(GROUPS, { provider: 'openai', model: 'gpt-legacy' })
    expect(groups).toHaveLength(2)
    expect(groups[1]!.options.map((o) => o.label))
      .toEqual(['GPT X', 'gpt-legacy（不在当前目录）'])
  })

  it('当前值的 provider 整组都不在目录里 → 补一个独立组（旧值不被静默抹掉）', () => {
    const groups = modelSelectGroups(GROUPS, { provider: 'gone', model: 'm1' })
    expect(groups).toHaveLength(3)
    expect(groups[2]).toEqual({ id: 'gone', label: 'gone', options: [{ key: modelKey({ provider: 'gone', model: 'm1' }), label: 'm1（不在当前目录）' }] })
  })
})
describe('执行目标 → create 入参（新建路径）', () => {
  it('都用宿主默认 → 两个字段都不落（缺省即默认）', () => {
    expect(taskTargetCreateInput({ agentPreset: '' })).toEqual({})
    expect(taskTargetCreateInput({ agentPreset: '   ' })).toEqual({})
  })

  it('预设 trim 后落库；模型原样带上', () => {
    expect(taskTargetCreateInput({ agentPreset: ' fast ', model: MODEL_B }))
      .toEqual({ agentPreset: 'fast', model: MODEL_B })
  })

  it('只给预设 / 只给模型 各落各的', () => {
    expect(taskTargetCreateInput({ agentPreset: 'fast' })).toEqual({ agentPreset: 'fast' })
    expect(taskTargetCreateInput({ agentPreset: '', model: MODEL_A })).toEqual({ model: MODEL_A })
  })
})
