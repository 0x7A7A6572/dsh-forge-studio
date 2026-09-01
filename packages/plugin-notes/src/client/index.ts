/**
 * @forge-studio/dsh-plugin-notes —— client 入口（browser bundle）。
 * 1. 注册 note-list 会话节点定义（折叠 note/listed → 便签板卡片）
 * 2. 注册 conversation.chat.node 渲染器（key=note-list，含 /note 命令注入面）
 * 3. 注册 settings.plugin.item 设置卡片（key=forge-studio.notes）
 */

import { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
// type-only 载入官方 client 增广（slots: SlotRegistry），不产生运行时 import ——
// dsh-client-ui-renderer 由平台提供，bundle 不得打包它。
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
// 载入 settings.plugin.item 的 SlotMap 声明（ui-settings-plugins 的 slot-contract）。
import type { SettingsPluginItemOwnerProps } from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { NOTES_NAMESPACE, type NotesConfig } from '../types.ts'
import { NOTE_LIST_KIND, noteListDefinition } from './note-list-definition.ts'
import { NoteListView, type NoteListCardFace } from './note-list-view.tsx'
import { NotesCardController } from './notes-card-controller.ts'
import { NotesSettingsCard } from './settings-card.tsx'

export const name = '@forge-studio/dsh-plugin-notes/client'
export const inject = ['slots', 'uiConversation', 'sessions', 'settingsScope']

export function apply(ctx: Context): void {
  // 1) 会话节点定义
  ctx.inject(['uiConversation'], (ctx) => {
    ctx.uiConversation.events.register(noteListDefinition)
  })

  // 2) 便签板渲染器：注入 /note 命令执行 + 设置中的展示上限
  ctx.inject(['slots', 'sessions', 'settingsScope'], (ctx) => {
    const settingsScope = ctx.settingsScope.bind<NotesConfig>({ namespace: NOTES_NAMESPACE })
    // dsh-session（host 侧）与 client 侧都增广了 Context.sessions，类型合并结果
    // 不可靠；运行时这里拿到的一定是 client 的 ISessions，收窄一次。
    const sessions = ctx.sessions as unknown as ISessions
    ctx.slots.inject('conversation.chat.node', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.node',
          key: NOTE_LIST_KIND,
          inject: (sessionId): NoteListCardFace => ({
            maxVisibleNotes: settingsScope.getSnapshot().value?.maxVisibleNotes,
            async command(line) {
              const binding = sessions.binding(sessionId)
              if (!binding) return false
              const result = await binding.session.command(line)
              return result.ok === true && result.value.matched === true
            },
          }),
        },
        NoteListView,
      ),
    )
  })

  // 3) 设置卡片
  ctx.inject(['slots', 'settingsScope'], (ctx) => {
    ctx.slots.inject('settings.plugin.item', () => {
      const scope = ctx.settingsScope.bind<NotesConfig>({ namespace: NOTES_NAMESPACE })
      const controller = new NotesCardController(scope)
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
}
