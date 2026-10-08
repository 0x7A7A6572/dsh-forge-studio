/**
 * client 入口：挂载 notes 远程命名空间，再注册便签板主面板（main keyed 槽 + 同名
 * sidebar.panellist 图标，两者 id 必须一致）、会话区增量入口、右侧栏 tab 类型与设置分区。
 * 跨包一律 type-only import：只为带进 SlotMap 增广，运行时零依赖。
 */

import { createElement } from 'react'
import { Context } from '@deepseek-ai/cordis'
// type-only：载入 renderer 的 Context 增广（ctx.slots）。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// type-only：ctx.layout（主面板选择）+ main / shell.overlay 槽位声明。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// type-only：sidebar.panellist 槽位声明。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// type-only：conversation.input.* / conversation.session.header.* 槽位声明。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// type-only：conversation.chat.assistant-actions 槽位声明 + useChat 标准 prop。
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// type-only：sidebar.right.* 座位声明 + Context 上的 sidebarRightTabs。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// type-only：settings.section 槽位声明。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NoteOpenMode, NotesConfig, NotesEntryConfig } from '../types.ts'
import { DEFAULT_NOTES_ENTRY_CONFIG, NOTES_NAMESPACE, notesOpenMode } from '../types.ts'
import { mountNotesRemote, notesOf } from './core/notes-remote.ts'
import { boardStore } from './core/board-store.ts'
import { mountNotesStats, mountNotesChangeWatch, refreshNotesStats } from './core/notes-stats.ts'
import {
  NOTES_PANEL_ID,
  NOTES_PANEL_LABEL,
} from './core/notes-panel.ts'
import type { NotesUiFace } from './core/notes-ui-face.ts'
import { NotesBoard } from './views/notes-board/NotesBoard.tsx'
import { NotesSidebarBody } from './views/notes-sidebar-body/NotesSidebarBody.tsx'
import { NotesPanelIcon } from './components/NotesPanelIcon.tsx'
import { NotesInputToolbar } from './components/NotesInputToolbar.tsx'
import { NotesSaveMessageAction } from './components/NotesSaveMessageAction.tsx'
import { NotesQuickAddOverlay } from './components/NotesQuickAddOverlay.tsx'
import { NotesGuideIcon } from './components/NotesGuideIcon.tsx'
import { SettingsSection } from './views/settings-section/SettingsSection.tsx'

export const name = '@zzerx/dsh-plugin-notes/client'
/** `layout` 必须声明：读服务（ctx.layout）在 cordis 里要求先 inject。 */
export const inject = ['slots', 'configForms', 'remote', 'typert', 'layout']

/** 入口排序位：排在多数官方条目之后。 */
const ORDER = 60

/** 右侧栏 tab 类型 id：同时是 body/title 座位的 key。 */
const NOTES_TAB_ID = '@zzerx/dsh-plugin-notes'

/** 右侧栏 tab 的 kind：与主面板 id 同字，但属另一套命名空间。 */
const NOTES_TAB_KIND = 'notes'

export function apply(ctx: Context): void {
  ctx.inject(['slots', 'configForms', 'remote', 'typert', 'layout'], async (ctx) => {
    await mountNotesRemote(ctx)
    // remote.notes 就绪后才能读：cordis 要求读服务先声明在 inject 里。
    ctx.inject(['remote.notes', 'remote', 'slots', 'configForms', 'layout'], (ctx) => {
      const notes = notesOf(ctx)
      // 命名空间 = host 侧 profile 条目 id；值来自 Config 的 volatile 字段。
      const scope = ctx.configForms.get<NotesConfig>(NOTES_NAMESPACE)

      const readEntry = (key: keyof NotesEntryConfig): boolean =>
        scope.getSnapshot().value?.entry?.[key] ?? DEFAULT_NOTES_ENTRY_CONFIG[key]

      /** 非法值由 notesOpenMode 回退成中间列。 */
      const readOpenMode = (): NoteOpenMode => notesOpenMode(scope.getSnapshot().value)

      /** 宿主没装右侧栏时恒为 undefined；返回 false 表示调用方回退中间列。 */
      let openBoardInRightSidebar: (() => boolean) | undefined

      const openBoard = (): void => {
        if (readOpenMode() === 'right' && openBoardInRightSidebar?.() === true) return
        try {
          ctx.layout.selectPanel(NOTES_PANEL_ID)
        } catch (error) {
          console.error('[plugin-notes] open board failed:', error)
        }
      }
      const openTaskLanes = (): void => {
        boardStore.setView('lanes')
        openBoard()
      }
      /** null = 回到会话。 */
      const closeBoard = (): void => {
        try {
          ctx.layout.selectPanel(null)
        } catch (error) {
          console.error('[plugin-notes] close board failed:', error)
        }
      }

      const face: NotesUiFace = {
        notes,
        scope,
        openBoard,
        openTaskLanes,
        capture: (draft) => {
          boardStore.showQuickAdd(draft)
        },
        create: async (input) => {
          const result = await notes.create({
            title: input.title,
            text: input.text,
            color: input.color,
            ...(input.laneStatus !== undefined ? { laneStatus: input.laneStatus } : {}),
            ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
            ...(input.agentPreset !== undefined ? { agentPreset: input.agentPreset } : {}),
            ...(input.model !== undefined ? { model: input.model } : {}),
          })
          if (result.ok) return { ok: true }
          return { ok: false, error: (result as { error?: { message?: string } }).error }
        },
        listWorkspaces: async () => {
          const result = await notes.listWorkspaces()
          return result.ok ? result.value : []
        },
        listTaskTargets: async () => {
          const result = await notes.taskTargets()
          return result.ok ? result.value : { models: [], presets: [] }
        },
        onCreated: () => {
          void refreshNotesStats()
        },
      }

      const boardFace = { ...face, closeBoard }

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: NOTES_PANEL_ID,
      }, () => createElement(NotesBoard, { face: boardFace })))

      // 关掉必须注销注册：宿主自画按钮外壳，返回 null 只会剩一条空壳。
      ctx.slots.inject('sidebar.panellist', () => {
        let disposePanel: (() => void) | undefined

        const syncPanelEntry = (): void => {
          const enabled = readEntry('sidebarPanelIcon')
          if (enabled === (disposePanel !== undefined)) return
          if (enabled) {
            // 字形里挂着快捷新建，故 capture 也要传进去。
            disposePanel = ctx.slots.register({
              name: 'sidebar.panellist',
              id: NOTES_PANEL_ID,
              order: ORDER,
              label: NOTES_PANEL_LABEL,
            }, (props) => createElement(NotesPanelIcon, {
              ...props,
              capture: face.capture,
              label: NOTES_PANEL_LABEL,
            }))
            return
          }
          const dispose = disposePanel
          disposePanel = undefined
          dispose?.()
        }

        const offPanelScope = scope.subscribe(syncPanelEntry)
        syncPanelEntry()

        return () => {
          offPanelScope()
          const dispose = disposePanel
          disposePanel = undefined
          dispose?.()
        }
      })

      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'zzerx-notes-toolbar',
        order: ORDER,
        label: '便签入口',
      }, () => createElement(NotesInputToolbar, { ...face })))

      // owner 只给 messageId，正文由组件自己从 chat 快照取。
      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'zzerx-notes-save-message',
        order: ORDER,
        label: '存成便签',
      }, (props) => createElement(NotesSaveMessageAction, { ...face, ...props })))

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'zzerx-notes-quickadd',
        order: ORDER,
        label: '快捷新建便签',
      }, () => createElement(NotesQuickAddOverlay, { ...face })))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'notes',
        order: ORDER,
        label: '便签',
        inject: () => ({ notes, scope }),
      }, SettingsSection))

      // 两块都是宿主可选能力，等不到就整块不注册。
      // tab 类型常驻注册（openTab 要求 kind 已注册）；开关只管导引卡片。
      ctx.inject(['sidebarRight', 'sidebarRightTabs'], (ctx) => {
        let disposeTabType: (() => void) | undefined
        let registeredWithGuide: boolean | undefined

        const syncTabType = (): void => {
          const withGuide = readEntry('rightSidebarGuide')
          if (disposeTabType !== undefined && registeredWithGuide === withGuide) return
          const dispose = disposeTabType
          disposeTabType = undefined
          dispose?.()
          const guide = withGuide
            ? [{
                id: 'open-board',
                order: ORDER,
                title: () => NOTES_PANEL_LABEL,
                description: () => '在右侧栏打开便签板',
                icon: NotesGuideIcon,
              }]
            : undefined
          disposeTabType = ctx.sidebarRightTabs.register({
            id: NOTES_TAB_ID,
            kind: NOTES_TAB_KIND,
            priority: 'extension',
            title: () => NOTES_PANEL_LABEL,
            ...(guide === undefined ? {} : { guide }),
          })
          registeredWithGuide = withGuide
        }

        /** openTab 在 kind 未注册时会抛，必须兜住。 */
        openBoardInRightSidebar = (): boolean => {
          try {
            ctx.sidebarRight.openTab(NOTES_TAB_KIND)
            return true
          } catch (error) {
            console.error('[plugin-notes] open in right sidebar failed, falling back to main:', error)
            return false
          }
        }

        const offScope = scope.subscribe(syncTabType)
        syncTabType()

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: NOTES_TAB_ID,
        }, (props) => createElement(NotesSidebarBody, { ...props, notes, scope })))

        ctx.effect(() => () => {
          offScope()
          openBoardInRightSidebar = undefined
          const dispose = disposeTabType
          disposeTabType = undefined
          dispose?.()
        }, 'plugin-notes: right sidebar tab type')
      })

      // 挂载抛错会让整个 GUI boot 失败，只能降级便签板。
      try {
        const disposeStats = mountNotesStats(() => notes.list())
        const disposeWatch = mountNotesChangeWatch(notes)
        ctx.effect(() => () => {
          disposeStats()
          disposeWatch()
        }, 'plugin-notes: stats + change watch')
      } catch (error) {
        console.error('[plugin-notes] mount failed:', error)
      }
    })
  })
}
