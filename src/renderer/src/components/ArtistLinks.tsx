import { openArtistRef } from '@/lib/actions'
import { artistRefs } from '@/lib/artists'
import { cx } from '@/lib/hooks'
import type { Track } from '@/lib/types'

/**
 * The artists of a track as separate links, "A, B": each name opens its own page.
 * `className` styles the whole line (its size, colour and cut-off); `onOpen` runs before a
 * link navigates (the full player closes first).
 */
export function ArtistLinks({ track, className, onOpen }: { track: Track; className: string; onOpen?: () => void }): React.JSX.Element | null {
  const refs = artistRefs(track)
  if (!refs.length) return null
  return (
    <span className={cx('artist-links', className)}>
      {refs.map((r, i) => (
        <span key={`${i}-${r.name}`}>
          {i > 0 && ', '}
          <button
            className="artist-name"
            onClick={(e) => {
              e.stopPropagation()
              onOpen?.()
              openArtistRef(track, r)
            }}
          >
            {r.name}
          </button>
        </span>
      ))}
    </span>
  )
}
