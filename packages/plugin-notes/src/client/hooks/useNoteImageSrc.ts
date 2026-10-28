import { useCallback, useEffect, useState } from 'react'
import { isNoteImageSrc } from '../../note-image-ref.ts'
import { noteImageUrl, peekNoteImageUrl } from '../core/note-image-cache.ts'

export interface NoteImageSrcState {
  readonly url: string | undefined
  readonly failed: boolean
  retry(): void
}

function initialState(src: string | null | undefined): { url?: string; failed: boolean } {
  if (src === null || src === undefined || src === '') return { failed: false }
  if (!isNoteImageSrc(src)) return { url: src, failed: false }
  return { url: peekNoteImageUrl(src), failed: false }
}

export function useNoteImageSrc(src: string | null | undefined): NoteImageSrcState {
  const [state, setState] = useState(() => initialState(src))
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (src === null || src === undefined || src === '') {
      setState({ url: undefined, failed: false })
      return
    }
    if (!isNoteImageSrc(src)) {
      setState({ url: src, failed: false })
      return
    }
    let alive = true
    const cached = peekNoteImageUrl(src)
    if (cached !== undefined) {
      setState({ url: cached, failed: false })
      return
    }
    setState({ url: undefined, failed: false })
    void noteImageUrl(src)
      .then((url) => {
        if (alive) setState({ url, failed: false })
      })
      .catch(() => {
        if (alive) setState({ url: undefined, failed: true })
      })
    return () => {
      alive = false
    }
  }, [src, nonce])

  const retry = useCallback(() => setNonce((value) => value + 1), [])
  return { url: state.url, failed: state.failed, retry }
}
