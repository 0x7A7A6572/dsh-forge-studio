// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BackfillLedgerNote, BackfillNotice } from '../src/client/views/backfill-notice.tsx'

// 本仓没有 vitest 配置、`globals` 关闭，RTL 的自动 cleanup 依赖全局 afterEach 因而失效；
// 不显式清理的话上一用例的 DOM 会留下（表现就是 getByRole('button') 命中多个）。
afterEach(() => { cleanup() })

describe('BackfillNotice', () => {
  it('未关闭时显示提示，含安装时刻', () => {
    render(<BackfillNotice installAt={Date.UTC(2026, 8, 16, 6, 0)} dismissed={false} onDismiss={() => {}} />)
    expect(screen.getByText(/安装前/)).toBeTruthy()
    expect(screen.getByText(/估算/)).toBeTruthy()
  })

  it('已关闭时完全不渲染', () => {
    const { container } = render(<BackfillNotice installAt={1} dismissed onDismiss={() => {}} />)
    expect(container.textContent).toBe('')
  })

  it('点关闭调用 onDismiss', () => {
    const onDismiss = vi.fn()
    render(<BackfillNotice installAt={1} dismissed={false} onDismiss={onDismiss} />)
    screen.getByRole('button').click()
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

describe('BackfillLedgerNote', () => {
  it('常驻口径说明含快照 id', () => {
    render(<BackfillLedgerNote installAt={Date.UTC(2026, 8, 16, 6, 0)} snapshotId="snap-install" />)
    expect(screen.getByText(/snap-install/)).toBeTruthy()
  })
})
