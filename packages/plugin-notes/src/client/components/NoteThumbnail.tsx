import { useNoteImageSrc } from '../hooks/useNoteImageSrc.ts'
import { t } from '../core/theme-tokens.ts'

export interface NoteThumbnailProps {
  readonly src: string
  readonly maxHeight?: number
}

export function NoteThumbnail(props: NoteThumbnailProps): JSX.Element | null {
  const image = useNoteImageSrc(props.src)
  const maxHeight = props.maxHeight ?? 110
  if (image.url === undefined) return null
  return (
    <span style={{ ...thumbWrap, maxHeight }}>
      <img
        style={{ ...thumbImg, maxHeight }}
        src={image.url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={(event) => {
          event.currentTarget.style.display = 'none'
        }}
      />
    </span>
  )
}

const thumbWrap: React.CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  borderRadius: 8,
  background: t.hoverBg,
}

const thumbImg: React.CSSProperties = {
  maxWidth: '100%',
  height: 'auto',
  width: 'auto',
  objectFit: 'contain',
  borderRadius: 8,
}
