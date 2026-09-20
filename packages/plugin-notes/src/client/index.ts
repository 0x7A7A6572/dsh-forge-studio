/**
 * @zzerx/dsh-plugin-notes —— client 入口（browser bundle）。
 *
 * 四件事，按顺序：
 * 1. 挂载 Typert 远程命名空间 notes（host NotesService 直连，见 core/notes-remote.ts）
 * 2. 注册**便签板主面板**：\`main\` 的 keyed 槽 + 同名 \`sidebar.panellist\` 图标字形。
 *    两者 id 必须一致（core/notes-panel 的 NOTES_PANEL_ID）—— 侧栏那个字形与主面板
 *    是同一件事的两半，选中与渲染都交给 ui-layout，不再抢中间列的 DOM。字形里还挂着
 *    待办数与快捷新建 (＋)：侧栏只给一个字形位，这两件东西只能长在里面（见
 *    components/NotesPanelIcon 的取舍说明）。
 * 3. 注册会话/侧栏的**增量入口**：输入栏工具条（记一笔 | 打开便签板 | 待办数，
 *    **一个**注册含三项）、助手消息「存成便签」、全局快捷新建浮层。
 *    全部走 list 槽，纯叠加，不替换任何官方 UI。（轮次结尾那个入口已删除：一轮对话
 *    结尾再放一个按钮，与「存成便签」重复且位置更差。）
 * 4. 注册**右侧栏 tab 类型**（宿主可选能力）：notes 类型 + 一张导引卡片，导引页点一下
 *    就把它作为 tab 开在右侧栏，板子本体复用同一个 NotesBoard（不是第二份）。
 *
 * 入口整理（本次）：输入框左右两个按钮合并成左侧一条工具条；会话顶栏那两个入口、轮次
 * 结尾入口、侧栏底部图标入口都已删除（位置不合适或与别的入口重复）。清单与开关见
 * types.ts 的 NotesEntryConfig。
 *
 * 5. 注册 **dsh 设置 → 便签** 分区（settings.section）：默认标题/默认工作区/入口开关/
 *    WebDAV 备份都在那里。板内不再有设置弹窗与齿轮入口 —— 设置入口本身也是入口，
 *    放在板内就会被「入口全关」锁在门外；dsh 设置是自己的入口，不受影响。
 *    （原「用方法直接打开 dsh 设置到指定条目」预研结论：宿主没有这个能力，见
 *    docs/superpowers/specs 的入口整合设计文档。）
 *
 * 跨包一律 **type-only import**（唯一目的是把 SlotMap 增广带进来拿类型，运行时零依赖），
 * 与仓库其它插件同姿态。
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
// type-only：sidebar.right.* 座位声明 + Context 上的 sidebarRightTabs（右侧栏 tab 类型注册表）。
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// type-only：settings.section 槽位声明（便签的设置分区）。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotesConfig } from '../types.ts'
import { DEFAULT_NOTES_ENTRY_CONFIG, NOTES_NAMESPACE } from '../types.ts'
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
/** \`layout\` 必须声明：读服务（ctx.layout）在 cordis 里要求先 inject。 */
export const inject = ['slots', 'settingsScope', 'remote', 'typert', 'layout']

/** 各入口在宿主列表里的排序：统一排在多数官方条目之后，靠后展示。 */
const ORDER = 60

/** 右侧栏 tab 类型的 id（= body/title 座位的 key，注册表按它去重）。 */
const NOTES_TAB_ID = '@zzerx/dsh-plugin-notes'

/** 右侧栏 tab 的 kind：导引卡片被点开时按它路由（与主面板 id 同字，但属于两套命名空间）。 */
const NOTES_TAB_KIND = 'notes'

export function apply(ctx: Context): void {
  // 第一层：先挂载 notes 远程命名空间（self-mount，不走会话）。
  ctx.inject(['slots', 'settingsScope', 'remote', 'typert', 'layout'], async (ctx) => {
    await mountNotesRemote(ctx)
    // 第二层：命名空间就绪后再读 remote.notes（cordis 要求读服务必须声明在 inject 里）。
    ctx.inject(['remote.notes', 'remote', 'slots', 'settingsScope', 'layout'], (ctx) => {
      const notes = notesOf(ctx)
      // 命名空间 scope：设置弹窗读写 defaultTitle / defaultWorkspace / entry 开关。
      const scope = ctx.settingsScope.bind<NotesConfig>({ namespace: NOTES_NAMESPACE })

      /** 打开便签板：选中 main 面板。未注册时 selectPanel 会抛，降级为只记日志。 */
      const openBoard = (): void => {
        try {
          ctx.layout.selectPanel(NOTES_PANEL_ID)
        } catch (error) {
          console.error('[plugin-notes] open board failed:', error)
        }
      }
      /** 关闭便签板：null = 回到会话。 */
      const closeBoard = (): void => {
        try {
          ctx.layout.selectPanel(null)
        } catch (error) {
          console.error('[plugin-notes] close board failed:', error)
        }
      }

      // 所有入口共用的注入面：组件因此不碰 ctx，也不 import 跨包运行时值。
      const face: NotesUiFace = {
        notes,
        scope,
        openBoard,
        // 可带预填草稿：助手消息「存成便签」把那条回答带进快捷新建浮层。
        capture: (draft) => {
          boardStore.showQuickAdd(draft)
        },
        // 落库调用：把 RemoteResult 的 ok 面收窄成组件要的形状（错误只取 message）。
        create: async (input) => {
          const result = await notes.create({
            title: input.title,
            text: input.text,
            color: input.color,
            ...(input.laneStatus !== undefined ? { laneStatus: input.laneStatus } : {}),
            ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
          })
          if (result.ok) return { ok: true }
          return { ok: false, error: (result as { error?: { message?: string } }).error }
        },
        // 工作区候选（任务开关的下拉）：只读端点，失败即「无候选」。
        listWorkspaces: async () => {
          const result = await notes.listWorkspaces()
          return result.ok ? result.value : []
        },
        onCreated: () => {
          void refreshNotesStats()
        },
      }

      const boardFace = { ...face, closeBoard }

      // ---- 便签板本体：main keyed 槽 + 侧栏顶部入口（id 必须一致）----

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: NOTES_PANEL_ID,
      }, () => createElement(NotesBoard, { face: boardFace })))

      // 侧栏字形也带开关（sidebarPanelIcon）；设置页保证入口不至于全关。
      // 字形里额外长出待办数与快捷新建 (＋)，所以 capture 也要传进去。
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: NOTES_PANEL_ID,
        order: ORDER,
        label: NOTES_PANEL_LABEL,
      }, (props) => createElement(NotesPanelIcon, {
        ...props,
        scope,
        capture: face.capture,
        label: NOTES_PANEL_LABEL,
      })))

      // ---- 会话区增量入口（全是 list 槽，纯叠加）----

      // 输入框只留这一个注册：记一笔 | 打开便签板 | 待办数，三项在一条工具条里。
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'zzerx-notes-toolbar',
        order: ORDER,
        label: '便签入口',
      }, () => createElement(NotesInputToolbar, { ...face })))

      // owner 只给 messageId，正文由组件自己从 chat 快照取（useChat 是 session 标准 prop）。
      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'zzerx-notes-save-message',
        order: ORDER,
        label: '存成便签',
      }, (props) => createElement(NotesSaveMessageAction, { ...face, ...props })))

      // ---- 全局浮层 ----

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'zzerx-notes-quickadd',
        order: ORDER,
        label: '快捷新建便签',
      }, () => createElement(NotesQuickAddOverlay, { ...face })))

      // ---- dsh 设置 → 便签（settings.section）----
      //
      // 便签的设置页。分区自己不再持 ctx：远程通道与命名空间 scope 走 inject 面。
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'notes',
        order: ORDER,
        label: '便签',
        inject: () => ({ notes, scope }),
      }, SettingsSection))

      // ---- 右侧栏：notes tab 类型 + 导引卡片 ----
      //
      // sidebarRightTabs 是**宿主可选**能力（没装右侧栏的部署里这个服务不出现），所以
      // 用嵌套 inject 等它：等不到就整块不注册，绝不因此让插件 apply 挂住。
      // 导引卡片是 tab 类型注册表的投影（registry.guide()），所以「关掉这个入口」=
      // 注销该类型；body 座位留着不动 —— 没有类型就没有 tab 会路由到它。
      ctx.inject(['sidebarRightTabs'], (ctx) => {
        let disposeTabType: (() => void) | undefined

        /** 读开关并把 tab 类型注册/注销到与之一致的状态（幂等）。 */
        const syncTabType = (): void => {
          const enabled = scope.getSnapshot().value?.entry?.rightSidebarGuide
            ?? DEFAULT_NOTES_ENTRY_CONFIG.rightSidebarGuide
          if (enabled === (disposeTabType !== undefined)) return
          if (enabled) {
            disposeTabType = ctx.sidebarRightTabs.register({
              id: NOTES_TAB_ID,
              kind: NOTES_TAB_KIND,
              priority: 'extension',
              title: () => NOTES_PANEL_LABEL,
              guide: [{
                id: 'open-board',
                order: ORDER,
                title: () => NOTES_PANEL_LABEL,
                description: () => '在右侧栏打开便签板',
                icon: NotesGuideIcon,
              }],
            })
            return
          }
          const dispose = disposeTabType
          disposeTabType = undefined
          dispose?.()
        }

        const offScope = scope.subscribe(syncTabType)
        syncTabType()

        // 板子本体复用同一个 NotesBoard（见 views/notes-sidebar-body）。
        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: NOTES_TAB_ID,
        }, (props) => createElement(NotesSidebarBody, { ...props, notes, scope })))

        ctx.effect(() => () => {
          offScope()
          const dispose = disposeTabType
          disposeTabType = undefined
          dispose?.()
        }, 'plugin-notes: right sidebar tab type')
      })

      // ---- 非槽位的模块级挂载（徽标统计 / 宿主推送订阅）----
      // 挂载失败只降级便签板，绝不能把整个 GUI 拖垮（web shell 在插件 apply 抛错时
      // 会整体 boot 失败）。disposer 随 fiber 卸载回收。
      try {
        const disposeStats = mountNotesStats(() => notes.list())
        // 事件驱动核心：订阅宿主 notes/watch 推送（徽标、开板板内容即时同步）。
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
