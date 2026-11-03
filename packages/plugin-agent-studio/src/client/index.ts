/**
 * @zzerx/dsh-plugin-agent-studio/client —— client 入口（browser bundle）。
 *
 * 1. 挂载 agentStudio 远程命名空间；
 * 2. 设置面板注册「智能体工坊」分区；
 * 3. 输入框左侧注册一个智能体 / 团队选择 chip；
 * 4. 会话头注册「智能体团队」按钮，正文落在右侧栏；宿主没有右侧栏时降级为会话 View 页签。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// 右侧栏服务与 sidebar.right.pane.tab 的 SlotMap 增广来自本地 ambient 声明
// （src/client/types/sidebar-right.d.ts），不依赖 sidebar-right 包，避免构建机缺包。
import { agentStudioOf, mountAgentStudioRemote } from './core/remote.ts'
import {
  NO_STUDIO_CAPABILITIES,
  readStudioDetailCapabilities,
  type StudioDetailCapabilities,
  type StudioHostServicesView,
} from './core/capabilities.ts'
import {
  STUDIO_HEADER_ORDER,
  STUDIO_STAGE_KIND,
  STUDIO_STAGE_TAB_ID,
  STUDIO_STAGE_TITLE,
  shouldCommitSingleEntry,
  studioEntryActivationOf,
} from './core/stage-entry.ts'
import { AgentStudioSettings } from './views/settings-section/AgentStudioSettings.tsx'
import { AgentStudioChip } from './views/composer-chip/AgentStudioChip.tsx'
import { StudioStageView } from './views/studio-stage/StudioStage.tsx'
import { StudioAside } from './views/studio-stage/StudioStagePane.tsx'
import { StudioHeaderButton } from './views/studio-stage/StudioStageHeaderButton.tsx'
import { installAgentStudioNavIcon } from './components/SettingsNavIcon.tsx'

export const name = '@zzerx/dsh-plugin-agent-studio/client'
export const inject = ['slots', 'remote']

export function apply(ctx: Context): void {
  ctx.inject(['slots', 'remote'], async (scoped) => {
    await mountAgentStudioRemote(scoped)
    // 设置侧栏图标：外壳没有图标入口，只能按 label 打补丁（见 components/SettingsNavIcon.tsx）。失败即降级。
    scoped.effect(() => installAgentStudioNavIcon())
    scoped.inject(['remote.agentStudio', 'remote', 'slots'], (inner) => {
      const studio = agentStudioOf(inner)
      // 能力持有对象：入口注册时可能还用不到 sessions/uiWorkspace（宿主缺服务时它们不注入），
      // 先用 NO_STUDIO_CAPABILITIES，服务就绪后原地更新，已注册的视图读同一对象。
      const capabilitiesRef: { current: StudioDetailCapabilities } = {
        current: NO_STUDIO_CAPABILITIES,
      }
      // 活门面：视图注册时拿到的是同一对象，读值/调用时再解引用 ref，
      // 这样 sessions/uiWorkspace 晚于首次渲染就绪也能立刻生效（无需重挂载）。
      const capabilities: StudioDetailCapabilities = {
        get hasRefreshProjections(): boolean {
          return capabilitiesRef.current.hasRefreshProjections
        },
        get hasOpenSession(): boolean {
          return capabilitiesRef.current.hasOpenSession
        },
        get refreshProjections(): StudioDetailCapabilities['refreshProjections'] {
          return capabilitiesRef.current.refreshProjections
        },
        get openSession(): StudioDetailCapabilities['openSession'] {
          return capabilitiesRef.current.openSession
        },
      }

      inner.slots.inject('settings.section', () => inner.slots.register({
        name: 'settings.section',
        id: 'agent-studio',
        order: 30,
        label: '智能体工坊',
        inject: () => ({ studio }),
      }, AgentStudioSettings))

      inner.slots.inject('conversation.input.left' as never, () => inner.slots.register({
        name: 'conversation.input.left',
        id: 'agent-studio',
        order: 12,
        inject: () => ({ studio }),
      } as never, AgentStudioChip as never))

      // 降级入口：只依赖 slots/remote。宿主没有 sessions/uiWorkspace 时这里仍能浏览场景，
      // 详情里的打开/重试按 NO_STUDIO_CAPABILITIES 禁用（不丢入口）。
      let removeView: (() => void) | undefined
      try {
        removeView = inner.slots.inject('conversation.view', () => inner.slots.register({
          name: 'conversation.view',
          id: 'agent-studio-studio',
          order: 40,
          label: STUDIO_STAGE_TITLE,
          inject: () => ({ studio, capabilities }),
        }, StudioStageView))
      } catch {
        removeView = undefined
      }

      // 详情卡补读投影与任务跳转依赖 sessions/uiWorkspace：与入口形态无关，先在这一层拿能力。
      inner.inject(['sessions', 'uiWorkspace'], (host) => {
        capabilitiesRef.current = readStudioDetailCapabilities(host as unknown as StudioHostServicesView)

        // 主入口：sidebarRight + sidebarRightTabs 齐备时注册页类型、正文、会话头按钮。
        // 提交时序：正文与按钮两个 slot 都注册成功后才注册页类型并移除降级 View；
        // 任一槽缺失/注册失败则回滚已注册部分并保留 conversation.view（保证始终有入口）。
        host.inject(['sidebarRight', 'sidebarRightTabs'], (sidebarHost) => {
          const right = sidebarHost.sidebarRight
          let committed = false
          /** 提交失败后置真：后续迟到的 slot 回调不再注册，避免残留半套入口。 */
          let broken = false
          let typeDispose: (() => void) | undefined
          let paneDispose: (() => void) | undefined
          let headerDispose: (() => void) | undefined
          let paneReady = false
          let headerReady = false

          const safe = (dispose: (() => void) | undefined): void => {
            if (dispose === undefined) return
            try {
              dispose()
            } catch {
              // 释放失败不阻断其它清理。
            }
          }

          const rollback = (): void => {
            broken = true
            committed = false
            paneReady = false
            headerReady = false
            safe(typeDispose)
            typeDispose = undefined
            // 回滚已注册的正文与按钮，避免留下「有入口无动作」的残留。
            safe(paneDispose)
            paneDispose = undefined
            safe(headerDispose)
            headerDispose = undefined
          }

          const commit = (): void => {
            if (broken || committed) return
            // 提交前提纯函数化：正文与按钮都拿到 disposer、页类型尚未注册。
            if (!shouldCommitSingleEntry({
              paneReady,
              headerReady,
              tabTypeReady: typeDispose !== undefined,
            })) return
            try {
              // 页类型（stage one）：无 patterns = 页类型，只按 kind 打开。
              typeDispose = sidebarHost.effect(() => sidebarHost.sidebarRightTabs.register({
                id: STUDIO_STAGE_TAB_ID,
                kind: STUDIO_STAGE_KIND,
                priority: 'extension',
                title: () => STUDIO_STAGE_TITLE,
                keepMounted: true,
              }))
              committed = true
              // 单一入口：主入口提交成功后才移除降级 View（失败则保留 View）。
              const disposeView = removeView
              removeView = undefined
              safe(disposeView)
            } catch {
              rollback()
            }
          }

          // 会话头点击：我们的 tab 已激活 → 关；已在别的 pane 开着 → 聚焦；否则开。
          // 未提交（页类型没注册）时不动作，避免 openTab 抛错。
          const openStudio = (): void => {
            if (!committed) return
            const active = right.active() as { id: string; kind: string } | undefined
            const activation = studioEntryActivationOf({
              mounted: right.mounted.getSnapshot(),
              activeTabId: active?.id,
              activeKind: active?.kind,
              openTabs: right.openTabs.getSnapshot(),
            })
            if (activation.action === 'close') {
              right.close(activation.tabId)
              return
            }
            if (activation.action === 'focus') {
              right.focus(activation.tabId)
              return
            }
            if (activation.action === 'open') right.openTab(STUDIO_STAGE_KIND)
          }

          try {
            const waitPane = sidebarHost.slots.inject('sidebar.right.pane.tab', () => {
              if (broken) return () => {}
              // 正文（stage two）：key = 定义 id；session scope 自动拿 sessionId + 会话 hooks。
              paneDispose = sidebarHost.slots.register({
                name: 'sidebar.right.pane.tab',
                key: STUDIO_STAGE_TAB_ID,
                inject: () => ({ studio, capabilities }),
              }, StudioAside)
              paneReady = true
              commit()
              return paneDispose
            })
            const waitHeader = sidebarHost.slots.inject('conversation.session.header.actions', () => {
              if (broken) return () => {}
              headerDispose = sidebarHost.slots.register({
                name: 'conversation.session.header.actions',
                id: 'agent-studio',
                order: STUDIO_HEADER_ORDER,
                inject: () => ({
                  openStudio,
                  mounted: right.mounted,
                  openTabs: right.openTabs,
                  readActiveTab: () => right.active(),
                }),
              }, StudioHeaderButton)
              headerReady = true
              commit()
              return headerDispose
            })
            sidebarHost.effect(() => () => {
              safe(waitPane)
              safe(waitHeader)
              rollback()
              safe(paneDispose)
              safe(headerDispose)
              paneDispose = undefined
              headerDispose = undefined
            })
          } catch {
            rollback()
          }
        })
      })
    })
  })
}
