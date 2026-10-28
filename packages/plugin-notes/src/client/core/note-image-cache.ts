import type { NotesRemote } from './notes-remote.ts'
import { isNoteImageSrc } from '../../note-image-ref.ts'
import { blobToBase64 } from './paste-image.ts'

interface CacheEntry {
  pending: Promise<string>
  url: string | undefined
}

let remote: NotesRemote | undefined
const entries = new Map<string, CacheEntry>()

export function mountNoteImages(client: NotesRemote): () => void {
  remote = client
  return () => {
    remote = undefined
    for (const entry of entries.values()) {
      if (entry.url !== undefined && entry.url.startsWith('blob:')) URL.revokeObjectURL(entry.url)
    }
    entries.clear()
  }
}

function requireRemote(): NotesRemote {
  if (remote === undefined) throw new Error('图片通道未挂载')
  return remote
}

export async function uploadNoteImage(blob: Blob): Promise<string> {
  const data = await blobToBase64(blob)
  const result = await requireRemote().saveImage({
    data,
    mediaType: (blob.type || 'image/png').toLowerCase(),
  })
  if (!result.ok) throw new Error(result.error.message)
  return result.value.src
}

export function peekNoteImageUrl(src: string): string | undefined {
  return entries.get(src)?.url
}

export function noteImageUrl(src: string): Promise<string> {
  if (!isNoteImageSrc(src)) return Promise.reject(new Error('图片引用非法'))
  const cached = entries.get(src)
  if (cached !== undefined) return cached.pending
  const entry: CacheEntry = { pending: Promise.resolve(''), url: undefined }
  entries.set(src, entry)
  entry.pending = load(src)
    .then((url) => {
      entry.url = url
      return url
    })
    .catch((error) => {
      if (entries.get(src) === entry && entry.url === undefined) entries.delete(src)
      throw error
    })
  return entry.pending
}

async function load(src: string): Promise<string> {
  const result = await requireRemote().readImage(src)
  if (!result.ok) throw new Error(result.error.message)
  const binary = atob(result.value.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  if (typeof URL.createObjectURL !== 'function') {
    return `data:${result.value.mediaType};base64,${result.value.data}`
  }
  return URL.createObjectURL(new Blob([bytes], { type: result.value.mediaType }))
}
