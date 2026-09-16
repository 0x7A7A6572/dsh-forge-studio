import { describe, expect, it } from 'vitest'
import { USAGE_BILLING_METHOD_NAMES, USAGE_BILLING_REMOTE_METHODS } from '../src/remote-methods.ts'
import {
  USAGE_BILLING_REMOTE_AUGMENTATIONS, usageBillingRemoteContribution,
} from '../src/client/core/remote.ts'
import type { UsageBillingRemote, UsageBillingRemoteMethod } from '../src/client/core/remote.ts'
import { USAGE_BILLING_NAMESPACE } from '../src/types.ts'

/**
 * 编译期双向断言（`pnpm typecheck` 会检查本文件）：
 * descriptor 是从 host 名单生成的，删方法时它自己也缩水、运行时断言全绿；
 * 真正无守卫的是**手写类型面** —— 这两行要求接口方法名与 host 名单完全一致，
 * 任一方向多/少都在 `tsc -p tsconfig.tests.json` 报错。
 */
type Assert<T extends true> = T
type _HostMethodCoversSurface = Assert<UsageBillingRemoteMethod extends keyof UsageBillingRemote ? true : false>
type _SurfaceCoversHostMethod = Assert<keyof UsageBillingRemote extends UsageBillingRemoteMethod ? true : false>

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

  it('手写类型面的增广键与 host 名单逐键相等（删 host 方法必须红）', () => {
    // descriptor 是从 host 名单生成的，删方法时它自己也少一条、上面几个用例全绿；
    // 这条断言钉的是**手写类型面**：多一个键 = 接口还在广告一个运行时不存在的方法。
    expect(Object.keys(USAGE_BILLING_REMOTE_AUGMENTATIONS)).toEqual([...USAGE_BILLING_METHOD_NAMES])
    expect(USAGE_BILLING_REMOTE_METHODS.map((m) => m.method))
      .toEqual(Object.keys(USAGE_BILLING_REMOTE_AUGMENTATIONS))
  })
})
