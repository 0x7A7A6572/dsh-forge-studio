/**
 * @forge-studio/dsh-plugin-notes —— client 入口（browser bundle）。
 * 独立 UI 设计（不经会话流）：
 * 1. 挂载 Typert 远程命名空间 notes（host NotesService 直连，见 notes-remote.ts）
 * 2. 注册 sidebar.footer.action 入口按钮（点开便签板）
 * 3. 注册 shell.overlay 便签板浮层（列表 + tiptap 编辑 + 置顶/删除）
 * 4. 注册 settings.plugin.item 设置卡片（key=forge-studio.notes）
 */

import { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { NotesConfig } from '../types.ts'
import { NOTES_NAMESPACE } from '../types.ts'
import { mountNotesRemote, notesOf } from './core/notes-remote.ts'
import { NotesBoardEntry } from './views/board-entry.tsx'
import { NotesBoardOverlay, type NotesBoardFace } from './views/board-overlay.tsx'
import { NotesCardController } from './core/notes-card-controller.ts'
import { NotesSettingsCard } from './views/settings-card.tsx'

export const name = '@forge-studio/dsh-plugin-notes/client'
export const inject = ['slots', 'settingsScope', 'remote', 'typert']

export function apply(ctx: Context): void {
  // 第一层：先挂载 notes 远程命名空间（self-mount，不走会话）。
  ctx.inject(['slots', 'settingsScope', 'remote', 'typert'], async (ctx) => {
    await mountNotesRemote(ctx)
    // 第二层：命名空间就绪后再读 remote.notes（cordis 要求读服务必须声明在 inject 里）。
    ctx.inject(['remote.notes', 'remote', 'slots', 'settingsScope'], (ctx) => {
      const notes = notesOf(ctx)

      const settingsScope = ctx.settingsScope.bind<NotesConfig>({ namespace: NOTES_NAMESPACE })
      const face = (): NotesBoardFace => ({
        notes,
        maxVisibleNotes: settingsScope.getSnapshot().value?.maxVisibleNotes,
        defaultTitle: settingsScope.getSnapshot().value?.defaultTitle ?? '新便签',
      })

      // 1) 入口按钮：侧栏底部「设置」旁。
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'notes-board', order: -10, label: '便签' },
          NotesBoardEntry,
        ),
      )

      // 2) 便签板浮层：全屏独立 UI，直连 host。
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          { name: 'shell.overlay', id: 'notes-board', order: 0, inject: () => face() },
          NotesBoardOverlay,
        ),
      )

      // 3) 设置卡片。
      ctx.slots.inject('settings.plugin.item', () => {
        const controller = new NotesCardController(ctx.settingsScope.bind<NotesConfig>({ namespace: NOTES_NAMESPACE }))
        return ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: NOTES_NAMESPACE,
            inject: () => controller.inject(),
          },
          NotesSettingsCard,
        )
      })
    })
  })
}
