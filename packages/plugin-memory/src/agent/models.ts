/**
 * 后台模型目录：把宿主自己的 LLM 注册表投影成面板「后台模型」下拉要的分组形状。
 *
 * 用途：记忆的两条后台流程（对话提炼、写入判定）默认跑「当前会话 / 部署默认」的模型，
 * 面板里可以指定一个别的模型专门跑它们（例如用便宜快的小模型提炼、用强模型判定）。
 * 下拉的可选项就是这里给的 —— 即 dsh 已配置且可路由的那些模型。
 *
 * 全链路 fail-safe：拿不到 llm 服务、注册表抛错、某个 provider 列不出来，
 * 都只是「这个 provider 不进目录」，绝不让设置面板跟着报错。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MemoryModelGroup, MemoryModelOption } from '../types.ts'
import { serviceOf } from './capture.ts'

/** llm 服务里本插件用到的那一小片（只读目录，不发起调用）。 */
interface LlmDirectoryLike {
  listProviders?: () => readonly unknown[]
  listModels?: (provider: string) => Promise<readonly unknown[]>
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function nameOf(record: Record<string, unknown>, fallback: string): string {
  const name = record.name
  return typeof name === 'string' && name !== '' ? name : fallback
}

/**
 * 列出可选的（provider, model）分组；任何一环缺失或抛错都退化成空数组。
 * 只保留「至少有一个模型」的 provider —— 空组在下拉里只是一个点不开的分隔条。
 */
export async function listModelGroups(ctx: Context): Promise<readonly MemoryModelGroup[]> {
  const llm = serviceOf<LlmDirectoryLike>(ctx, 'llm')
  const listProviders = llm?.listProviders
  const listModels = llm?.listModels
  if (listProviders === undefined || listModels === undefined) return []
  let providers: readonly unknown[]
  try {
    providers = listProviders.call(llm)
  } catch {
    return []
  }
  if (!Array.isArray(providers)) return []
  const groups = await Promise.all(providers.map(async (raw): Promise<MemoryModelGroup | undefined> => {
    const provider = asRecord(raw)
    const id = typeof provider?.id === 'string' ? provider.id : ''
    if (id === '') return undefined
    let models: readonly unknown[]
    try {
      models = await listModels.call(llm, id)
    } catch {
      return undefined
    }
    if (!Array.isArray(models)) return undefined
    const options: MemoryModelOption[] = []
    for (const entry of models) {
      const model = asRecord(entry)
      const modelId = typeof model?.id === 'string' ? model.id : ''
      if (modelId === '') continue
      options.push({ id: modelId, name: nameOf(model!, modelId) })
    }
    if (options.length === 0) return undefined
    return { id, name: nameOf(provider!, id), models: options }
  }))
  return groups.filter((group): group is MemoryModelGroup => group !== undefined)
}
