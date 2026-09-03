/**
 * 编辑器图片粘贴辅助（base64 内联方案）：
 * - pickImageFiles：从 clipboard DataTransfer 文件列表挑出图片文件（顺序保持，返回 Blob[]）；
 * - fileToDataUrl：把 Blob/File 读成 data URL（arrayBuffer + 分块 btoa，浏览器/Node 通用）。
 */

/** clipboard 文件项的最小形状（DataTransfer FileList 兼容，只读 type 字段做过滤）。 */
export interface ClipboardFileLike {
  readonly type: string
}

/** clipboard 形状的最小接口（DataTransfer 兼容）。 */
export interface ClipboardFilesLike {
  readonly files?: ArrayLike<ClipboardFileLike> | null
}

export function pickImageFiles(clipboard: ClipboardFilesLike | null | undefined): Blob[] {
  if (!clipboard?.files) return []
  const files = clipboard.files
  const out: Blob[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (file && typeof file.type === 'string' && file.type.startsWith('image/')) {
      out.push(file as Blob)
    }
  }
  return out
}

/** Blob → data URL；btoa 分块避免大图超栈。 */
export async function fileToDataUrl(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${file.type || 'image/png'};base64,${btoa(binary)}`
}
