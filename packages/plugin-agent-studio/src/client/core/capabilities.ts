/**
 * 宿主能力的结构收窄：详情卡要补读投影，任务行要跳会话。
 * 本包未装 ui-workspace 的类型，故不 import 宿主类型，只按用到的成员收窄。
 */

/** 子会话地址（SubagentAddress 的最小形状；external 收敛为 unknown）。 */
export interface StudioSubagentTarget {
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly mode: 'continuable' | 'one-shot' | 'unknown'
}

/** 宿主侧能力；缺失时详情卡降级（不刷新、任务行禁用跳转）。 */
export interface StudioDetailCapabilities {
  /** sessions.refreshProjections 是否可用；false 时「重试」不生效。 */
  readonly hasRefreshProjections: boolean
  /** uiWorkspace.openSession 是否可用；false 时任务行只能浏览。 */
  readonly hasOpenSession: boolean
  refreshProjections?(sessionId: string): void
  /** 宿主 SessionTarget 是 union：单参字符串开 lead 会话，对象开子会话。 */
  openSession?(target: string | StudioSubagentTarget): void
}

export const NO_STUDIO_CAPABILITIES: StudioDetailCapabilities = {
  hasRefreshProjections: false,
  hasOpenSession: false,
}

interface StudioSessionsServiceView {
  refreshProjections?(sessionId: string): Promise<void> | void
}

interface StudioWorkspaceServiceView {
  openSession?(target: string | StudioSubagentTarget): void
}

/** client Context 里本面板用到的两个服务。 */
export interface StudioHostServicesView {
  readonly sessions?: StudioSessionsServiceView
  readonly uiWorkspace?: StudioWorkspaceServiceView
}

/** 把宿主服务包成立即失败即静默的能力对象；服务缺失时退化为空实现。 */
export function readStudioDetailCapabilities(host: StudioHostServicesView): StudioDetailCapabilities {
  const sessions = host.sessions
  const workspace = host.uiWorkspace
  const refresh = sessions?.refreshProjections
  const open = workspace?.openSession
  const canRefresh = typeof refresh === 'function'
  const canOpen = typeof open === 'function'
  return {
    hasRefreshProjections: canRefresh,
    hasOpenSession: canOpen,
    ...(canRefresh ? {
      refreshProjections(sessionId: string): void {
        try {
          const pending: unknown = sessions?.refreshProjections?.(sessionId)
          if (typeof (pending as { catch?: unknown } | undefined)?.catch === 'function') {
            void (pending as Promise<void>).catch(() => {})
          }
        } catch {
          // 投影补读失败不打断浏览：加载态由 catalog 阶段呈现。
        }
      },
    } : {}),
    ...(canOpen ? {
      openSession(target: string | StudioSubagentTarget): void {
        try {
          workspace?.openSession?.(target)
        } catch {
          // 跳转失败不打断浏览。
        }
      },
    } : {}),
  }
}
