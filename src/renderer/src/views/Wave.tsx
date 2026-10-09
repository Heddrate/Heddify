import { openArtist, toggleAnyLike, useLiked } from '@/lib/actions'
import { useEffect, useMemo, useRef } from 'react'
import { Artwork } from '@/components/Artwork'
import { Icon } from '@/components/Icon'
import { ActionBar, PageHeader } from '@/components/PageHeader'
import { Empty, Loading, Spinner } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { trackArt, useArtColor } from '@/lib/artwork'
import { cx } from '@/lib/hooks'
import {
  dislikeCurrent,
  ensurePreview,
  refreshWave,
  startWave,
  toggleWave,
  useWave,
  useWaveActive,
  useWavePlaying,
  waveSource
} from '@/lib/wave'
import type { Track } from '@/lib/types'
import { player, usePlayer } from '@/store/player'
import { tx } from '@/lib/i18n'

const UPCOMING = 30

/** "Моя волна" as its own page: what's playing and what comes next (history is in the queue panel). */
export function WaveView(): React.JSX.Element {
  const active = useWaveActive()
  const playing = useWavePlaying()
  const building = useWave((s) => s.building)
  const preview = useWave((s) => s.preview)
  const current = usePlayer((s) => (s.source?.kind === 'wave' ? s.current : null))
  const context = usePlayer((s) => s.context)
  const index = usePlayer((s) => s.index)
  const liked = useLiked(current)
  const source = useMemo(waveSource, [])

  // Show what the wave would start with, without playing anything yet.
  useEffect(() => {
    if (!active) void ensurePreview()
  }, [active])

  const next = useMemo(
    () => (active ? context.slice(index + 1, index + 1 + UPCOMING) : (preview ?? [])),
    [active, context, index, preview]
  )
  // while a new batch is being picked the list may be empty for a moment: keep showing the
  // last one, or the page would shrink and the scroll jump to the top
  const lastNext = useRef<Track[]>([])
  if (next.length) lastNext.current = next
  const upcoming = next.length || !building ? next : lastNext.current

  const artUrl = current ? trackArt(current, 't500x500') : null
  const color = useArtColor(artUrl)
  const headColor = color ?? 'hsl(0 0% 22%)'

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Микс')}
        title={tx("Моя волна")}
        color={headColor}
        art={
          current ? (
            <Artwork src={artUrl} />
          ) : (
            <div className="ph-tile wave-art">
              <Icon name="wave" size={104} />
            </div>
          )
        }
        meta={
          current ? (
            <span className="wave-now">{tx("Сейчас: ")}<strong>{current.title}</strong>
              {current.user && (
                <>
                  <span className="dot">•</span>
                  <button className="link" onClick={() => openArtist(current)}>
                    {current.user.username}
                  </button>
                </>
              )}
            </span>
          ) : (
            tx('По вашим лайкам и пропускам')
          )
        }
      />
      <div className="page-body">
        <ActionBar
          playing={playing}
          onPlay={() => void toggleWave()}
          disabled={building && !active && !preview?.length}
          sticky={{ title: tx("Моя волна"), color: headColor }}
        >
          {active && current && (
            <>
              <button
                className={cx('icon-btn xl like', liked && 'on')}
                onClick={() => toggleAnyLike(current)}
                title={liked ? tx("Убрать из «Мне нравится»") : tx("Мне нравится")}
                aria-label={liked ? tx("Убрать из «Мне нравится»") : tx("Мне нравится")}
              >
                <Icon name={liked ? 'heart' : 'heartOutline'} size={30} />
              </button>
              <button
                className="icon-btn xl"
                onClick={dislikeCurrent}
                title={tx("Не нравится: пропустить и убрать исполнителя из волны")}
                aria-label={tx("Не нравится")}
              >
                <Icon name="thumbDown" size={26} />
              </button>
            </>
          )}
          <button
            className="icon-btn xl"
            onClick={() => void refreshWave()}
            disabled={building}
            title={tx("Пересобрать подборку")}
            aria-label={tx("Пересобрать подборку")}
          >
            {building ? <Spinner size={22} /> : <Icon name="refresh" size={26} />}
          </button>
        </ActionBar>

        <section className="section first wave-next">
          <h2 className="h2">{active ? tx("Далее в волне") : tx("Волна начнётся с этих треков")}</h2>
          {!upcoming.length && building ? (
            <Loading />
          ) : !upcoming.length ? (
            <Empty icon="wave" title={tx("Пока нечего предложить")} text={tx("Лайкните несколько треков — волна строится по ним.")} />
          ) : (
            <TrackList
              tracks={upcoming}
              source={source}
              appear
              onPlayIndex={(i) => (active ? player.jumpContext(index + 1 + i) : void startWave(i))}
            />
          )}
        </section>

      </div>
    </div>
  )
}
