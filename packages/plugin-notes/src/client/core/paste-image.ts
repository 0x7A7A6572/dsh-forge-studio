/**
 * 编辑器粘贴辅助（图片与文件都先落本地附件仓，正文只存引用）：
 * - pickClipboardFiles：从 clipboard 文件列表按原顺序取出全部文件；
 * - blobToBase64：把 Blob 编码成规范 base64（arrayBuffer + 分块 btoa）。
 */

export interface ClipboardFileLike {
  readonly type: string
  readonly name?: string
}

export interface ClipboardFilesLike {
  readonly files?: ArrayLike<ClipboardFileLike> | null
}

export function pickClipboardFiles(clipboard: ClipboardFilesLike | null | undefined): Blob[] {
  if (!clipboard?.files) return []
  const files = clipboard.files
  const out: Blob[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (file && typeof file.type === 'string') out.push(file as Blob)
  }
  return out
}

/** Blob → 规范 base64；btoa 分块避免大文件超栈。 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
