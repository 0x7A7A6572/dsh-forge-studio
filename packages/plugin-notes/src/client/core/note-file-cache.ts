import type { NotesRemote } from './notes-remote.ts'
import { blobToBase64 } from './paste-image.ts'

let remote: NotesRemote | undefined

export function mountNoteFiles(client: NotesRemote): () => void {
  remote = client
  return () => {
    remote = undefined
  }
}

function requireRemote(): NotesRemote {
  if (remote === undefined) throw new Error('附件通道未挂载')
  return remote
}

export async function uploadNoteFile(blob: Blob, name: string): Promise<string> {
  const data = await blobToBase64(blob)
  const result = await requireRemote().saveFile({ data, name })
  if (!result.ok) throw new Error(result.error.message)
  return result.value.src
}

export async function downloadNoteFile(src: string, name: string): Promise<void> {
  const bytes = await readBytes(src)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name === '' ? 'attachment' : name
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function viewNoteFile(src: string, name: string): Promise<void> {
  const result = await requireRemote().openFile({ src, name })
  if (!result.ok) throw new Error(result.error.message)
}

async function readBytes(src: string): Promise<Uint8Array> {
  const result = await requireRemote().readFile(src)
  if (!result.ok) throw new Error(result.error.message)
  const binary = atob(result.value.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
