/**
 * 内置渠道 provider 聚合：git / claude / codex 固定内置；
 * dsh 渠道依赖宿主 workspaceRegistry + sessions 服务，由 host apply 装配注入。
 */

import type { ChannelProvider } from './provider.ts'
import { gitChannel } from './git.ts'
import { claudeChannel } from './claude.ts'
import { codexChannel } from './codex.ts'

export const builtinChannels: ChannelProvider[] = [gitChannel, claudeChannel, codexChannel]
