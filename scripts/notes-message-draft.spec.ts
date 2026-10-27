/**
 * 对话存便签的门禁：图片块必须按消息顺序变成引用，失败要有可见占位，
 * 只有图片的消息不能拿图片行/失败占位当标题。
 */
import { describe, expect, it } from 'vitest'
import {
  assistantMessageBlocks,
  blocksText,
  draftFromBlocks,
  SAVE_MESSAGE_TITLE,
  titleFromText,
} from '../packages/plugin-notes/src/client/core/message-draft.ts'

const LEGACY_SNAPSHOT = {
  legacy: {
    nodes: [
      {
        kind: 'assistant',
        messageId: 'm1',
        blocks: [
          { kind: 'text', text: '看这张图' },
          { kind: 'image', attachment: { attachmentId: 'a1' } },
        ],
      },
    ],
  },
}

const VIEW_SNAPSHOT = {
  nodes: {
    values: () => [
      { data: { blocks: [{ kind: 'text', text: '视图路径' }], finalNode: { messageId: 'm2' } } },
    ],
  },
}

describe('assistantMessageBlocks', () => {
  it('legacy 路径取顶层 blocks', () => {
    expect(assistantMessageBlocks(LEGACY_SNAPSHOT, 'm1')).toHaveLength(2)
  })

  it('视图路径取 data.blocks', () => {
    expect(blocksText(assistantMessageBlocks(VIEW_SNAPSHOT, 'm2'))).toBe('视图路径')
  })

  it('找不到消息返回空数组', () => {
    expect(assistantMessageBlocks(LEGACY_SNAPSHOT, 'missing')).toEqual([])
  })
})

describe('draftFromBlocks', () => {
  it('文本与图片按顺序进正文，图片换成引用', async () => {
    const draft = await draftFromBlocks(
      [
        { kind: 'text', text: '看这张图' },
        { kind: 'image', attachment: { attachmentId: 'a1' } },
        { kind: 'text', text: '结论如上' },
      ],
      async () => 'notes-asset:8a7b6c5d-1234-4abc-9def-0123456789ab.png',
    )
    expect(draft.text).toBe(
      '看这张图\n![图片](notes-asset:8a7b6c5d-1234-4abc-9def-0123456789ab.png)\n结论如上',
    )
    expect(draft.title).toBe('看这张图')
    expect(draft.imported).toBe(1)
    expect(draft.failed).toBe(0)
  })

  it('导入失败留可见占位，文字照存', async () => {
    const draft = await draftFromBlocks([{ kind: 'image', attachment: { attachmentId: 'a1' } }], async () => {
      throw new Error('boom')
    })
    expect(draft.text).toBe('（图片导入失败）')
    expect(draft.failed).toBe(1)
    expect(draft.title).toBe(SAVE_MESSAGE_TITLE)
  })
})

describe('titleFromText', () => {
  it('跳过纯图片行', () => {
    expect(titleFromText('![图片](x)\n第二行标题')).toBe('第二行标题')
  })

  it('跳过失败占位行', () => {
    expect(titleFromText('（图片导入失败）\n真正的标题')).toBe('真正的标题')
  })

  it('超长截断加省略号', () => {
    expect(titleFromText('一'.repeat(60)).length).toBe(41)
  })
})
