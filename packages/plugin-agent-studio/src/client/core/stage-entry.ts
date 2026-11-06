/**
 * 右侧栏入口的纯判定：页类型常量、按钮三态、激活动作、单一入口提交前提。
 * 与 host 解耦（只吃快照值），供 index.ts 的注册闭包与单元测试共用。
 */

/** 页类型定义 id：也是 `sidebar.right.pane.tab` 的 key。 */
export const STUDIO_STAGE_TAB_ID = 'agent-studio-stage'
/** 页类型 kind：`ctx.sidebarRight.openTab` 按它开页。 */
export const STUDIO_STAGE_KIND = 'agentStudioStage'
export const STUDIO_STAGE_TITLE = '智能体团队'
/** 会话头按钮 order：紧贴官方 Team 按钮（-20），避开 subagent-catalog(-30) / agent-preset(-10)。 */
export const STUDIO_HEADER_ORDER = -19

export type StudioToggleAction = 'disabled' | 'open' | 'close'

export interface StudioEntrySnapshot {
  /** 右侧栏当前挂载的会话 id；undefined = 没有挂载中的会话（按钮禁用）。 */
  readonly mounted: string | undefined
  /** 当前激活 tab 的 kind；undefined = 无激活 tab。 */
  readonly activeKind: string | undefined
}

/** 按钮三态：无挂载会话 → disabled；我们的 tab 已激活 → close；否则 open。 */
export function studioToggleActionOf(snapshot: StudioEntrySnapshot): StudioToggleAction {
  if (snapshot.mounted === undefined) return 'disabled'
  return snapshot.activeKind === STUDIO_STAGE_KIND ? 'close' : 'open'
}

/** 打开 tab 清单里最小切片（SidebarRightOpenTab 的结构对齐）。 */
export interface StudioOpenTabRef<TabId extends string = string> {
  readonly sessionId: string
  readonly tabId?: TabId | undefined
  readonly kind: string
}

/** 挂载会话里我们的 tab；undefined = 该会话没开我们的页。 */
export function studioOpenTabIn<TabId extends string>(
  tabs: readonly StudioOpenTabRef<TabId>[],
  mounted: string | undefined,
): StudioOpenTabRef<TabId> | undefined {
  if (mounted === undefined) return undefined
  return tabs.find((tab) => tab.sessionId === mounted && tab.kind === STUDIO_STAGE_KIND)
}

/** 该会话是否已经开着我们的页（aria-pressed 用；不是"当前激活"）。 */
export function studioTabOpenedIn(
  tabs: readonly StudioOpenTabRef[],
  mounted: string | undefined,
): boolean {
  return studioOpenTabIn(tabs, mounted) !== undefined
}

/** 点右侧栏入口真正要执行的动作：关 / 聚焦已开的页 / 新开。 */
export type StudioEntryActivation<TabId extends string = string> =
  | { readonly action: 'disabled' }
  | { readonly action: 'open' }
  | { readonly action: 'focus'; readonly tabId: TabId }
  | { readonly action: 'close'; readonly tabId: TabId }

export interface StudioActivationInput<TabId extends string = string> {
  readonly mounted: string | undefined
  readonly activeTabId?: TabId | undefined
  readonly activeKind: string | undefined
  readonly openTabs?: readonly StudioOpenTabRef<TabId>[] | undefined
}

/**
 * 激活决策：无挂载 → disabled；我们的 tab 已激活 → close；
 * 已开在别的 pane → focus（避免重复开页）；否则 open。
 */
export function studioEntryActivationOf<TabId extends string = string>(
  input: StudioActivationInput<TabId>,
): StudioEntryActivation<TabId> {
  if (input.mounted === undefined) return { action: 'disabled' }
  if (input.activeKind === STUDIO_STAGE_KIND && input.activeTabId !== undefined) {
    return { action: 'close', tabId: input.activeTabId }
  }
  const opened = studioOpenTabIn(input.openTabs ?? [], input.mounted)
  if (opened !== undefined && opened.tabId !== undefined) {
    return { action: 'focus', tabId: opened.tabId }
  }
  return { action: 'open' }
}

/** 单一入口的注册进度：正文、按钮、页类型各自是否已拿到 disposer。 */
export interface StudioSingleEntryReadiness {
  readonly paneReady: boolean
  readonly headerReady: boolean
  readonly tabTypeReady: boolean
}

/** 两个 slot 回调都到齐才提交页类型；任一缺席都保留降级 View。 */
export function shouldCommitSingleEntry(readiness: StudioSingleEntryReadiness): boolean {
  return readiness.paneReady && readiness.headerReady && !readiness.tabTypeReady
}
