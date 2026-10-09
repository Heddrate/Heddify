import { useEffect, useRef } from 'react'
import { cx, useAsync } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import { activeLine, fetchLyrics } from '@/lib/lyrics'
import { closePanel, toggleNowPlaying } from '@/store/app'
import { player, usePlayer } from '@/store/player'
import { Icon } from './Icon'
import { Empty, Spinner } from './States'

/** Right-hand panel with the current track's lyrics; synced lines follow the music. */
export function LyricsPanel(): React.JSX.Element {
  const track = usePlayer((s) => s.current)
  const res = useAsync(() => (track ? fetchLyrics(track) : Promise.resolve(null)), [track?.id])
  const lines = res.data?.synced ?? null
  const index = usePlayer((s) => (lines ? activeLine(lines, s.position) : -1))
  const body = useRef<HTMLDivElement>(null)
  const userScrolled = useRef(0)

  // keep the current line in view, unless the user is scrolling around
  useEffect(() => {
    if (index < 0 || Date.now() - userScrolled.current < 4000) return
    body.current?.querySelector<HTMLElement>(`[data-i="${index}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [index])

  return (
    <aside className="queue panel lyrics">
      <div className="q-head">
        <h2 className="h3 ellipsis">{track?.title ?? tx('Текст песни')}</h2>
        <div className="q-head-actions">
          <button className="icon-btn" onClick={toggleNowPlaying} aria-label={tx('Сейчас играет')} title={tx('Сейчас играет')}>
            <Icon name="nowPlaying" size={20} />
          </button>
          <button className="icon-btn" onClick={closePanel} aria-label={tx('Закрыть')}>
            <Icon name="close" size={20} />
          </button>
        </div>
      </div>
      <div
        ref={body}
        className="q-body scroll-y lyrics-body"
        onWheel={() => (userScrolled.current = Date.now())}
        onPointerDown={() => (userScrolled.current = Date.now())}
      >
        {!track ? (
          <Empty icon="mic" title={tx('Ничего не играет')} />
        ) : res.loading && !res.data ? (
          <div className="lyrics-state">
            <Spinner />
          </div>
        ) : res.data?.instrumental && !lines && !res.data.plain ? (
          <Empty icon="note" title={tx('Инструментал')} text={tx('В этом треке нет слов.')} />
        ) : lines?.length ? (
          <div className="lyrics-lines">
            {lines.map((l, i) => (
              <button
                key={i}
                data-i={i}
                className={cx('lyric', i === index && 'on', i < index && 'past')}
                onClick={() => player.seek(l.t)}
              >
                {l.text || '♪'}
              </button>
            ))}
          </div>
        ) : res.data?.plain ? (
          <p className="lyrics-plain">{res.data.plain}</p>
        ) : (
          <Empty
            icon="mic"
            title={tx('Текст не нашёлся')}
          />
        )}
        {res.data && <p className="lyrics-credit">{tx('Текст: LRCLIB')}</p>}
      </div>
    </aside>
  )
}
