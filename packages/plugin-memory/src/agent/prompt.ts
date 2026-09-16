/**
 * plugin-memory × agent harness 桥（host 侧）—— 提示词两条注入。
 *
 * 1. usage 段（静态 systemPrompt.section）：告诉模型什么时候该记、该记到全局还是
 *    项目、什么时候该查、什么不该记。没有它，记忆工具等于没装。
 * 2. recall 段（动态 systemPrompt.context）：每个会话开局注入「全局 + 当前工作区」
 *    的高重要性记忆，让模型开箱就知道你的偏好。
 *
 * 安全：DSH 的 interpolate() 把 \`{{name}}\` 当提示词变量且严格校验变量名，记忆正文
 * 里出现 \`{{...}}\` 会让整轮对话崩溃，故注入边界统一转义花括号（幂等）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { MEMORY_KIND_LABELS, importanceLabel, type MemoryRecord } from '../types.ts'
import type { MemoryService } from '../service.ts'
import { projectLabelOf } from '../service.ts'
import type { MemorySettingsAccess } from '../settings.ts'

export const MEMORY_USAGE_SECTION = 'forge-memory:usage'
export const MEMORY_RECALL_CONTEXT = 'forge-memory:recall'

/** 使用引导（可测试的文本常量）。 */
export const MEMORY_USAGE_TEXT = [
  '## 记忆与进化 (plugin-memory)',
  '',
  '你有一份跨会话的本地记忆库，通过 memory_* 工具读写。它让你在后续对话里继续懂这个用户。',
  '',
  '### 什么时候记（memory_save）',
  '- 用户明确表达的偏好、纠正、语气/格式/风格要求（"以后都…"、"别再…"）。',
  '- 用户主动分享的身份与职业信息（姓名、所在地、背景、职位、技能）。',
  '- 项目层面的关键决策与状态（为什么这么选、当前进展、踩过的坑）。',
  '- 可复用的经验教训。',
  '- 一条一事；标题写短而唯一，同主题沿用同一标题（会自动合并，不会重复）。',
  '- 同一条的别的说法写进 aliases（而不是另记一条）：以后用别名当标题写入会自动并进这一条。',
  '',
  '### 写多长（硬性上限，超限直接拒写）',
  '- 一条正文不超过 320 字、**必须是单段纯文本**（不允许换行、列表、编号、markdown 标题）；超限或带换行会被拒写。',
  '- 只写结论本身：是什么、为什么这么定、边界在哪。不写排查过程、失败尝试、文件行号、命令输出。',
  '- 同一主题沿用同一标题续写；合并后总长同样受 320 字限制，顶破就先用 memory_update 把它改短。',
  '- 不记：任务进度、进行中的快照、可重跑得到的验证结果（测试全过 / tsc 干净 / build 成功）——要看就重新跑，或另存便签。',
  '',
  '### 记到全局还是项目（这一步必须自己判断）',
  '- scope=global：换到任何项目都成立的东西 —— 语气、格式、身份、职业、广泛偏好。',
  '- scope=project：只对当前这一个工作区成立的习惯、约定、决策、环境细节。',
  '- 判不准时问：这条换个项目还成立吗？成立就 global，不成立就 project。',
  '- 单项目习惯写进全局会污染其他项目；反之会丢失上下文。判错了可用 memory_move 改。',
  '',
  '### 地图：实体与关联（memory_entity / memory_link）',
  '- 记忆不是孤岛：写记忆时用 entities 说清"它讲的是谁"（项目 / 工具 / 人 / 概念名），命中的实体自动连 about 边，没命中的按名字新建。',
  '- 已有的实体名出现在标题或标签里算"关于"，只出现在正文里算"提及"；共享同一实体的两条记忆会自动连成"相关"。',
  '- 关系本身有信息量时（细化 / 取代 / 冲突 / 属于 / 使用）用 memory_link 显式连；拿不准就不连，别硬凑。',
  '- 回忆某个主题下都记过什么：memory_entity action=list 找实体，再 memory_link action=list memory_id=<id> 看它连到哪些记忆。',
  '',
  '### 什么时候查（memory_search / memory_list）',
  '- 用户提到"上次""之前说过的""按我的习惯"这类历史指代时。',
  '- 要动手前先查一眼有没有相关约定或决策。',
  '',
  '### 不该记的',
  '- 临时任务的中间细节、可从代码/仓库直接读出的东西。',
  '- 密钥、令牌、证件号、联系方式等敏感数据。',
  '- 用户没说过、由你推测出来的偏好。',
  '',
  '### 修正与遗忘',
  '- 内容过时或写错：memory_update 改；判断记错了作用域：memory_move 移动。',
  '- 不再需要但可能还有价值：memory_archive 归档（可恢复）；确认无用才 memory_delete。',
].join('\n')

/**
 * 注入边界的花括号转义（幂等）：\`{{a}}\` → \`{\\{a\\}}\`，不留下 \`{{\` 子串。
 * 单独的花括号原样透传（interpolate 只扫描 \`{{\`）。
 */
export function escapePromptVars(text: string): string {
  return text.replace(/\{\{/g, '{\\{').replace(/\}\}/g, '}\\}')
}

/** 渲染注入块；无候选返回空串（不占用提示词预算）。 */
export function renderMemoryBlock(records: readonly MemoryRecord[], sessionCwd: string | undefined): string {
  if (records.length === 0) return ''
  const lines = ['[记忆] 来自 plugin-memory 的本地记忆库（跨会话）。它是背景信息，若与用户当前指令冲突，以当前指令为准：']
  for (const record of records) {
    const where = record.scope === 'global' ? '全局' : '项目:' + projectLabelOf(record.projectPath)
    const label = MEMORY_KIND_LABELS[record.kind]
    lines.push('- [' + label + ' | ' + where + ' | ' + importanceLabel(record.importance) + '] ' + record.title + '：'
      + record.content.replace(/\n/g, ' '))
  }
  if (sessionCwd !== undefined && sessionCwd.trim() !== '') {
    lines.push('当前工作区：' + sessionCwd.trim() + '（scope=project 的记忆默认记到这里）')
  }
  return escapePromptVars(lines.join('\n'))
}

/** 从渲染上下文里尽力取会话 cwd；取不到返回 undefined（注入退化为只给全局记忆）。 */
export function sessionCwdOf(renderCtx: unknown): string | undefined {
  try {
    const agent = (renderCtx as { agent?: { session?: { header?: { cwd?: unknown } } } } | undefined)?.agent
    const cwd = agent?.session?.header?.cwd
    return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}

/** 注册 usage 段与 recall 段。任何渲染期异常都降级为空块，绝不炸会话。 */
export function installMemoryPrompt(ctx: Context, service: MemoryService, settings: MemorySettingsAccess): void {
  ctx.systemPrompt.section({
    name: MEMORY_USAGE_SECTION,
    order: 2940,
    text: MEMORY_USAGE_TEXT,
  })
  ctx.systemPrompt.context({
    name: MEMORY_RECALL_CONTEXT,
    order: 95,
    text: (renderCtx: unknown) => {
      try {
        const config = settings.get()
        if (!config.autoInject) return ''
        const cwd = sessionCwdOf(renderCtx)
        const records = service.injectCandidates(cwd, {
          maxItems: config.maxInjected,
          threshold: config.importanceThreshold,
        })
        return renderMemoryBlock(records, cwd)
      } catch {
        return ''
      }
    },
  })
}
