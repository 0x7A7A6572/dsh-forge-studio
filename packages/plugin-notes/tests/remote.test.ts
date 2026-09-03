/**
 * 远程通道一致性测试：client 贡献的端点/参数 wire 名必须与 host
 * NotesService 的方法及形参名完全一致（gateway SRC 模式按函数源码
 * 解析形参名作为 wire 键；client 侧 strict codec 校验入参）。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { NotesService } from '../src/service.ts'
import { notesRemoteContribution } from '../src/client/core/notes-remote.ts'

/** 解析函数形参名（与 gateway methodParameterNames 同一思路）。 */
function parameterNames(fn: (...args: never[]) => unknown): string[] {
  const source = Function.prototype.toString.call(fn)
  const match = source.match(/^[^(]*\(\s*([^)]*)\)/)
  if (!match) return []
  return match[1]
    .split(',')
    .map((part) => part.trim().split(/[=:]/)[0])
    .filter((name) => name.length > 0 && name !== 'signal')
}

describe('notes remote contribution', () => {
  it('贡献包名与命名空间/服务 key 正确', () => {
    expect(notesRemoteContribution.package).toBe('@forge-studio/dsh-plugin-notes')
    for (const d of notesRemoteContribution.descriptors) {
      expect(d.namespace).toBe('notes')
      expect(d.service).toBe('notes')
      expect(d.invocation).toEqual({ kind: 'direct' })
      expect(d.result.mode).toBe('src-json')
    }
  })

  it('覆盖 host 的五个公开方法端点', () => {
    const methods = notesRemoteContribution.descriptors.map((d) => d.method).sort()
    expect(methods).toEqual(['create', 'delete', 'list', 'setPinned', 'update'])
    const ids = notesRemoteContribution.descriptors.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('host 服务已挂 Typert SRC 标记（remoteMethods 可发现）', () => {
    // 不跑构造函数（避免触碰 domain/table），仅验证原型上的 marker。
    const markers = remoteMethods(Object.create(NotesService.prototype)).map((m) => m.method)
    expect(markers.sort()).toEqual(['create', 'delete', 'list', 'setPinned', 'update'])
  })

  it('参数 wire 名与 host 方法形参名一致且 codec 为 strict', () => {
    const prototype = NotesService.prototype as unknown as Record<string, (...args: never[]) => unknown>
    for (const d of notesRemoteContribution.descriptors) {
      const host = prototype[d.method]
      expect(host, `host 缺少方法 ${d.method}`).toBeTypeOf('function')
      const wires = d.parameters.map((p) => p.wire)
      expect(wires).toEqual(parameterNames(host))
      for (const p of d.parameters) {
        expect(p.name).toBe(p.wire)
        expect(p.codec.mode).toBe('strict')
        expect(typeof (p.codec as { schema: { parse: unknown } }).schema.parse).toBe('function')
      }
    }
  })

  it('client $mount 的 typert.remotes.register 校验通过（registry 全量规则）', async () => {
    const ctx = new Context()
    new TypertRegistry(ctx) // provides ctx.typert
    const dispose = await ctx.typert.remotes.register(notesRemoteContribution)
    const list = ctx.typert.remotes.list()
    expect(list.length).toBe(5)
    expect(list.map((d) => `${d.namespace}/${d.method}`).sort()).toEqual([
      'notes/create',
      'notes/delete',
      'notes/list',
      'notes/setPinned',
      'notes/update',
    ])
    await dispose()
    await ctx.fiber.dispose()
  })

  it('create/update 的 strict codec 拒绝畸形输入', () => {
    const byMethod = new Map(notesRemoteContribution.descriptors.map((d) => [d.method, d]))
    const createInput = byMethod.get('create')!.parameters[0]!.codec as { schema: { parse: (v: unknown) => unknown } }
    expect(() => createInput.schema.parse({ text: 'hi' })).not.toThrow()
    expect(() => createInput.schema.parse({ text: 1 })).toThrow()
    expect(() => createInput.schema.parse({})).toThrow()

    const updateInput = byMethod.get('update')!.parameters[1]!.codec as { schema: { parse: (v: unknown) => unknown } }
    expect(() => updateInput.schema.parse({ pinned: true })).not.toThrow()
    expect(() => updateInput.schema.parse({ pinned: 'yes' })).toThrow()
  })

  it('update codec 接受 archived 布尔并拒绝字符串', () => {
    const byMethod = new Map(notesRemoteContribution.descriptors.map((d) => [d.method, d]))
    const updateInput = byMethod.get('update')!.parameters[1]!.codec as { schema: { parse: (v: unknown) => unknown } }
    expect(() => updateInput.schema.parse({ archived: true })).not.toThrow()
    expect(() => updateInput.schema.parse({ archived: false })).not.toThrow()
    expect(() => updateInput.schema.parse({ archived: 'yes' })).toThrow()
    const parsed = updateInput.schema.parse({ archived: true }) as { archived?: unknown }
    expect(parsed.archived).toBe(true)
  })

  it('create/update codec 放行合法 color 并透传', () => {
    const byMethod = new Map(notesRemoteContribution.descriptors.map((d) => [d.method, d]))
    const createInput = byMethod.get('create')!.parameters[0]!.codec as { schema: { parse: (v: unknown) => unknown } }
    const created = createInput.schema.parse({ text: 'hi', color: 'green' }) as { color?: unknown }
    expect(created.color).toBe('green')
    const updateInput = byMethod.get('update')!.parameters[1]!.codec as { schema: { parse: (v: unknown) => unknown } }
    const patched = updateInput.schema.parse({ color: 'gray' }) as { color?: unknown }
    expect(patched.color).toBe('gray')
  })

  it('create/update codec 拒绝非法 color', () => {
    const byMethod = new Map(notesRemoteContribution.descriptors.map((d) => [d.method, d]))
    const createInput = byMethod.get('create')!.parameters[0]!.codec as { schema: { parse: (v: unknown) => unknown } }
    expect(() => createInput.schema.parse({ text: 'hi', color: 'neon' })).toThrow()
    const updateInput = byMethod.get('update')!.parameters[1]!.codec as { schema: { parse: (v: unknown) => unknown } }
    expect(() => updateInput.schema.parse({ color: 42 })).toThrow()
  })
})
