/**
 * 后台模型（提炼 / 写入判定）的取值与投影门禁。
 *
 * 背景：面板新增「后台模型」配置 —— 从 dsh 已配置的模型里挑一个，专跑记忆的两条后台流程
 * （对话提炼、写入判定）；没配就沿用原来的回退链。三处容易静默出错，所以钉在这里：
 * - 路由优先级（面板指定 > 会话自身 > agentDefaultModel）算错 → 配了不生效，用户看不出来；
 * - 半截配置（只填了 provider）被当成有效 → 每次都发一次注定失败的调用；
 * - 下拉 value 编解码与「当前值不在目录里」的兜底项 → 一改别的设置就把旧值静默抹掉。
 */
import { describe, expect, it } from 'vitest'
import { configuredRoute, resolveRoute, serviceOf } from '../packages/plugin-memory/src/agent/capture.ts'
import { listModelGroups } from '../packages/plugin-memory/src/agent/models.ts'
import { modelKey, modelSelectGroups, parseModelKey } from '../packages/plugin-memory/src/client/core/memory-model.ts'
import { Config } from '../packages/plugin-memory/src/settings.ts'
import { MEMORY_CONFIG_BASE } from '../packages/plugin-memory/src/types.ts'
import type { MemoryModelGroup } from '../packages/plugin-memory/src/types.ts'

/** 只带 agentDefaultModel 的假 ctx（resolveRoute 的兜底来源）。 */
function ctxWithDefault(provider: string, model: string): never {
  return {
    get: (name: string) => (name === 'agentDefaultModel'
      ? { currentSelection: () => ({ provider, model }) }
      : undefined),
  } as never
}

/** 带 requestHeader 的假会话。 */
function sessionWith(provider: string, model: string): unknown {
  return { requestHeader: () => ({ config: { provider, model } }) }
}

describe('设置 schema —— 新字段不能只加在类型上', () => {
  it('schema 的字段与 MEMORY_CONFIG_BASE 一一对应（漏加一个 = 该字段永远是 undefined）', () => {
    const parsed = Config({}) as Record<string, unknown>
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(MEMORY_CONFIG_BASE).sort())
  })

  it('默认值 = 不指定（行为与从前一致）', () => {
    // dsh 0.1.7 起字段是 volatile 引用（设置表单只投影 volatile 字段、改值走热更新），
    // 默认值经 `.get()` 取 —— 与 host 运行时读的是同一个面。
    const parsed = Config({}) as Record<string, { get(): unknown }>
    expect(parsed.llmProvider.get()).toBe('')
    expect(parsed.llmModel.get()).toBe('')
  })
})

describe('configuredRoute —— 面板配置的后台模型', () => {
  it('两个字段都填了才算指定', () => {
    expect(configuredRoute({ llmProvider: 'deepseek', llmModel: 'deepseek-flash' }))
      .toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('前后空白被 trim（手工改过设置文件也不会带上空白）', () => {
    expect(configuredRoute({ llmProvider: ' deepseek ', llmModel: ' deepseek-flash ' }))
      .toEqual({ provider: 'deepseek', model: 'deepseek-flash' })
  })

  it('半截配置（只有一个字段）= 没配', () => {
    expect(configuredRoute({ llmProvider: 'deepseek', llmModel: '' })).toBeUndefined()
    expect(configuredRoute({ llmProvider: '', llmModel: 'deepseek-flash' })).toBeUndefined()
    expect(configuredRoute({ llmProvider: '   ', llmModel: '  ' })).toBeUndefined()
  })
})

describe('resolveRoute —— 三级回退', () => {
  it('面板指定的模型优先于会话自身与 agentDefaultModel', () => {
    const route = resolveRoute(ctxWithDefault('d', 'default'), sessionWith('s', 'session'), { provider: 'p', model: 'm' })
    expect(route).toEqual({ provider: 'p', model: 'm' })
  })

  it('没指定时用会话自身模型', () => {
    expect(resolveRoute(ctxWithDefault('d', 'default'), sessionWith('s', 'session'))).toEqual({ provider: 's', model: 'session' })
  })

  it('会话拿不到路由时退到 agentDefaultModel', () => {
    expect(resolveRoute(ctxWithDefault('d', 'default'), {})) .toEqual({ provider: 'd', model: 'default' })
  })

  it('三处都没有 = undefined（本次不提炼 / 不判定）', () => {
    expect(resolveRoute({ get: () => undefined } as never, undefined)).toBeUndefined()
  })

  it('空串的 preferred 不算指定，继续走会话路由', () => {
    expect(resolveRoute(ctxWithDefault('d', 'default'), sessionWith('s', 'session'), { provider: '', model: '' }))
      .toEqual({ provider: 's', model: 'session' })
  })
})

describe('listModelGroups —— 模型目录投影', () => {
  const llm = {
    listProviders: () => [
      { id: 'deepseek', name: 'DeepSeek' },
      { id: 'empty', name: '空 provider' },
      { id: 'broken', name: '坏 provider' },
    ],
    listModels: async (id: string) => {
      if (id === 'broken') throw new Error('provider 挂了')
      if (id === 'empty') return []
      return [{ id: 'deepseek-flash', name: 'Flash' }, { id: 'deepseek-v4-pro' }]
    },
  }
  const ctx = { get: (name: string) => (name === 'llm' ? llm : undefined) } as never

  it('按 provider 分组，模型名缺省回落到 id', async () => {
    expect(await listModelGroups(ctx)).toEqual([
      { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-flash', name: 'Flash' }, { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }] },
    ])
  })

  it('列不出模型的 provider 不进目录（空组在下拉里只是个点不开的分隔条）', async () => {
    const groups = await listModelGroups(ctx)
    expect(groups.map((group) => group.id)).toEqual(['deepseek'])
  })

  it('llm 服务缺席 = 空目录（面板只显示「跟随会话默认」）', async () => {
    expect(await listModelGroups({ get: () => undefined } as never)).toEqual([])
  })

  it('serviceOf 两条路都试：注册表拿不到就看属性', () => {
    expect(serviceOf<number>({ get: () => 1 } as never, 'x')).toBe(1)
    expect(serviceOf<number>({ x: 2 } as never, 'x')).toBe(2)
    expect(serviceOf<number>({} as never, 'x')).toBeUndefined()
  })
})

describe('后台模型下拉的取值与选项', () => {
  it('modelKey / parseModelKey 往返，model id 里的斜杠原样保留', () => {
    const model = { provider: 'deepseek', model: 'deepseek/deepseek-chat' }
    expect(parseModelKey(modelKey(model))).toEqual(model)
  })

  it('空串与形状不对 = 跟随会话默认', () => {
    expect(modelKey(undefined)).toBe('')
    expect(parseModelKey('')).toBeUndefined()
    expect(parseModelKey('deepseek')).toBeUndefined()
    expect(parseModelKey('\u0001model')).toBeUndefined()
    expect(parseModelKey('provider\u0001')).toBeUndefined()
  })

  const groups: readonly MemoryModelGroup[] = [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash', name: 'Flash' }] },
  ]

  it('目录原样投影成 optgroup', () => {
    expect(modelSelectGroups(groups, undefined)).toEqual([
      { id: 'deepseek', label: 'DeepSeek', options: [{ key: modelKey({ provider: 'deepseek', model: 'flash' }), label: 'Flash' }] },
    ])
  })

  it('当前值在目录里 → 不补兜底项', () => {
    const projected = modelSelectGroups(groups, { provider: 'deepseek', model: 'flash' })
    expect(projected[0]?.options).toHaveLength(1)
  })

  it('当前值不在目录里 → 补进同 provider 组（否则 select 空白，一保存就抹掉旧值）', () => {
    const projected = modelSelectGroups(groups, { provider: 'deepseek', model: 'gone' })
    expect(projected).toHaveLength(1)
    expect(projected[0]?.options[1]).toEqual({ key: modelKey({ provider: 'deepseek', model: 'gone' }), label: 'gone（不在当前目录）' })
  })

  it('整个 provider 都不在目录里 → 单独补一组', () => {
    const projected = modelSelectGroups(groups, { provider: 'other', model: 'gone' })
    expect(projected.map((group) => group.id)).toEqual(['deepseek', 'other'])
    expect(projected[1]?.options[0]?.label).toBe('gone（不在当前目录）')
  })
})
