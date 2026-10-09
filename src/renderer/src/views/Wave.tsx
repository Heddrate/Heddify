import { openArtist, toggleAnyLike, useLiked } from '@/lib/actions'
import { useYa } from '@/lib/yandexApi'
import { useApp } from '@/store/app'
import { useEffect, useMemo, useState } from 'react'
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
  setWaveSources,
  startWave,
  toggleWave,
  useWave,
  useWaveActive,
  useWavePlaying,
  waveSource,
  waveSources
} from '@/lib/wave'
import { player, usePlayer } from '@/store/player'
import { tx } from '@/lib/i18n'

const UPCOMING = 30
/** Recently played tracks shown before "показать все". */
const RECENT = 5

/** "Моя волна" as its own page: what's playing, what's next, what already played. */
export function WaveView(): React.JSX.Element {
  const active = useWaveActive()
  const playing = useWavePlaying()
  const building = useWave((s) => s.building)
  const preview = useWave((s) => s.preview)
  const played = useWave((s) => s.played)
  const current = usePlayer((s) => (s.source?.kind === 'wave' ? s.current : null))
  const context = usePlayer((s) => s.context)
  const index = usePlayer((s) => s.index)
  const liked = useLiked(current)
  const sources = useWave((s) => s.sources)
  const yaIn = useYa((s) => s.status === 'in')
  const scIn = useApp((s) => s.auth === 'in')
  const source = useMemo(waveSource, [])
  const sourceOptions = waveSources().filter(([key]) => (key === 'sc' ? scIn : key === 'ya' ? yaIn : true))

  // Show what the wave would start with, without playing anything yet.
  useEffect(() => {
    if (!active) void ensurePreview()
  }, [active])

  const upcoming = useMemo(
    () => (active ? context.slice(index + 1, index + 1 + UPCOMING) : (preview ?? [])),
    [active, context, index, preview]
  )
  const history = useMemo(() => [...played].reverse(), [played])
  const [showAll, setShowAll] = useState(false)

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

        {(scIn || yaIn) && (
        <div className="wave-controls">
          {(
            <div className="wave-control">
              <span className="wave-control-label">{tx('Источники')}</span>
              <div className="chips" role="radiogroup" aria-label={tx("Откуда брать треки")}>
                {sourceOptions.map(([key, label]) => (
                  <button
                    key={key}
                    role="radio"
                    aria-checked={sources === key}
                    className={cx('chip', sources === key && 'on')}
                    onClick={() => void setWaveSources(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {history.length > 0 && (
          <section className="section first">
            <div className="shelf-head">
              <h2 className="h2">{tx('Только что звучало')}</h2>
              {history.length > RECENT && (
                <button className="link-more" onClick={() => setShowAll(!showAll)}>
                  {showAll ? tx('Свернуть') : tx('Показать все')}
                </button>
              )}
            </div>
            <TrackList
              tracks={showAll ? history : history.slice(0, RECENT)}
              source={source}
              head={false}
              onPlayIndex={(i) => player.playNow(history[i])}
            />
          </section>
        )}

        <section className={history.length ? 'section' : 'section first'}>
          <h2 className="h2">{active ? tx("Далее в волне") : tx("Волна начнётся с этих треков")}</h2>
          {!upcoming.length && building ? (
            <Loading />
          ) : !upcoming.length ? (
            <Empty icon="wave" title={tx("Пока нечего предложить")} text={tx("Лайкните несколько треков — волна строится по ним.")} />
          ) : (
            <TrackList
              tracks={upcoming}
              source={source}
              onPlayIndex={(i) => (active ? player.jumpContext(index + 1 + i) : void startWave(i))}
            />
          )}
        </section>

      </div>
    </div>
  )
}
