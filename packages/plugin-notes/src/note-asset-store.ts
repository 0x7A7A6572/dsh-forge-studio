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
import {
  MAX_NOTE_FILE_BYTES,
  extensionOfNoteFileName,
  isValidNoteFile,
} from './note-file-ref.ts'

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/u

export function resolveNoteAssetsRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const configured = env.DSH_HOME?.trim() ?? ''
  const base = configured === '' ? join(home, '.dsh') : configured
  return join(base, 'notes-assets')
}

export interface NoteAssetStoreOptions {
  readonly maxImageBytes?: number
  readonly maxFileBytes?: number
}

export interface OffloadImagesResult {
  readonly text: string
  readonly changed: boolean
  readonly saved: number
}

export class NoteAssetStore {
  private readonly root: string
  private readonly maxImageBytes: number
  private readonly maxFileBytes: number

  constructor(root: string, options: NoteAssetStoreOptions = {}) {
    this.root = root
    this.maxImageBytes = options.maxImageBytes ?? MAX_NOTE_IMAGE_BYTES
    this.maxFileBytes = options.maxFileBytes ?? MAX_NOTE_FILE_BYTES
  }

  get rootDir(): string {
    return this.root
  }

  async prepare(): Promise<void> {
    await mkdir(this.root, { recursive: true })
  }

  async saveImageBase64(data: string, mediaType: string): Promise<string> {
    const extension = extensionForMediaType(mediaType)
    if (extension === null) throw new Error(`不支持的图片类型：${mediaType}`)
    const bytes = this.decode(data, this.maxImageBytes)
    return this.write(`${randomUUID()}.${extension}`, bytes)
  }

  async readImageBase64(fileName: string): Promise<{ mediaType: string; data: string }> {
    const mediaType = mediaTypeOfNoteImageFile(fileName)
    if (!isValidNoteImageFile(fileName) || mediaType === null) throw new Error('图片引用非法')
    return { mediaType, data: (await this.read(fileName)).toString('base64') }
  }

  async saveFileBase64(data: string, name: string): Promise<string> {
    const bytes = this.decode(data, this.maxFileBytes)
    return this.write(`${randomUUID()}.${extensionOfNoteFileName(name)}`, bytes)
  }

  async readFileBase64(fileName: string): Promise<string> {
    if (!isValidNoteFile(fileName)) throw new Error('附件引用非法')
    return (await this.read(fileName)).toString('base64')
  }

  filePath(fileName: string): string {
    if (!isValidNoteFile(fileName)) throw new Error('附件引用非法')
    return join(this.root, fileName)
  }

  async offloadInlineImages(text: string): Promise<OffloadImagesResult> {
    const matches = findInlineImages(text)
    if (matches.length === 0) return { text, changed: false, saved: 0 }
    const fileNames: string[] = []
    for (const match of matches) {
      fileNames.push(await this.saveImageBase64(match.base64, match.mediaType))
    }
    return {
      text: replaceInlineImages(text, matches, fileNames),
      changed: true,
      saved: matches.length,
    }
  }

  private async write(fileName: string, bytes: Uint8Array): Promise<string> {
    await mkdir(this.root, { recursive: true })
    await writeFile(join(this.root, fileName), bytes, { flag: 'wx' })
    return fileName
  }

  private async read(fileName: string): Promise<Buffer> {
    return readFile(join(this.root, fileName))
  }

  private decode(data: string, maxBytes: number): Uint8Array {
    if (data.length === 0 || data.length % 4 !== 0 || !BASE64_RE.test(data)) {
      throw new Error('文件数据不是合法 base64')
    }
    const bytes = Buffer.from(data, 'base64')
    if (bytes.toString('base64') !== data) throw new Error('文件数据不是规范 base64')
    if (bytes.byteLength > maxBytes) {
      throw new Error(`文件超过上限（${Math.round(maxBytes / 1024 / 1024)} MiB）`)
    }
    return new Uint8Array(bytes)
  }
}
