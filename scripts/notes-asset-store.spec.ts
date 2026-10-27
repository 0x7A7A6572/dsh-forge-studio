/**
 * 附件仓门禁：文件名校验是任意路径读的唯一闸门；offload 必须幂等，
 * 否则每次启动都会把已迁完的正文再扫一遍写一次 updatedAt。
 * 图片与普通文件共用 notes-assets 目录，但各有自己的引用格式。
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  NoteAssetStore,
  resolveNoteAssetsRoot,
} from '../packages/plugin-notes/src/note-asset-store.ts'

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

describe('resolveNoteAssetsRoot', () => {
  it('DSH_HOME 绝对路径直接落 notes-assets', () => {
    expect(resolveNoteAssetsRoot({ DSH_HOME: 'D:\\home\\.dsh' }, 'C:\\Users\\x')).toBe(
      'D:\\home\\.dsh\\notes-assets',
    )
  })

  it('DSH_HOME 相对路径保持相对（pnpm dev 的 .dsh-home）', () => {
    expect(resolveNoteAssetsRoot({ DSH_HOME: '.dsh-home' }, 'C:\\Users\\x')).toBe(
      '.dsh-home\\notes-assets',
    )
  })

  it('缺省回落 ~/.dsh', () => {
    expect(resolveNoteAssetsRoot({}, 'C:\\Users\\x')).toBe('C:\\Users\\x\\.dsh\\notes-assets')
  })
})

describe('NoteAssetStore 读写', () => {
  it('图片 save → 文件落盘 → read 原样回来', async () => {
    const store = new NoteAssetStore(await makeRoot())
    const fileName = await store.saveImageBase64(PNG_BASE64, 'image/png')
    expect(await readdir(store.rootDir)).toEqual([fileName])
    expect(await readFile(join(store.rootDir, fileName), 'utf8')).toBe('hello')
    await expect(store.readImageBase64(fileName)).resolves.toEqual({
      mediaType: 'image/png',
      data: PNG_BASE64,
    })
  })

  it('普通文件按原扩展名落盘，read 原样回来', async () => {
    const store = new NoteAssetStore(await makeRoot())
    const fileName = await store.saveFileBase64(PNG_BASE64, '会议记录.PDF')
    expect(fileName).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    await expect(store.readFileBase64(fileName)).resolves.toBe(PNG_BASE64)
    expect(await store.saveFileBase64(PNG_BASE64, '无扩展名')).toMatch(/\.bin$/)
  })

  it('非白名单 mime / 非法 base64 / 超上限都拒绝', async () => {
    const store = new NoteAssetStore(await makeRoot(), { maxImageBytes: 4, maxFileBytes: 4 })
    await expect(store.saveImageBase64(PNG_BASE64, 'image/bmp')).rejects.toThrow(/不支持的图片类型/)
    await expect(store.saveImageBase64('abc', 'image/png')).rejects.toThrow(/合法 base64/)
    await expect(store.saveImageBase64(PNG_BASE64, 'image/png')).rejects.toThrow(/超过上限/)
    await expect(store.saveFileBase64(PNG_BASE64, 'big.zip')).rejects.toThrow(/超过上限/)
  })

  it('read 拒绝路径穿越与非法文件名', async () => {
    const store = new NoteAssetStore(await makeRoot())
    await expect(store.readImageBase64('../../secret.png')).rejects.toThrow(/引用非法/)
    await expect(store.readImageBase64('not-a-uuid.png')).rejects.toThrow(/引用非法/)
    await expect(store.readFileBase64('../../secret.pdf')).rejects.toThrow(/引用非法/)
    await expect(store.readFileBase64('not-a-uuid.pdf')).rejects.toThrow(/引用非法/)
  })

  it('offloadInlineImages 幂等', async () => {
    const store = new NoteAssetStore(await makeRoot())
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
