/**
 * @forge-studio/dsh-plugin-home-studio —— host 入口（骨架占位）。
 * 待填充：主面板所需的 host 侧能力（域/服务/设置命名空间），
 * 范式参照 plugin-notes（storage-domain + NotesService 直连 client）。
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = '@forge-studio/dsh-plugin-home-studio'

export function apply(_ctx: Context): void {
  // 骨架阶段不注册任何 host 能力。
}
