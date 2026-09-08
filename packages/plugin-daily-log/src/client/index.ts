/**
 * @zzerx/dsh-plugin-daily-log/client —— client 入口（browser bundle）。
 * 独立 UI 设计（不经会话流），显示形式对齐 dsh-task-board：
 * 1. 挂载 Typert 远程命名空间 dailyLog（host DailyLogService 直连，见 core/remote.ts）
 * 2. 侧栏 DOM 入口行（见 core/sidebar-entry.ts）
 * 3. 中间列面板接管（数据源/生成/报告/模板，见 core/panel-mount.ts + views/board.tsx）
 */

import { createElement } from 'react'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { mountDailyLogRemote, dailyLogOf } from './core/remote.ts'
import { mountDailyLogSidebarEntry } from './core/sidebar-entry.ts'
import { mountDailyLogPanel } from './core/panel-mount.ts'
import { DailyLogBoard, type DailyLogBoardFace } from './views/board.tsx'

export const name = '@zzerx/dsh-plugin-daily-log/client'
export const inject = ['slots', 'remote']

export function apply(ctx: Context): void {
  // 第一层：先挂载 dailyLog 远程命名空间（self-mount，不走会话）。
  ctx.inject(['slots', 'remote'], async (ctx) => {
    await mountDailyLogRemote(ctx)
    // 第二层：命名空间就绪后再读 remote.dailyLog。
    ctx.inject(['remote.dailyLog', 'remote', 'slots'], (ctx) => {
      const dailyLog = dailyLogOf(ctx)
      const face = (): DailyLogBoardFace => ({ dailyLog })

      try {
        const disposeEntry = mountDailyLogSidebarEntry()
        const disposePanel = mountDailyLogPanel({
          render: (root) => root.render(createElement(DailyLogBoard, { face: face() })),
        })
        ctx.effect(() => () => {
          disposeEntry()
          disposePanel()
        }, 'plugin-daily-log: ui surfaces')
      } catch (error) {
        console.error('[plugin-daily-log] mount failed:', error)
      }
    })
  })
}
