/**
 * 本地最低类型声明：右侧栏服务与 `sidebar.right.pane.tab` 槽位。
 *
 * 为什么不直接 `import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'`：
 * 该包不在本插件的依赖里（只为类型加 devDep 会把 pnpm-lock 的 peer 哈希整片重解析，
 * 并且构建机可能根本没装它）；这里声明只覆盖我们实际用到的服务面。
 * 运行时永远走 `ctx.sidebarRight` / `ctx.sidebarRightTabs`，本文件不产生任何代码。
 */

import type { SlotHookFactory } from '@deepseek-ai/dsh-client-ui-slots'

/** `sidebarRight.mounted` / `openTabs` 的最小可订阅切片。 */
export interface StudioSnapshotSource<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** 右侧栏打开的 tab（只取我们判定需要的最小字段）。 */
export interface StudioOpenTabEntry {
  readonly sessionId: string
  readonly kind: string
  readonly id?: string
}

/** 页类型定义（`sidebarRightTabs.register` 的入参）。 */
export interface StudioTabTypeDefinition {
  readonly id: string
  readonly kind: string
  readonly priority?: 'extension' | 'builtin' | 'fallback'
  readonly title: () => string
  readonly keepMounted?: boolean
}

/** 右侧栏页的 tab 信息（`useTabInfo()` 返回值的收窄）。 */
export interface StudioTabInfo {
  readonly tab: {
    readonly visible: boolean
  }
}

/** `ctx.sidebarRight` 的最小服务面。 */
export interface StudioSidebarRightService {
  readonly mounted: StudioSnapshotSource<string | undefined>
  readonly openTabs: StudioSnapshotSource<readonly StudioOpenTabEntry[]>
  active(): { readonly id: string; readonly kind: string } | undefined
  openTab(kind: string): void
  close(tabId: string): void
  focus(tabId: string): void
}

/** `ctx.sidebarRightTabs` 的最小服务面。 */
export interface StudioSidebarRightTabsService {
  register(definition: StudioTabTypeDefinition): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sidebarRight: StudioSidebarRightService
    sidebarRightTabs: StudioSidebarRightTabsService
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.right.pane.tab': {
      kind: 'keyed'
      scope: 'session'
      inject: {
        hooks: {
          tabInfo: SlotHookFactory<'sidebar.right.pane.tab', () => StudioTabInfo>
        }
      }
    }
  }
}
