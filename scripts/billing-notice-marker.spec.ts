/**
 * 「预算跨档提醒」的已提醒标记，必须活着穿过 dsh 的设置下发投影。
 *
 * 起因（本文件钉住的就是这条）：`notices.budgetNotified` 曾声明成 `Schema.object({})`。
 * dsh 下发给浏览器的设置值是**按 schema 声明字段投影**的（harness
 * `packages/settings/settings/src/schema.ts#projectForm`：object 类型只保留 `schema.dict` 里
 * 声明过的键）。空 object 的 `dict` 是空的 ⇒ `{"2026-09":"1"}` 被裁成 `{}`：宿主落盘是对的，
 * 客户端读到的 `notified` 却恒为空，于是「每个月份 + 档位只提醒一次」在浏览器里永远不成立 ——
 * 60s 心跳每重判一次就重弹一次（点「知道了」后同一页待一会儿又自己冒出来）。这正是它能躲过
 * 肉眼检查的原因：去查落盘配置，标记明明在。
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../packages/plugin-usage-billing/src/settings.ts'
import { evaluateBudget } from '../packages/plugin-usage-billing/src/budget.ts'

/** 投影真正读到的两个字段（schemastery 实例就是这形状）。 */
interface SchemaNode { type?: string; dict?: Record<string, SchemaNode> }

/** dsh `projectForm` 的等价实现：object 只留声明过的键，dict / 标量原样放行。 */
function projectForm(schema: SchemaNode, value: unknown): unknown {
  if (schema.type === 'object' && value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = (value as Record<string, unknown>)[key]
      return field === undefined ? [] : [[key, projectForm(child, field)]]
    }))
  }
  return value
}

/** 取一份 schema 的 notices 节点（Config 或对照用的手写节点）。 */
function noticesNode(schema: unknown): SchemaNode {
  return ((schema as SchemaNode).dict?.notices as SchemaNode | undefined) ?? {}
}

/** 本机真实落点：2026-09 已提醒过 50% 档（预算 600 / 已用 348 = 58%）。 */
const STORED = { backfillDismissed: true, budgetNotified: { '2026-09': '1' } }

/** 下发到浏览器时，客户端真正读到的 `notices.budgetNotified`。 */
function budgetNotifiedOf(schema: unknown): unknown {
  return (projectForm(noticesNode(schema), STORED) as { budgetNotified: unknown }).budgetNotified
}

describe('跨档提醒标记的下发契约', () => {
  it('budgetNotified 声明为 dict —— object 会在下发投影里被裁空', () => {
    expect(noticesNode(Config).dict?.budgetNotified?.type).toBe('dict')
  })

  it('下发投影后月份键仍在', () => {
    expect(budgetNotifiedOf(Config)).toEqual({ '2026-09': '1' })
  })

  it('拿投影后的标记判 58%：档位仍算到 1，但不再提醒', () => {
    const state = evaluateBudget({
      spentCny: 348, monthlyCny: 600, enabled: true,
      notified: budgetNotifiedOf(Config) as Record<string, string>, monthKey: '2026-09',
    })
    expect(state.tier).toBe(1)
    expect(state.shouldNotify).toBeNull()
  })

  it('对照：空 object 声明（曾经的写法）投影出 {}，于是每拍心跳都重弹', () => {
    // 只改 budgetNotified 的声明形状，其余节点与真实 Config 同形。
    const broken: SchemaNode = {
      type: 'object',
      dict: {
        notices: {
          type: 'object',
          dict: {
            backfillDismissed: { type: 'boolean' },
            budgetNotified: { type: 'object', dict: {} },
          },
        },
      },
    }
    expect(budgetNotifiedOf(broken)).toEqual({})
    expect(evaluateBudget({
      spentCny: 348, monthlyCny: 600, enabled: true,
      notified: budgetNotifiedOf(broken) as Record<string, string>, monthKey: '2026-09',
    }).shouldNotify).toBe(1)
  })
})
