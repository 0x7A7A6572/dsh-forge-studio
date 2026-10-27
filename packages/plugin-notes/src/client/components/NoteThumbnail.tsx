import { useNoteImageSrc } from '../hooks/useNoteImageSrc.ts'
import { t } from '../core/theme-tokens.ts'

export interface NoteThumbnailProps {
  readonly src: string
}

export function NoteThumbnail(props: NoteThumbnailProps): JSX.Element | null {
  const image = useNoteImageSrc(props.src)
  if (image.url === undefined) return null
  return (
    <span style={thumbWrap}>
      <img
        style={thumbImg}
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
  maxHeight: 110,
  overflow: 'hidden',
  borderRadius: 8,
  background: t.hoverBg,
}

const thumbImg: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: 110,
  height: 'auto',
  width: 'auto',
  objectFit: 'contain',
  borderRadius: 8,
}
