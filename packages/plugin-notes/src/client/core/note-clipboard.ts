/**
 * 把一张便签复制为会话 mention 文本（引用化按钮的底层 util）。
 * mention 格式见 types.formatNoteMention：`@[标题](note://<id>)` —— 用户粘进
 * 会话后，host 侧 systemPrompt（agent/reference.ts）引导 agent 用 notes_get 解析。
 *
 * 剪贴板写入先走 navigator.clipboard（安全上下文）；不可用时退回隐藏
 * textarea + execCommand('copy')，保证非 https dev / iframe 场景也能复制。
 */

import { formatNoteMention } from '../../types.ts'
import type { NoteId } from '../../types.ts'

/** 生成一条便签的会话 mention 文本。 */
export function noteMentionText(id: NoteId, title: string): string {
  return formatNoteMention(id, title)
}

/**
 * 复制文本到剪贴板（clipboard API 优先，execCommand 兜底）。
 * @param text - 要复制的文本。
 * @returns 是否成功。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // clipboard API 失败（权限/非安全上下文）→ 走 execCommand 兜底。
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

/** 复制一张便签的 mention；返回是否成功。 */
export async function copyNoteMention(id: NoteId, title: string): Promise<boolean> {
  return copyText(noteMentionText(id, title))
}
