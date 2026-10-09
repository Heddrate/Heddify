import { useMemo } from 'react'
import { Card, Grid, Shelf } from '@/components/Card'
import { Icon } from '@/components/Icon'
import { ActionBar, PageHeader } from '@/components/PageHeader'
import { Empty, ErrorState, Loading } from '@/components/States'
import { playOrToggle, trackMenu, useIsPlayingFrom } from '@/lib/actions'
import { trackArt } from '@/lib/artwork'
import { countLabel } from '@/lib/format'
import { cx, useAsync } from '@/lib/hooks'
import { lang, tx } from '@/lib/i18n'
import { radio, RADIO_TAGS, useRadio } from '@/lib/radio'
import type { PlaySource, Route, Track } from '@/lib/types'
import { navigate } from '@/store/app'
import { player } from '@/store/player'

const RADIO_COLOR = 'hsl(0 0% 22%)'

/** Station cards; playing one makes the whole row the queue, so next / previous switch stations. */
export function stationCards(stations: Track[], source: PlaySource): React.JSX.Element[] {
  return stations.map((t, i) => (
    <Card
      key={t.id}
      title={t.title ?? ''}
      sub={t.user?.username}
      art={trackArt(t)}
      letter={t.title}
      placeholder="radio"
      onOpen={() => player.playContext(stations, i, source)}
      onPlay={() => player.playContext(stations, i, source)}
      menu={() => trackMenu(t)}
    />
  ))
}

export function RadioView({ tag = '' }: { tag?: string }): React.JSX.Element {
  const route: Route = tag ? { name: 'radio', tag } : { name: 'radio' }
  const label = RADIO_TAGS().find(([t]) => t === tag)?.[1] ?? tag
  const res = useAsync(() => (tag ? radio.byTag(tag) : radio.top(lang === 'ru' ? 'RU' : undefined)), [tag], `p:radio:${tag || lang}`)
  const favs = useRadio((s) => s.favs)
  const stations = useMemo(() => res.data ?? [], [res.data])
  const source = useMemo<PlaySource>(() => ({ label: tx('Радио · {0}', label), route }), [label, tag]) // eslint-disable-line react-hooks/exhaustive-deps
  const favSource: PlaySource = { label: tx('Избранные станции'), route: { name: 'radio' } }
  const active = useIsPlayingFrom(route)

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Радио')}
        title={label}
        color={RADIO_COLOR}
        art={
          <div className="ph-tile">
            <Icon name="radio" size={92} />
          </div>
        }
        meta={stations.length ? countLabel(stations.length, tx('станция'), tx('станции'), tx('станций')) : undefined}
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!stations.length}
          onPlay={() => playOrToggle(stations, source)}
          onShuffle={() => playOrToggle(stations, source, { shuffle: true })}
          sticky={{ title: label, color: RADIO_COLOR }}
        />
        <div className="chips genre-chips" role="tablist">
          {RADIO_TAGS().map(([t, name]) => (
            <button key={t || 'top'} className={cx('chip', t === tag && 'on')} onClick={() => navigate(t ? { name: 'radio', tag: t } : { name: 'radio' }, true)}>
              {name}
            </button>
          ))}
        </div>
        {!tag && favs.length > 0 && (
          <Shelf title={tx('Избранные станции')}>
            {stationCards(favs, favSource)}
          </Shelf>
        )}
        {res.error && !stations.length ? (
          <ErrorState text={res.error} onRetry={res.reload} />
        ) : res.loading && !stations.length ? (
          <Loading />
        ) : !stations.length ? (
          <Empty icon="radio" title={tx('Станций не нашлось')} />
        ) : (
          <Grid>
            {stationCards(stations, source)}
          </Grid>
        )}
      </div>
    </div>
  )
}
