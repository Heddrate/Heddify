import { cx } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import { downloadTracks, removeDownloads, useDownloadState, useOffline } from '@/lib/offline'
import type { Track } from '@/lib/types'
import { Icon } from './Icon'

/** Action-bar button: download a list for offline listening, or remove the download. */
export function DownloadButton({
  tracks,
  loadAll,
  onChange
}: {
  tracks: Track[]
  /** Told when the user downloads (true) or removes (false) the list. */
  onChange?: (offline: boolean) => void
  /** For paged lists: fetch every track before downloading (only the first page is loaded). */
  loadAll?: () => Promise<Track[]>
}): React.JSX.Element | null {
  const state = useDownloadState(tracks)
  const progress = useOffline((s) => s.progress)
  if (!tracks.some((t) => t.origin !== 'yandex')) return null

  const busy = !!progress && state !== 'all'
  const label =
    state === 'all' ? tx('Скачано — нажмите, чтобы удалить') : busy ? tx('Скачиваю {0} из {1}', progress.done, progress.total) : tx('Скачать')

  return (
    <button
      className={cx('icon-btn xl download-btn', state === 'all' && 'on')}
      title={label}
      aria-label={label}
      onClick={() => {
        if (state === 'all') void removeDownloads(tracks).then((removed) => removed && onChange?.(false))
        else {
          onChange?.(true)
          void (loadAll ? loadAll() : Promise.resolve(tracks)).then(downloadTracks)
        }
      }}
    >
      {busy ? (
        <span className="dl-ring" style={{ ['--p' as string]: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}>
          <Icon name="download" size={16} />
        </span>
      ) : (
        <Icon name={state === 'all' ? 'downloadDone' : 'download'} size={28} />
      )}
    </button>
  )
}
