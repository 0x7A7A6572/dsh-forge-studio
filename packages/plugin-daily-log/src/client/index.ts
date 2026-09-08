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
import { boardStore } from './core/board-store.ts'

export const name = '@zzerx/dsh-plugin-daily-log/client'
export const inject = ['slots', 'remote']

export function apply(ctx: Context): void {
  // 第一层：先挂载 dailyLog 远程命名空间（self-mount，不走会话）。
  ctx.inject(['slots', 'remote'], async (ctx) => {
    await mountDailyLogRemote(ctx)
    // 第二层：命名空间就绪后再读 remote.dailyLog。
    ctx.inject(['remote.dailyLog', 'remote', 'slots'], (ctx) => {
      const dailyLog = dailyLogOf(ctx)
      /**
       * 指南页「填入聊天」：把文案写入当前会话的输入框（conversation.input 会话级
       * facade），收起面板回到对话并聚焦输入。会话/输入不可用时返回错误由 UI 提示。
       * 结构访问（sessions/conversation 属宿主能力，不注入即可惰性取用）。
       */
      const fillChat = async (text: string): Promise<{ ok: boolean; error?: string }> => {
        try {
          const sessions = (ctx as unknown as {
            sessions?: {
              list?: { getSnapshot(): { current?: string } }
              open(id: string): void
              scope(id: string): unknown
            }
          }).sessions
          const current = sessions?.list?.getSnapshot().current
          if (sessions === undefined || current === undefined || current === '') {
            return { ok: false, error: '当前没有可用会话，请先在左侧选择或新建一个会话。' }
          }
          sessions.open(current)
          const actx = sessions.scope(current)
          if (actx === undefined) return { ok: false, error: '会话上下文不可用，请稍后重试。' }
          const conversation = (actx as unknown as {
            conversation?: { input?: { for(c: unknown): { setDraft(t: string): void } } }
          }).conversation
          if (conversation?.input === undefined) return { ok: false, error: '聊天输入暂不可用，请直接手动输入。' }
          conversation.input.for(actx).setDraft(text)
          boardStore.hide()
          window.setTimeout(() => {
            document.querySelector<HTMLElement>('[data-composer-input]')?.focus()
          }, 60)
          return { ok: true }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      }
      const face = (): DailyLogBoardFace => ({ dailyLog, fillChat })

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
