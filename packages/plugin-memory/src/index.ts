/**
 * @zzerx/dsh-plugin-memory —— host 入口。
 *
 * 打开 memory 域 → 提供 ctx.memory 服务（client 经 Typert remote 直连）→
 * 注册设置命名空间 → 等 tools / systemPrompt 就绪后挂 agent 桥与提示词注入 →
 * 挂 turn/end 自动提炼钩子（面板「生成对话记忆」开关）。
 *
 * 挂载时机（关键）：宿主装配是 service-availability 驱动的，本插件可能先于
 * tools / systemPrompt / llm 就绪。因此桥一律用 ctx.inject 声明依赖（服务注册时
 * 被唤醒，任何到达次序都能挂上），而不是 apply 时的一次性 ctx.get 判存。
 * 本插件对这些服务全部是可选增强：一个都没就绪时，记忆库与面板照常工作。
 */

import { Context } from '@deepseek-ai/cordis'
import { memoryDomain } from './domain.ts'
import { MemoryService } from './service.ts'
import { installMemorySettings } from './settings.ts'
import { installMemoryTools } from './agent/tools.ts'
import { describeConflicts } from './conflicts.ts'
import { installMemoryPrompt } from './agent/prompt.ts'
import { installMemoryCapture } from './agent/capture.ts'
import { createMemoryJudge } from './agent/judge.ts'

export const name = '@zzerx/dsh-plugin-memory'
export const inject = ['storageDomain']

/** workspaceRegistry（dsh-workspace）的最小视图，只取面板候选需要的 path。 */
interface WorkspaceRegistryLike {
  list(): Array<{ path: string }>
}

/**
 * 读取 DSH 已添加的工作区目录（面板「项目记忆」下拉候选）。
 * registry 未装配或读取异常一律返回 []，由 service 端降级为「只有已存项目」。
 */
async function readKnownWorkspaces(ctx: Context): Promise<readonly string[]> {
  const registry = (ctx as unknown as { get(name: string): WorkspaceRegistryLike | undefined }).get('workspaceRegistry')
  if (registry === undefined || typeof registry.list !== 'function') return []
  try {
    return registry.list().map((item) => item.path).filter((path) => typeof path === 'string' && path !== '')
  } catch {
    return []
  }
}

export async function apply(ctx: Context): Promise<void> {
  // storageDomain 已在静态 inject 声明，apply 时已就绪，无需再包一层 ctx.inject。
  const domain = await ctx.storageDomain.open(memoryDomain)
  try {
    // 域由本 fiber 负责 close。
    ctx.effect(() => () => { void domain.close() })
    const settings = installMemorySettings(ctx)
    // 用 new（而非 ctx.plugin）：把 memory 服务 provide 在本 apply 的 fiber 上，
    // 后续 ctx.inject(['tools'], ...) 子 fiber 才能沿祖先链读到 ctx.memory。
    const service = new MemoryService(ctx, {
      domain,
      settings,
      knownWorkspaces: () => readKnownWorkspaces(ctx),
    })
    // 写入判定（方案 C）：路由与 llm 都在调用时才取，所以这里装配不影响启动顺序。
    service.setJudge(createMemoryJudge(ctx))
    installMemoryAgentBridgeWhenReady(ctx, service, settings)
  } catch (error) {
    void domain.close()
    throw error
  }
}

/**
 * agent 桥可选增强：tools 就绪后注册 memory_* 工具，systemPrompt 就绪后挂
 * 使用引导与自动注入。任何一步抛错只降级该桥，不拖垮核心服务与面板。
 */
export function installMemoryAgentBridgeWhenReady(
  ctx: Context,
  service: MemoryService,
  settings: ReturnType<typeof installMemorySettings>,
): void {
  void ctx.inject(['tools'], (toolsCtx) => {
    try {
      installMemoryTools(toolsCtx, {
        onConflicts: (conflicts) => {
          service.setConflicts(conflicts)
          if (conflicts.length === 0) return
          toolsCtx.logger.warn('[plugin-memory] ' + describeConflicts(conflicts))
        },
      })
    } catch (error) {
      toolsCtx.logger.error('[plugin-memory] agent tools install failed — memory_* unavailable to sessions:', error)
    }
  })
  void ctx.inject(['systemPrompt'], (promptCtx) => {
    try {
      installMemoryPrompt(promptCtx, service, settings)
    } catch (error) {
      promptCtx.logger.warn('[plugin-memory] prompt injection disabled:', error)
    }
  })
  // 自动提炼不依赖 ctx.llm 的就绪时机（调用时才取），但整体包一层保险。
  try {
    const dispose = installMemoryCapture(ctx, service, settings)
    ctx.effect(() => () => { dispose() })
  } catch (error) {
    ctx.logger.warn('[plugin-memory] conversation capture disabled:', error)
  }
}
