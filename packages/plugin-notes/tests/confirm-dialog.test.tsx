/**
 * ConfirmDialog 渲染级测试：结构（遮罩 + role=dialog + aria-modal）、要点逐条、
 * 按钮文案与强调色描边。用 react-dom/server 静态渲染断言结构（无 DOM、不触发交互；
 * Esc/点遮罩/回车确认属于事件行为，靠实现保持与既有弹窗同构）。
 */

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfirmDialog } from '../src/client/components/confirm-dialog.tsx'

const noop = (): void => undefined

function render(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}): string {
  return renderToStaticMarkup(
    <ConfirmDialog
      title="开启定时执行？"
      description="到点由宿主自动新建会话替你执行（等价于点「执行」）。"
      confirmLabel="开启定时"
      onConfirm={noop}
      onCancel={noop}
      {...overrides}
    />,
  )
}

describe('ConfirmDialog（通用确认弹窗）', () => {
  it('模态结构：遮罩 + role=dialog + aria-modal，标题同时作为无障碍名', () => {
    const html = render()
    expect(html).toContain('fs-note-overlay')
    expect(html).toContain('fs-note-dialog')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="开启定时执行？"')
    expect(html).toContain('到点由宿主自动新建会话替你执行')
  })

  it('要点逐条渲染（后果清单，不是一坨长句）', () => {
    const html = render({ bullets: ['周期：每天 09:00', '工作区：D:/ws'] })
    expect(html).toContain('周期：每天 09:00')
    expect(html).toContain('工作区：D:/ws')
    expect(html.match(/<li/g)).toHaveLength(2)
  })

  it('按钮：主按钮用传入的动词短语，次按钮缺省「取消」', () => {
    expect(render()).toContain('开启定时')
    expect(render()).toContain('取消')
    expect(render({ cancelLabel: '再想想' })).toContain('再想想')
  })

  it('强调色落到左侧描边（便签纸色环 → 弹窗认领所属便签）', () => {
    expect(render({ accent: '#e8b60a' })).toContain('#e8b60a')
  })
})
