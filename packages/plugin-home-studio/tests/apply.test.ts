/**
 * 骨架冒烟测试：host/client apply 空占位可被 cordis 加载、不抛错。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply as hostApply } from '../src/index.ts'
import { apply as clientApply } from '../src/client/index.ts'

describe('plugin-home-studio skeleton', () => {
  it('host 与 client 的 apply 占位可执行且不抛错', async () => {
    const ctx = new Context()
    expect(() => hostApply(ctx)).not.toThrow()
    expect(() => clientApply(ctx)).not.toThrow()
    await ctx.fiber.dispose()
  })

  it('client 图标入口可解析 lucide 类型', async () => {
    const icons = await import('../src/client/icons.ts')
    expect(icons).toBeDefined()
  })
})
