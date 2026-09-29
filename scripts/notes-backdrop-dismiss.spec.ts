/**
 * 弹窗遮罩「点外面就关」判定的门禁（issue #3）。
 *
 * 背景：标签/便签编辑页里按住鼠标选文字、把指针拖到编辑卡片外面再松手，页面会直接退出
 * 且不保存。原因不在编辑器，而在遮罩的那句 `onClick={onCancel}` —— 浏览器把 click 派发到
 * mousedown 与 mouseup 的**最近公共祖先**：卡片里按下、遮罩上松开，公共祖先正是遮罩，
 * 于是凭空多出一次「点了遮罩」。
 *
 * 修法是把「按下位置」纳入判定（core/backdrop-dismiss.ts）。这里用一棵无 DOM 的小树
 * 复刻浏览器的 click 派发规则，把真实事件序列钉住，防止回归。
 */
import { describe, expect, it } from 'vitest'
import {
  createBackdropDismissGuard,
} from '../packages/plugin-notes/src/client/core/backdrop-dismiss.ts'
import type { BackdropDismissGuard } from '../packages/plugin-notes/src/client/core/backdrop-dismiss.ts'

interface FakeNode {
  readonly name: string
  readonly parent?: FakeNode
}

/** 弹窗结构：遮罩 > 卡片 > 卡片里的正文/控件。 */
const overlay: FakeNode = { name: 'overlay' }
const card: FakeNode = { name: 'card', parent: overlay }
const editorBody: FakeNode = { name: 'editor-body', parent: card }

/** 复刻浏览器：click 派发到 mousedown / mouseup 两个目标的最近公共祖先。 */
function clickTargetOf(down: FakeNode, up: FakeNode): FakeNode {
  const ancestors = new Set<FakeNode>()
  for (let node: FakeNode | undefined = down; node; node = node.parent) ancestors.add(node)
  for (let node: FakeNode | undefined = up; node; node = node.parent) {
    if (ancestors.has(node)) return node
  }
  throw new Error('两个目标不在同一棵节点树里')
}

/** 走一轮完整序列：按下 → 松开 → 浏览器派 click，返回是否按「点了遮罩」处理。 */
function drag(guard: BackdropDismissGuard, down: FakeNode, up: FakeNode): boolean {
  guard.press(down, overlay)
  return guard.release(clickTargetOf(down, up), overlay)
}

describe('createBackdropDismissGuard —— 点遮罩关闭', () => {
  it('遮罩上按下、遮罩上松开 → 关闭', () => {
    expect(drag(createBackdropDismissGuard(), overlay, overlay)).toBe(true)
  })

  it('遮罩上按下、拖进卡片再松开（click 仍落在遮罩）→ 关闭', () => {
    expect(drag(createBackdropDismissGuard(), overlay, card)).toBe(true)
  })
})

describe('createBackdropDismissGuard —— 拉选区拖出卡片（issue #3 回归）', () => {
  it('卡片里按下选文字、拖到遮罩上松手（click 目标=遮罩）→ 不关', () => {
    expect(drag(createBackdropDismissGuard(), editorBody, overlay)).toBe(false)
  })

  it('卡片边框上按下、拖到遮罩上松手 → 不关', () => {
    expect(drag(createBackdropDismissGuard(), card, overlay)).toBe(false)
  })

  it('卡片里按下、卡片里松开 → 不关', () => {
    expect(drag(createBackdropDismissGuard(), editorBody, editorBody)).toBe(false)
  })

  it('卡片里按下、拖到卡片边框松开 → 不关', () => {
    expect(drag(createBackdropDismissGuard(), editorBody, card)).toBe(false)
  })

  it('按下发生在卡片子节点、click 冒泡到遮罩（目标=子节点）→ 不关', () => {
    const guard = createBackdropDismissGuard()
    guard.press(editorBody, overlay)
    expect(guard.release(editorBody, overlay)).toBe(false)
  })
})

describe('createBackdropDismissGuard —— 边界', () => {
  it('没按下就收到 click（目标=遮罩）→ 不关（不认来历不明的点击）', () => {
    expect(createBackdropDismissGuard().release(overlay, overlay)).toBe(false)
  })

  it('关一次就清膛：不重新按下，第二次 click 不再关', () => {
    const guard = createBackdropDismissGuard()
    guard.press(overlay, overlay)
    expect(guard.release(overlay, overlay)).toBe(true)
    expect(guard.release(overlay, overlay)).toBe(false)
  })

  it('上一轮是「卡片里按下」时，紧接着在遮罩上一点仍能正常关闭（不残留脏状态）', () => {
    const guard = createBackdropDismissGuard()
    expect(drag(guard, editorBody, overlay)).toBe(false)
    expect(drag(guard, overlay, overlay)).toBe(true)
  })
})
