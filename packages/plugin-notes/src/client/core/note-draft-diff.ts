/**
 * 便签草稿的「改动判定」：把「用户到底改了什么」压成一个可逐字段比较的签名字符串。
 *
 * 为什么要有它：编辑器的关闭口子不止一个（X / 「取消」/ Esc / 点遮罩），关掉就等于丢弃
 * 这次编辑。要在关之前问一句「有改动，要保存吗」，就得先有**唯一**的改动判据 ——
 * 少算一个字段（纸色、任务状态、定时…）会静默丢改动，多算一个（标题首尾空白）会白弹一次。
 *
 * 纯计算：不依赖 React、不依赖 tiptap 实例，正文由调用方从编辑器现取后传进来，
 * 所以同一份判据在钩子（关前检查）与自动保存（判断「和上次落盘一样就跳过」）里共用。
 */

import type { NoteColor, NoteScheduleInput, TaskStatus } from '../../types.ts'

/** 参与「有没有改动」判定的草稿字段（与保存链路写库的字段一一对应）。 */
export interface NoteDraftFields {
  /** 标题（比较前 trim：首尾空白不算改动）。 */
  readonly title: string
  /** 正文 Markdown（调用方从编辑器现取；编辑器未就绪时用初值）。 */
  readonly body: string
  readonly color: NoteColor
  /** 「设为任务」开关。 */
  readonly taskOn: boolean
  /** 泳道状态（任务便签才有意义，但草稿里始终带上）。 */
  readonly taskStatus: TaskStatus
  /** 执行工作区（'' = 未指定）。 */
  readonly workspace: string
  /** agent 预设（'' = 宿主默认）。 */
  readonly agentPreset: string
  /** 模型下拉的 value（modelKey 编码；'' = 宿主默认）。 */
  readonly modelValue: string
  /** 定时日程草稿（undefined = 不定时）。 */
  readonly schedule?: NoteScheduleInput
}

/**
 * 草稿签名：JSON 数组的字段顺序就是这里的顺序，任一字段变化都会换一个签名。
 * 用 JSON 而不是自拼分隔符：正文里什么都可能有，分隔符撞车就会把两个不同草稿判成同一个。
 */
export function noteDraftSignature(fields: NoteDraftFields): string {
  return JSON.stringify([
    fields.title.trim(),
    fields.body,
    fields.color,
    fields.taskOn,
    fields.taskStatus,
    fields.workspace,
    fields.agentPreset,
    fields.modelValue,
    fields.schedule ?? null,
  ])
}

/**
 * 草稿相对基线（编辑态 = 上次落盘，新建态 = 打开时的初值）有没有改动。
 * `saved` 为 null（还没有基线：编辑器尚未就绪、用户不可能改过内容）时一律算没改动 ——
 * 宁可少弹一次，也不要在刚打开、手还没落在键盘上时就弹「有改动」。
 */
export function isNoteDraftDirty(saved: string | null, fields: NoteDraftFields): boolean {
  return saved !== null && saved !== noteDraftSignature(fields)
}
