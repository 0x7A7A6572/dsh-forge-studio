/**
 * @zzerx/dsh-plugin-notes —— client 入口（browser bundle）。
 * 独立 UI 设计（不经会话流），显示形式对齐 dsh-task-board：
 * 1. 挂载 Typert 远程命名空间 notes（host NotesService 直连，见 notes-remote.ts）
 * 2. 侧栏 DOM 入口行（新建会话按钮与工作区浏览器之间，见 core/sidebar-entry.ts）
 * 3. 中间列面板接管（列表 + tiptap 编辑 + 置顶/归档/删除 + 搜索/色筛 +
 *    懒加载 + 设置弹窗，见 core/panel-mount.ts + views/board-view.tsx）
 * 设置（默认标题）不再注册到插件设置页，改为便签板内弹窗读写（face 暴露
 * settingsScope 绑定的命名空间 scope）。
 */

import { createElement } from 'react'
import { Context } from '@deepseek-ai/cordis'
// 载入 renderer 的 Context 增广（ctx.slots），type-only，无运行时依赖。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// 载入会话控制器的 client 面类型（ctx.sessions），type-only，无运行时依赖。
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { NotesConfig } from '../types.ts'
import { NOTES_NAMESPACE } from '../types.ts'
import { mountNotesRemote, notesOf } from './core/notes-remote.ts'
import { mountNotesSidebarEntry } from './core/sidebar-entry.ts'
import { mountNotesPanel } from './core/panel-mount.ts'
import { NotesBoard, type NotesBoardFace } from './views/board-view.tsx'

export const name = '@zzerx/dsh-plugin-notes/client'
export const inject = ['slots', 'settingsScope', 'remote', 'typert']

export function apply(ctx: Context): void {
  // 第一层：先挂载 notes 远程命名空间（self-mount，不走会话）。
  ctx.inject(['slots', 'settingsScope', 'remote', 'typert'], async (ctx) => {
    await mountNotesRemote(ctx)
    // 第二层：命名空间就绪后再读 remote.notes（cordis 要求读服务必须声明在 inject 里）。
    ctx.inject(['remote.notes', 'remote', 'slots', 'settingsScope'], (ctx) => {
      const notes = notesOf(ctx)
      // 命名空间 scope：设置弹窗读写 defaultTitle（便签板内，不再走插件设置页）。
      const scope = ctx.settingsScope.bind<NotesConfig>({ namespace: NOTES_NAMESPACE })

      const face = (): NotesBoardFace => ({
        notes,
        scope,
        // 会话 id（执行投递目标）：惰性读 ctx.sessions 的当前选中会话
        // （session-controller client 在宿主 Web shell 恒装配；不可得时降级空串，
        // 由 board-view 的 §8 提示兜底，见 board-view.currentSessionId）。
        currentSessionId: () => {
          const sessions = ctx.get('sessions') as ISessions | undefined
          return sessions?.list.getSnapshot().current ?? ''
        },
      })

      // DOM 挂载失败只降级便签板，绝不能把整个 GUI 拖垮（web shell 在插件
      // apply 抛错时会整体 boot 失败）。disposer 随 fiber 卸载回收。
      try {
        const disposeEntry = mountNotesSidebarEntry()
        const disposePanel = mountNotesPanel({
          render: (root) => root.render(createElement(NotesBoard, { face: face() })),
        })
        ctx.effect(() => () => {
          disposeEntry()
          disposePanel()
        }, 'plugin-notes: ui surfaces')
      } catch (error) {
        console.error('[plugin-notes] mount failed:', error)
      }
    })
  })
}
