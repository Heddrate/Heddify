import { useMemo, useState } from 'react'
import { Icon } from '@/components/Icon'
import { ActionBar, PageHeader } from '@/components/PageHeader'
import { Empty, Spinner } from '@/components/States'
import { TrackList } from '@/components/TrackList'
import { playOrToggle, useIsPlayingFrom } from '@/lib/actions'
import { countLabel, fmtTotal } from '@/lib/format'
import { tx } from '@/lib/i18n'
import { addMusicFolder, removeMusicFolder, rescan, searchLocal, useLocal } from '@/lib/local'
import type { PlaySource, Route } from '@/lib/types'

const FILES: Route = { name: 'files' }
const FILES_COLOR = 'hsl(0 0% 20%)'

/** Music from the user's own folders. */
export function FilesView(): React.JSX.Element {
  const loaded = useLocal((s) => s.loaded)
  const folders = useLocal((s) => s.folders)
  const all = useLocal((s) => s.tracks)
  const scanning = useLocal((s) => s.scanning)
  const [q, setQ] = useState('')
  const tracks = useMemo(() => (q.trim() ? searchLocal(q, 5000) : all), [q, all])
  const source = useMemo<PlaySource>(() => ({ label: tx('Файлы на компьютере'), route: FILES }), [])
  const active = useIsPlayingFrom(FILES)
  const total = all.reduce((s, t) => s + (t.duration || 0), 0)

  return (
    <div className="view flush">
      <PageHeader
        kind={tx('Медиатека')}
        title={tx('Файлы на компьютере')}
        color={FILES_COLOR}
        art={
          <div className="ph-tile">
            <Icon name="folder" size={92} />
          </div>
        }
        meta={
          <>
            {countLabel(all.length, tx('трек'), tx('трека'), tx('треков'))}
            {total > 0 && <span className="muted">, {fmtTotal(total)}</span>}
          </>
        }
      />
      <div className="page-body">
        <ActionBar
          playing={active}
          disabled={!tracks.length}
          onPlay={() => playOrToggle(tracks, source)}
          onShuffle={() => playOrToggle(tracks, source, { shuffle: true })}
          sticky={{ title: tx('Файлы на компьютере'), color: FILES_COLOR }}
        >
          <button className="btn btn-outline" onClick={() => void addMusicFolder()}>
            <Icon name="add" size={18} />
            {tx('Добавить папку')}
          </button>
          {folders.length > 0 && (
            <button className="icon-btn xl" onClick={() => void rescan()} disabled={!!scanning} title={tx('Обновить')} aria-label={tx('Обновить')}>
              <Icon name="refresh" size={26} />
            </button>
          )}
          {scanning && (
            <span className="files-scan">
              <Spinner size={18} />
              {scanning.total ? tx('Читаю файлы: {0} из {1}', scanning.done, scanning.total) : tx('Ищу файлы…')}
            </span>
          )}
        </ActionBar>

        {folders.length > 0 && (
          <div className="files-folders">
            {folders.map((f) => (
              <span key={f} className="files-folder" title={f}>
                <Icon name="folder" size={16} />
                <span className="ellipsis">{f}</span>
                <button className="icon-btn sm" aria-label={tx('Убрать папку')} title={tx('Убрать папку')} onClick={() => void removeMusicFolder(f)}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
          </div>
        )}

        {all.length > 20 && (
          <div className="search files-search">
            <Icon name="search" size={20} className="search-icon" />
            <input value={q} placeholder={tx('Поиск по файлам')} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}

        {!loaded ? null : !folders.length ? (
          <Empty icon="folder" title={tx('Добавьте папку с музыкой')} text={tx('MP3, FLAC, M4A, OGG и WAV из неё появятся здесь и в поиске.')} />
        ) : !tracks.length && !scanning ? (
          <Empty icon="search" title={q ? tx('Ничего не нашлось') : tx('В папках нет музыки')} />
        ) : (
          <TrackList tracks={tracks} source={source} extra="none" />
        )}
      </div>
    </div>
  )
}
