export const NOTE_IMAGE_PREFIX = 'notes-asset:'

export const MAX_NOTE_IMAGE_BYTES = 20 * 1024 * 1024

const EXTENSION_TO_MEDIA_TYPE: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

const MEDIA_TYPE_TO_EXTENSION: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

const MEDIA_TYPE_PATTERN = 'png|jpeg|webp|gif|svg\\+xml'

const FILE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpe?g|webp|gif|svg)$/u

export interface InlineImageMatch {
  readonly start: number
  readonly end: number
  readonly mediaType: string
  readonly base64: string
}

function inlineImageRegExp(kind: 'markdown' | 'html'): RegExp {
  const dataUrl = `data:image/(${MEDIA_TYPE_PATTERN});base64,([A-Za-z0-9+/]+={0,2})`
  return kind === 'markdown'
    ? new RegExp(`!\\[[^\\]]*\\]\\(\\s*(${dataUrl})`, 'gu')
    : new RegExp(`<img\\b[^>]*\\bsrc\\s*=\\s*["'](${dataUrl})["']`, 'giu')
}

function inlineMediaType(subtype: string): string {
  const lower = subtype.toLowerCase()
  return lower === 'svg+xml' ? 'image/svg+xml' : `image/${lower}`
}

function collectInlineImages(
  text: string,
  kind: 'markdown' | 'html',
  out: InlineImageMatch[],
): void {
  for (const match of text.matchAll(inlineImageRegExp(kind))) {
    const whole = match[0]
    const dataUrl = match[1]
    if (dataUrl === undefined) continue
    const subtype = match[2] ?? 'png'
    const start = (match.index ?? 0) + whole.indexOf(dataUrl)
    const base64Start = dataUrl.indexOf('base64,') + 'base64,'.length
    out.push({
      start,
      end: start + dataUrl.length,
      mediaType: inlineMediaType(subtype),
      base64: dataUrl.slice(base64Start),
    })
  }
}

export function noteImageSrc(fileName: string): string {
  return NOTE_IMAGE_PREFIX + fileName
}

export function isValidNoteImageFile(fileName: string): boolean {
  return FILE_NAME_RE.test(fileName)
}

export function isNoteImageSrc(src: string): boolean {
  return fileNameOfNoteImageSrc(src) !== null
}

export function fileNameOfNoteImageSrc(src: string): string | null {
  if (!src.startsWith(NOTE_IMAGE_PREFIX)) return null
  const fileName = src.slice(NOTE_IMAGE_PREFIX.length)
  return isValidNoteImageFile(fileName) ? fileName : null
}

export function mediaTypeOfNoteImageFile(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return null
  return EXTENSION_TO_MEDIA_TYPE[fileName.slice(dot + 1).toLowerCase()] ?? null
}

export function extensionForMediaType(mediaType: string): string | null {
  return MEDIA_TYPE_TO_EXTENSION[mediaType.trim().toLowerCase()] ?? null
}

export function findInlineImages(text: string): InlineImageMatch[] {
  if (!text.includes('data:image/')) return []
  const matches: InlineImageMatch[] = []
  collectInlineImages(text, 'markdown', matches)
  collectInlineImages(text, 'html', matches)
  return matches.sort((left, right) => left.start - right.start)
}

export function replaceInlineImages(
  text: string,
  matches: readonly InlineImageMatch[],
  fileNames: readonly string[],
): string {
  if (matches.length !== fileNames.length) throw new Error('内联图片与文件名数量不一致')
  let out = text
  for (let index = matches.length - 1; index >= 0; index--) {
    const match = matches[index]!
    out = out.slice(0, match.start) + noteImageSrc(fileNames[index]!) + out.slice(match.end)
  }
  return out
}
