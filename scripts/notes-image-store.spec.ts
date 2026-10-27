/**
 * 图片仓门禁：文件名校验是任意路径读的唯一闸门；offload 必须幂等，
 * 否则每次启动都会把已迁完的正文再扫一遍写一次 updatedAt。
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  NoteImageStore,
  resolveNoteImagesRoot,
} from '../packages/plugin-notes/src/note-image-store.ts'

const PNG_BASE64 = Buffer.from('hello').toString('base64')

const roots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'notes-assets-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('resolveNoteImagesRoot', () => {
  it('DSH_HOME 绝对路径直接落 notes-assets', () => {
    expect(resolveNoteImagesRoot({ DSH_HOME: 'D:\\home\\.dsh' }, 'C:\\Users\\x')).toBe(
      'D:\\home\\.dsh\\notes-assets',
    )
  })

  it('DSH_HOME 相对路径保持相对（pnpm dev 的 .dsh-home）', () => {
    expect(resolveNoteImagesRoot({ DSH_HOME: '.dsh-home' }, 'C:\\Users\\x')).toBe(
      '.dsh-home\\notes-assets',
    )
  })

  it('缺省回落 ~/.dsh', () => {
    expect(resolveNoteImagesRoot({}, 'C:\\Users\\x')).toBe('C:\\Users\\x\\.dsh\\notes-assets')
  })
})

describe('NoteImageStore 读写', () => {
  it('save → 文件落盘 → read 原样回来', async () => {
    const store = new NoteImageStore(await makeRoot())
    const fileName = await store.saveBase64(PNG_BASE64, 'image/png')
    expect(await readdir(store.rootDir)).toEqual([fileName])
    expect(await readFile(join(store.rootDir, fileName), 'utf8')).toBe('hello')
    await expect(store.readBase64(fileName)).resolves.toEqual({
      mediaType: 'image/png',
      data: PNG_BASE64,
    })
  })

  it('非白名单 mime / 非法 base64 / 超上限都拒绝', async () => {
    const store = new NoteImageStore(await makeRoot(), { maxBytes: 4 })
    await expect(store.saveBase64(PNG_BASE64, 'image/bmp')).rejects.toThrow(/不支持的图片类型/)
    await expect(store.saveBase64('abc', 'image/png')).rejects.toThrow(/合法 base64/)
    await expect(store.saveBase64(PNG_BASE64, 'image/png')).rejects.toThrow(/超过上限/)
  })

  it('read 拒绝路径穿越与非法文件名', async () => {
    const store = new NoteImageStore(await makeRoot())
    await expect(store.readBase64('../../secret.png')).rejects.toThrow(/引用非法/)
    await expect(store.readBase64('not-a-uuid.png')).rejects.toThrow(/引用非法/)
  })

  it('offloadInlineImages 幂等', async () => {
    const store = new NoteImageStore(await makeRoot())
    const text = `![截图](data:image/png;base64,${PNG_BASE64})`
    const first = await store.offloadInlineImages(text)
    expect(first.changed).toBe(true)
    expect(first.saved).toBe(1)
    expect(first.text).toMatch(/^!\[截图\]\(notes-asset:[0-9a-f-]{36}\.png\)$/)
    const second = await store.offloadInlineImages(first.text)
    expect(second).toEqual({ text: first.text, changed: false, saved: 0 })
    expect((await readdir(store.rootDir)).length).toBe(1)
  })
})
