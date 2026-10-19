import { useState } from 'react'
import { installUpdate, useInstalling, useUpdate } from '@/lib/update'
import { Spinner } from './States'
import { tx } from '@/lib/i18n'
import { Logo } from './Icon'

/** "Вышла версия …": once a new version is downloaded, until "Позже" (then the avatar dot stays). */
let dismissed = ''

export function UpdateBanner(): React.JSX.Element | null {
  const version = useUpdate((s) => (s.status === 'ready' ? (s.version ?? '') : null))
  const installing = useInstalling((s) => s.on)
  const [, rerender] = useState(0)
  if (installing) {
    return (
      <div className="update-installing" role="status">
        <Logo size={64} />
        <strong>{tx('Устанавливаю обновление')}</strong>
        <span>{tx('Heddify закроется и откроется сам через полминуты')}</span>
        <Spinner size={22} />
      </div>
    )
  }
  if (version === null || dismissed === version) return null
  // what changed is in Settings → "Что нового" after the restart; the card only offers it
  return (
    <div className="update-banner" role="status">
      <Logo size={36} />
      <div className="update-text">
        <strong>{version ? tx('Вышла версия {0}', version) : tx('Вышло обновление')}</strong>
        <span>{tx('Установится за полминуты')}</span>
      </div>
      <div className="update-actions">
        <button
          className="btn btn-text btn-sm"
          onClick={() => {
            dismissed = version
            rerender((n) => n + 1)
          }}
        >
          {tx('Позже')}
        </button>
        <button className="btn btn-primary btn-sm" onClick={installUpdate}>
          {tx('Обновить')}
        </button>
      </div>
    </div>
  )
}
