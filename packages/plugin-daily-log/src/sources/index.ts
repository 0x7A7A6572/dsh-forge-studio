/**
 * 内置渠道 provider 聚合：git / claude / codex / dsh 全部内置。
 * dsh 渠道直接读 `<DSH_HOME>/sessions` 的会话文件（多帧 zstd），不依赖宿主 API。
 */

import type { ChannelProvider } from './provider.ts'
import { gitChannel } from './git.ts'
import { claudeChannel } from './claude.ts'
import { codexChannel } from './codex.ts'
import { dshChannel } from './dsh.ts'

export const builtinChannels: ChannelProvider[] = [gitChannel, claudeChannel, codexChannel, dshChannel]
