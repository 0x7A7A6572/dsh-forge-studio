import { describe, expect, it } from 'vitest'
import { USAGE_BILLING_REMOTE_METHODS } from '../src/remote-methods.ts'
import { usageBillingRemoteContribution } from '../src/client/core/remote.ts'
import { USAGE_BILLING_NAMESPACE } from '../src/types.ts'

describe('Remote 契约防漂移', () => {
  it('descriptor 数量与唯一来源一致', () => {
    expect(usageBillingRemoteContribution.descriptors).toHaveLength(USAGE_BILLING_REMOTE_METHODS.length)
  })

  it('每个 descriptor 的 method 与参数名逐个对齐（顺序敏感）', () => {
    for (const spec of USAGE_BILLING_REMOTE_METHODS) {
      const d = usageBillingRemoteContribution.descriptors.find((x) => x.method === spec.method)
      expect(d, `missing descriptor for ${spec.method}`).toBeDefined()
      expect(d!.parameters.map((p) => p.name)).toEqual([...spec.params])
      expect(d!.id).toBe(`usageBilling.${spec.method}`)
    }
  })

  it('所有参数走 json 源、结果走 src-json 透传', () => {
    for (const d of usageBillingRemoteContribution.descriptors) {
      for (const p of d.parameters) expect(p.source).toBe('json')
      expect((d.result as { mode: string }).mode).toBe('src-json')
    }
  })

  it('设置命名空间单一来源（client 与 host 都取自 types.ts）', () => {
    expect(USAGE_BILLING_NAMESPACE).toBe('forge-studio-usage-billing')
  })

  it('contribution 声明了包名（与 host 同包）', () => {
    expect(usageBillingRemoteContribution.package).toBe('@zzerx/dsh-plugin-usage-billing')
  })
})
