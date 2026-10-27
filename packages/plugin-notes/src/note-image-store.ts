import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_NOTE_IMAGE_BYTES,
  extensionForMediaType,
  findInlineImages,
  isValidNoteImageFile,
  mediaTypeOfNoteImageFile,
  replaceInlineImages,
} from './note-image-ref.ts'

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/u

export function resolveNoteImagesRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configured = env.DSH_HOME?.trim() ?? ''
  const base = configured === '' ? join(home, '.dsh') : configured
  return join(base, 'notes-assets')
}

export interface NoteImageStoreOptions {
  readonly maxBytes?: number
}

export interface OffloadImagesResult {
  readonly text: string
  readonly changed: boolean
  readonly saved: number
}

export class NoteImageStore {
  private readonly root: string
  private readonly maxBytes: number

  constructor(root: string, options: NoteImageStoreOptions = {}) {
    this.root = root
    this.maxBytes = options.maxBytes ?? MAX_NOTE_IMAGE_BYTES
  }

  get rootDir(): string {
    return this.root
  }

  async prepare(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  async saveBase64(data: string, mediaType: string): Promise<string> {
    const extension = extensionForMediaType(mediaType)
    if (extension === null) throw new Error(`不支持的图片类型：${mediaType}`)
    const bytes = this.decode(data)
    const fileName = `${randomUUID()}.${extension}`
    await mkdir(this.root, { recursive: true })
    await writeFile(join(this.root, fileName), bytes, { flag: 'wx' })
    return fileName
  }

  async readBase64(fileName: string): Promise<{ mediaType: string; data: string }> {
    const mediaType = mediaTypeOfNoteImageFile(fileName)
    if (!isValidNoteImageFile(fileName) || mediaType === null) throw new Error('图片引用非法')
    const bytes = await readFile(join(this.root, fileName))
    return { mediaType, data: bytes.toString('base64') }
  }

  async offloadInlineImages(text: string): Promise<OffloadImagesResult> {
    const matches = findInlineImages(text)
    if (matches.length === 0) return { text, changed: false, saved: 0 }
    const fileNames: string[] = []
    for (const match of matches) {
      fileNames.push(await this.saveBase64(match.base64, match.mediaType))
    }
    return {
      text: replaceInlineImages(text, matches, fileNames),
      changed: true,
      saved: matches.length,
    }
  }

  private decode(data: string): Uint8Array {
    if (data.length === 0 || data.length % 4 !== 0 || !BASE64_RE.test(data)) {
      throw new Error('图片数据不是合法 base64')
    }
    const bytes = Buffer.from(data, 'base64')
    if (bytes.toString('base64') !== data) throw new Error('图片数据不是规范 base64')
    if (bytes.byteLength > this.maxBytes) {
      throw new Error(`图片超过上限（${Math.round(this.maxBytes / 1024 / 1024)} MiB）`)
    }
    return new Uint8Array(bytes)
  }
}
