import { useState } from 'react'
import { installUpdate, useUpdate } from '@/lib/update'
import { tx } from '@/lib/i18n'
import { Logo } from './Icon'

/** "Доступно обновление": once a new version is downloaded, until "Позже" (then the avatar dot stays). */
let dismissed = ''

export function UpdateBanner(): React.JSX.Element | null {
  const version = useUpdate((s) => (s.status === 'ready' ? (s.version ?? '') : null))
  const [, rerender] = useState(0)
  if (version === null || dismissed === version) return null
  return (
    <div className="update-banner" role="status">
      <Logo size={36} />
      <div className="update-text">
        <strong>{tx('Доступно обновление')}</strong>
        <span>{version ? tx('Версия {0} готова к установке', version) : tx('Новая версия готова к установке')}</span>
      </div>
      <div className="update-actions">
        <button className="btn btn-primary btn-sm" onClick={installUpdate}>
          {tx('Перезапустить')}
        </button>
        <button
          className="btn btn-text btn-sm"
          onClick={() => {
            dismissed = version
            rerender((n) => n + 1)
          }}
        >
          {tx('Позже')}
        </button>
      </div>
    </div>
  )
}
