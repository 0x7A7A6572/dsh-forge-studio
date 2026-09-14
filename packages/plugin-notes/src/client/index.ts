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
import type { NotesConfig } from '../types.ts'
import { NOTES_NAMESPACE } from '../types.ts'
import { mountNotesRemote, notesOf } from './core/notes-remote.ts'
import { mountQuickAdd } from './core/quick-add.ts'
import { mountNotesSidebarEntry } from './core/sidebar-entry.ts'
import { mountNotesStats, mountNotesChangeWatch, refreshNotesStats } from './core/notes-stats.ts'
import { mountNotesPanel } from './core/panel-mount.ts'
import { NotesBoard, type NotesBoardFace } from './views/board-view.tsx'
import { QuickAddDialog } from './views/quick-add-dialog.tsx'

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

      // 执行不再依赖「当前会话」：host 按工作区新建会话后投递（见 task-dispatch），
      // 便签板因此在哪里打开都能执行任务。
      const face = (): NotesBoardFace => ({
        notes,
        scope,
      })

      // DOM 挂载失败只降级便签板，绝不能把整个 GUI 拖垮（web shell 在插件
      // apply 抛错时会整体 boot 失败）。disposer 随 fiber 卸载回收。
      try {
        const disposeEntry = mountNotesSidebarEntry()
        const disposeStats = mountNotesStats(() => notes.list())
        // 事件驱动核心：订阅宿主 notes/watch 推送（关板徽标、开板板内容即时同步）。
        const disposeWatch = mountNotesChangeWatch(notes)
        // 快捷新建独立浮层：不开便签板；保存成功落库后补刷一次徽标。
        const disposeQuickAdd = mountQuickAdd({
          render: (root) =>
            root.render(
              createElement(QuickAddDialog, {
                scope,
                create: async (input) => {
                  const result = await notes.create({
                    title: input.title,
                    text: input.text,
                    color: input.color,
                    ...(input.laneStatus !== undefined ? { laneStatus: input.laneStatus } : {}),
                    ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
                  })
                  if (result.ok) return { ok: true }
                  const err = result as { error?: { message?: string } }
                  return { ok: false, error: err.error }
                },
                // 工作区候选（任务开关的下拉）：只读端点，失败即「无候选」。
                listWorkspaces: async () => {
                  const result = await notes.listWorkspaces()
                  return result.ok ? result.value : []
                },
                onCreated: () => {
                  void refreshNotesStats()
                },
              }),
            ),
        })
        const disposePanel = mountNotesPanel({
          render: (root) => root.render(createElement(NotesBoard, { face: face() })),
        })
        ctx.effect(() => () => {
          disposeEntry()
          disposeStats()
          disposeWatch()
          disposeQuickAdd()
          disposePanel()
        }, 'plugin-notes: ui surfaces')
      } catch (error) {
        console.error('[plugin-notes] mount failed:', error)
      }
    })
  })
}