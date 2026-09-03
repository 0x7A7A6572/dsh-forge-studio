/**
 * @forge-studio/dsh-plugin-home-studio/client —— client 入口（骨架占位）。
 * 待填充：主面板 UI（侧栏入口 / 面板浮层 / 设置卡片等），挂载点与范式参照
 * plugin-notes 的 client（sidebar.footer.action / shell.overlay / settings.plugin.item）。
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = '@forge-studio/dsh-plugin-home-studio/client'
export const inject: string[] = []

export function apply(_ctx: Context): void {
  // 骨架阶段不注册任何 slot。
}
