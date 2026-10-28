export const SAVE_MESSAGE_TITLE = '对话摘录'

const TITLE_MAX = 40

export function assistantMessageBlocks(snapshot: unknown, messageId: string): readonly unknown[] {
  const snap = snapshot as
    | { nodes?: { values?: () => readonly unknown[] }; legacy?: { nodes?: readonly unknown[] } }
    | null
    | undefined
  const legacy = snap?.legacy?.nodes
  if (Array.isArray(legacy)) {
    for (const node of legacy) {
      const candidate = node as { kind?: unknown; messageId?: unknown; blocks?: unknown } | null
      if (candidate === null || candidate.kind !== 'assistant' || candidate.messageId !== messageId) {
        continue
      }
      if (Array.isArray(candidate.blocks)) return candidate.blocks
    }
  }
  const values = snap?.nodes?.values?.()
  if (Array.isArray(values)) {
    for (const node of values) {
      const data = (node as { data?: unknown } | null)?.data as
        | { blocks?: unknown; finalNode?: { messageId?: unknown; blocks?: unknown } }
        | null
        | undefined
      if (data === null || data === undefined || data.finalNode?.messageId !== messageId) continue
      if (Array.isArray(data.blocks)) return data.blocks
      if (Array.isArray(data.finalNode.blocks)) return data.finalNode.blocks
    }
  }
  return []
}

export function blocksText(blocks: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    const candidate = block as { kind?: unknown; text?: unknown } | null
    if (
      candidate !== null &&
      candidate.kind === 'text' &&
      typeof candidate.text === 'string' &&
      candidate.text !== ''
    ) {
      parts.push(candidate.text)
    }
  }
  return parts.join('\n').trim()
}

export interface MessageDraft {
  readonly title: string
  readonly text: string
  readonly imported: number
  readonly failed: number
}

export async function draftFromBlocks(
  blocks: readonly unknown[],
  importImage: (attachment: unknown) => Promise<string>,
): Promise<MessageDraft> {
  const parts: string[] = []
  let imported = 0
  let failed = 0
  for (const block of blocks) {
    const candidate = block as { kind?: unknown; text?: unknown; attachment?: unknown } | null
    if (candidate === null) continue
    if (candidate.kind === 'text' && typeof candidate.text === 'string' && candidate.text !== '') {
      parts.push(candidate.text)
      continue
    }
    if (candidate.kind !== 'image') continue
    try {
      const src = await importImage(candidate.attachment)
      parts.push(`![图片](${src})`)
      imported += 1
    } catch {
      parts.push('（图片导入失败）')
      failed += 1
    }
  }
  const text = parts.join('\n').trim()
  return { title: titleFromText(text), text, imported, failed }
}

export function titleFromText(text: string): string {
  const first =
    text
      .split('\n')
      .map((line) => line.trim())
      .find(
        (line) => line !== '' && !line.startsWith('![') && !line.startsWith('（图片导入失败'),
      ) ?? ''
  const plain = first.replace(/^[#>\-*\s]+/, '').replace(/[*`_]/g, '').trim()
  if (plain === '') return SAVE_MESSAGE_TITLE
  return plain.length > TITLE_MAX ? `${plain.slice(0, TITLE_MAX)}…` : plain
}
