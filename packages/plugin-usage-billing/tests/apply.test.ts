import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, name } from '../src/index.ts'

describe('host apply', () => {
  it('导出包名', () => {
    expect(name).toBe('@zzerx/dsh-plugin-usage-billing')
  })

  it('storageDomain 缺失时 apply 不抛（优雅降级）', async () => {
    await expect(apply(new Context())).resolves.toBeUndefined()
  })
})
