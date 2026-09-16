import { describe, expect, it } from 'vitest'
import { fakeTable } from './fake-table.ts'

/**
 * 测试替身自己也要被钉住：它是「非法键再也过不了绿灯」的唯一守卫。
 * 校验规则与报错文案照抄 `@deepseek-ai/dsh-storage-json` 的 assertSafeKey。
 */
describe('fakeTable（复刻真实 per-record 键规则）', () => {
  it('put / delete / update 拒绝非路径安全的键', async () => {
    const table = fakeTable<number>()
    await expect(table.put('s1#2', 1)).rejects.toThrow(/not path-safe/)
    await expect(table.delete('a/b')).rejects.toThrow(/not path-safe/)
    await expect(table.update('..', (v) => v)).rejects.toThrow(/not path-safe/)
    await expect(table.put('', 1)).rejects.toThrow(/not path-safe/)
    await expect(table.put('deepseek\u0000x', 1)).rejects.toThrow(/not path-safe/)
    expect(table.size).toBe(0)
  })

  it('报错文案与真实后端逐字一致', async () => {
    const table = fakeTable<number>('usage_billing')
    await expect(table.put('s1#2', 1)).rejects.toThrow(
      "unit 'usage_billing': per-record key 's1#2' is not path-safe (must match /^[a-zA-Z0-9_-]+$/)",
    )
  })

  it('读路径与真实后端一样宽容：get 不因键非法而抛', () => {
    const table = fakeTable<number>()
    expect(table.get('s1#2')).toBeUndefined()
    expect([...table.entries()]).toEqual([])
    expect([...table.keys()]).toEqual([])
  })

  it('安全键照常读写（大小写敏感的字符串键，不做任何归一）', async () => {
    const table = fakeTable<string>()
    await table.put('session-abc__19', 'v')
    expect(table.get('session-abc__19')).toBe('v')
    await table.update('session-abc__19', (v) => `${v}!`)
    expect(table.get('session-abc__19')).toBe('v!')
    expect(await table.delete('session-abc__19')).toBe(true)
    expect(await table.delete('session-abc__19')).toBe(false)
  })
})
