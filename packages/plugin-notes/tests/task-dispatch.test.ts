/**
 * 投递消息模板契约测试（spec §8 / M5）：**首行 = 标记 + 标题**，正式说明在末尾。
 * 执行协议（读全文 / 置 running / 收尾回报 / 只动 lane）不再写进消息——消息会逐字
 * 出现在会话记录里，协议由 notes_task_* 的工具说明承担（见 tools.ts）。
 * 文本逐字锁定，改动须同步 spec。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  TASK_DISPATCH_MARK,
  buildTaskDispatchMessage,
  installTaskRuntime,
} from '../src/agent/task-dispatch.ts'
import { NOTES_NAMESPACE } from '../src/types.ts'
import type { NoteId, NotesConfig } from '../src/types.ts'

/** 假会话控制器：记录 create/prompt，list 返回预置会话（含 cwd）。 */
interface Recorder {
  readonly created: Array<{ readonly cwd?: string; readonly workspaceId?: string }>
  readonly prompted: Array<{
    readonly sessionId?: string
    readonly mode?: string
    readonly content?: readonly { readonly text?: string }[]
  }>
  readonly items: Array<{ readonly cwd?: string }>
}

async function provideSessionController(ctx: Context, rec: Recorder): Promise<void> {
  const controller = {
    create: async (request: { readonly cwd?: string; readonly workspaceId?: string }) => {
      rec.created.push(request)
      return { sessionId: `sess-${rec.created.length}` }
    },
    prompt: async (request: Recorder['prompted'][number]) => {
      rec.prompted.push(request)
      return { accepted: true }
    },
    list: async () => ({ items: rec.items }),
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('sessionController', controller as never) })
}

async function provideSettings(ctx: Context, value: Partial<NotesConfig>): Promise<void> {
  const settings = {
    register: () => {},
    get: (namespace: string) => (namespace === NOTES_NAMESPACE ? value : undefined),
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('settings', settings as never) })
}

/**
 * 假工作区注册表：按**规范路径**反查工作区 id（映射外 = 未注册该目录）。
 * 只实现本插件用到的 resolveByPath（结构化面，不依赖 dsh-workspace 包）。
 */
async function provideWorkspaceRegistry(
  ctx: Context,
  byPath: Record<string, string | undefined>,
): Promise<void> {
  const registry = {
    resolveByPath: async (path: string) => {
      const id = byPath[path]
      return id === undefined ? undefined : { id }
    },
  }
  await ctx.plugin({ apply: (c: Context) => c.provide('workspaceRegistry', registry) })
}

/** 等一拍：让 ctx.inject(['settings']) 的派生 fiber 收束。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('task dispatch 消息模板', () => {
  it('首行 = 标记符号 + 标题，完整说明在末尾（会话列表只看首行），逐字匹配', () => {
    const id = 'abc-123' as NoteId
    const msg = buildTaskDispatchMessage({ noteId: id, title: '买菜' })
    // 标记只用常量：改标记时这里不该再留一份手写字面量。
    expect(msg).toBe(`${TASK_DISPATCH_MARK} 买菜\n\n【任务执行】请执行便签「买菜」（id: abc-123）中描述的任务。`)
    // 首行只有标记与标题：列表里一眼可辨，不被长前缀占满。
    expect(msg.split('\n')[0]).toBe(`${TASK_DISPATCH_MARK} 买菜`)
    // 长说明挪到末尾，且不再出现四行协议模板（难看在左侧对话记录）。
    expect(msg.split('\n').at(-1)).toBe('【任务执行】请执行便签「买菜」（id: abc-123）中描述的任务。')
    expect(msg).not.toContain('步骤：')
  })

  it('标题缺失时首行与说明都用「无标题」占位', () => {
    const msg = buildTaskDispatchMessage({ noteId: 'n1' as NoteId, title: '' })
    expect(msg).toContain('「无标题」')
    expect(msg.startsWith(`${TASK_DISPATCH_MARK} 无标题`)).toBe(true)
  })
})

describe('installTaskRuntime（执行 = 按工作区新建会话 + 投递）', () => {
  it('createSession 以工作区为 cwd 新建会话；prompt 排队投递到**新会话**', async () => {
    const ctx = new Context()
    const rec: Recorder = { created: [], prompted: [], items: [] }
    await provideSessionController(ctx, rec)
    const runtime = installTaskRuntime(ctx)

    const sessionId = await runtime.createSession({ workspace: 'D:/ws' })
    expect(sessionId).toBe('sess-1')
    expect(rec.created).toEqual([{ cwd: 'D:/ws' }])

    const noteId = 'n1' as NoteId
    await runtime.prompt({ noteId, title: '买菜', sessionId, workspace: 'D:/ws' })
    expect(rec.prompted[0]?.sessionId).toBe('sess-1')
    // queue 语义：不打断目标会话里正在跑的 turn。
    expect(rec.prompted[0]?.mode).toBe('queue')
    expect(rec.prompted[0]?.content?.[0]?.text).toBe(buildTaskDispatchMessage({ noteId, title: '买菜' }))

    await ctx.fiber.dispose()
  })

  it('工作区已注册：create 传 workspaceId（会话归入该工作区分组，不掉「未分组」）', async () => {
    const ctx = new Context()
    const rec: Recorder = { created: [], prompted: [], items: [] }
    await provideSessionController(ctx, rec)
    await provideWorkspaceRegistry(ctx, { 'D:/ws': 'ws-1' })
    const runtime = installTaskRuntime(ctx)

    const sessionId = await runtime.createSession({ workspace: 'D:/ws' })
    expect(sessionId).toBe('sess-1')
    // 只传 workspaceId（宿主按注册表解析路径）：同时传 cwd 会被宿主拒绝。
    expect(rec.created).toEqual([{ workspaceId: 'ws-1' }])
    await ctx.fiber.dispose()
  })

  it('工作区未注册 / 注册表反查抛错：退回 cwd（工作目录不变，只是不归组）', async () => {
    // 1) 目录存在但没注册成工作区 → resolveByPath 返回 undefined。
    const unowned = new Context()
    const rec1: Recorder = { created: [], prompted: [], items: [] }
    await provideSessionController(unowned, rec1)
    await provideWorkspaceRegistry(unowned, {})
    expect(await installTaskRuntime(unowned).createSession({ workspace: 'D:/loose' })).toBe('sess-1')
    expect(rec1.created).toEqual([{ cwd: 'D:/loose' }])
    await unowned.fiber.dispose()

    // 2) 目录不存在（宿主 realpath 抛错）→ 同样退回 cwd。
    const broken = new Context()
    const rec2: Recorder = { created: [], prompted: [], items: [] }
    await provideSessionController(broken, rec2)
    await broken.plugin({
      apply: (c: Context) =>
        c.provide('workspaceRegistry', {
          resolveByPath: async () => {
            throw new Error('ENOENT')
          },
        }),
    })
    expect(await installTaskRuntime(broken).createSession({ workspace: 'D:/gone' })).toBe('sess-1')
    expect(rec2.created).toEqual([{ cwd: 'D:/gone' }])
    await broken.fiber.dispose()
  })

  it('listWorkspaces：去重保序，且不含空 cwd', async () => {
    const ctx = new Context()
    const rec: Recorder = {
      created: [],
      prompted: [],
      items: [{ cwd: 'D:/a' }, { cwd: 'D:/a' }, {}, { cwd: '  ' }, { cwd: 'D:/b' }],
    }
    await provideSessionController(ctx, rec)
    const runtime = installTaskRuntime(ctx)
    expect(await runtime.listWorkspaces()).toEqual(['D:/a', 'D:/b'])
    await ctx.fiber.dispose()
  })

  it('宿主无 sessionController：新建/投递抛错（taskExecute → dispatch-failed），候选降级空数组', async () => {
    const ctx = new Context()
    const runtime = installTaskRuntime(ctx)
    await expect(runtime.createSession({ workspace: 'D:/ws' })).rejects.toThrow('sessionController')
    await expect(
      runtime.prompt({ noteId: 'n1' as NoteId, title: 't', sessionId: 's', workspace: 'D:/ws' }),
    ).rejects.toThrow('sessionController')
    // 候选是「拿不到就没有」，不抛。
    expect(await runtime.listWorkspaces()).toEqual([])
    // 默认工作区三层兜底：既无配置又无候选时落到宿主进程目录（恒有值）。
    expect(await runtime.defaultWorkspace()).toBe(process.cwd())
    await ctx.fiber.dispose()
  })

  it('defaultWorkspace 三层兜底：设置值（trim）→ 最近会话目录 → 宿主进程目录', async () => {
    // 1) 设置里的显式配置优先（trim 后使用）。
    const ctx = new Context()
    await provideSettings(ctx, { defaultWorkspace: '  D:/default  ' })
    const runtime = installTaskRuntime(ctx)
    await tick()
    expect(await runtime.defaultWorkspace()).toBe('D:/default')
    await ctx.fiber.dispose()

    // 2) 未配置（或只有空白）≠ 没有默认值：回退最近会话用过的目录（列表首条）。
    const blank = new Context()
    await provideSettings(blank, { defaultWorkspace: '   ' })
    const rec: Recorder = {
      created: [],
      prompted: [],
      items: [{ cwd: 'D:/recent' }, { cwd: 'D:/older' }],
    }
    await provideSessionController(blank, rec)
    const blankRuntime = installTaskRuntime(blank)
    await tick()
    expect(await blankRuntime.defaultWorkspace()).toBe('D:/recent')
    await blank.fiber.dispose()

    // 3) 零会话 + 未配置 → 宿主进程目录保底，任务便签因此总有工作区可跑。
    const bare = new Context()
    const bareRuntime = installTaskRuntime(bare)
    expect(await bareRuntime.defaultWorkspace()).toBe(process.cwd())
    await bare.fiber.dispose()
  })
})
