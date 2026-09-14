/**
 * 冲突锁定（和别的记忆插件打架时的硬禁止）行为测试。
 *
 * 产品规则：检测到别的记忆插件占用了 memory_* 工具名 ⇒ 本插件整体让位 ——
 * 不注册任何工具、不注入记忆、不自动提炼，面板开关也改不动（host 侧直接拒绝）。
 * 这里覆盖 service 侧的锁：注入让位、开关硬拒绝、解锁恢复。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryService } from '../src/service.ts'
import type { MemoryConfig, MemoryRecord } from '../src/types.ts'

/** 最小 KvTable 假实现（service 只用到这几个方法）。 */
function makeService() {
  const rows = new Map<string, MemoryRecord>()
  const table = {
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    put: async (key: string, value: MemoryRecord) => { rows.set(key, value) },
    delete: async (key: string) => rows.delete(key),
  }
  let config: MemoryConfig = {
    autoCapture: true,
    autoInject: true,
    maxInjected: 6,
    importanceThreshold: 4,
    captureEveryTurns: 3,
    captureMaxTurns: 4,
    captureMaxChars: 4000,
    captureIncludeAssistant: false,
  }
  const settings = {
    get: () => ({ ...config }),
    update: async (patch: Partial<MemoryConfig>) => { config = { ...config, ...patch } },
    ready: () => true,
  }
  const ctx = new Context()
  const service = new MemoryService(ctx, { domain: { table: () => table }, settings } as never)
  return service
}

const OPTIONS = { maxItems: 10, threshold: 1 }

describe('冲突锁定', () => {
  it('无冲突不锁；冲突一到就锁；清空即解锁', async () => {
    const svc = makeService()
    expect(svc.isLocked()).toBe(false)
    expect(await svc.getConflicts()).toEqual([])

    const conflict = { name: 'memory_save', description: 'Save a memory entry' }
    svc.setConflicts([conflict])
    expect(svc.isLocked()).toBe(true)
    expect(await svc.getConflicts()).toEqual([conflict])

    svc.setConflicts([])
    expect(svc.isLocked()).toBe(false)
  })

  it('锁定时一条记忆都不注入（让位给另一个记忆插件）', async () => {
    const svc = makeService()
    await svc.save({ title: '偏好', content: '先给结论', importance: 5, scope: 'global', source: 'user' })
    expect(svc.injectCandidates('D:\\codes\\demo', OPTIONS)).toHaveLength(1)

    svc.setConflicts([{ name: 'memory_save', description: '' }])
    expect(svc.injectCandidates('D:\\codes\\demo', OPTIONS)).toHaveLength(0)
  })

  it('锁定时不允许改开关（面板点不动，host 也硬拒绝）', async () => {
    const svc = makeService()
    svc.setConflicts([{ name: 'memory_search', description: '' }])
    await expect(svc.setConfig({ autoCapture: true })).rejects.toThrow(/锁定/)
    await expect(svc.setConfig({ autoInject: false })).rejects.toThrow(/cannot|锁定|工具名/)
  })

  it('解锁后恢复正常读写', async () => {
    const svc = makeService()
    svc.setConflicts([{ name: 'memory_save', description: '' }])
    svc.setConflicts([])
    const config = await svc.setConfig({ autoCapture: false })
    expect(config.autoCapture).toBe(false)
    await svc.save({ title: 'a', content: 'b', importance: 5, scope: 'global', source: 'user' })
    expect(svc.injectCandidates(undefined, OPTIONS)).toHaveLength(1)
  })
})

/**
 * 复刻 dsh-api-gateway 对 SRC 方法的参数校验（packages/api/gateway/src/index.ts:1083-1095）：
 * 取方法**源码**括号内的文本、按逗号切分，每段必须是唯一的裸标识符。
 * 所以参数不能有默认值 / 解构 / rest —— 否则挂载时报
 * 'SRC method "list" must use unique identifier parameters without destructuring, defaults, or rest'。
 */
function gatewayParamNames(fn: (...args: never[]) => unknown): string[] {
  const source = Function.prototype.toString.call(fn)
  const open = source.indexOf('(')
  const close = source.indexOf(')', open + 1)
  if (open < 0 || close < 0) throw new Error('no parameter list')
  const body = source.slice(open + 1, close).trim()
  if (body === '') return []
  const names = new Set<string>()
  for (const part of body.split(',').map((piece) => piece.trim())) {
    if (!/^[$A-Z_a-z][$\w]*$/u.test(part) || names.has(part)) throw new Error('bad parameter: ' + part)
    names.add(part)
  }
  return [...names]
}

describe('SRC 远程方法签名', () => {
  it('被标记的每个方法，参数都是合规的裸标识符', () => {
    const marker = (MemoryService.prototype as unknown as Record<string, {
      version: number
      methods: { method: string }[]
    }>)['@deepseek-ai/dsh-typert-protocol/remote-methods']

    expect(marker.version).toBe(1)
    const methods = marker.methods.map((entry) => entry.method)
    expect(methods).toContain('list')
    expect(methods.length).toBeGreaterThanOrEqual(14)

    const proto = MemoryService.prototype as unknown as Record<string, (...args: never[]) => unknown>
    for (const method of methods) {
      expect(() => gatewayParamNames(proto[method]!), method).not.toThrow()
    }
  })
})
