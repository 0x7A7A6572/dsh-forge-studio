export const NOTE_FILE_PREFIX = 'notes-file:'

export const MAX_NOTE_FILE_BYTES = 32 * 1024 * 1024

const FILE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$/u

export function noteFileSrc(fileName: string): string {
  return NOTE_FILE_PREFIX + fileName
}

export function isValidNoteFile(fileName: string): boolean {
  return FILE_NAME_RE.test(fileName)
}

export function fileNameOfNoteFileSrc(src: string): string | null {
  if (!src.startsWith(NOTE_FILE_PREFIX)) return null
  const fileName = src.slice(NOTE_FILE_PREFIX.length)
  return isValidNoteFile(fileName) ? fileName : null
}

export function isNoteFileSrc(src: string): boolean {
  return fileNameOfNoteFileSrc(src) !== null
}

export function extensionOfNoteFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'bin'
  const extension = name
    .slice(dot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '')
  return extension === '' ? 'bin' : extension.slice(0, 10)
}
