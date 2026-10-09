import { useState } from 'react'
import { Icon, Logo } from '@/components/Icon'
import { Spinner } from '@/components/States'
import { boot, cancelLogin, continueAsGuest, listenOffline, login, logout, useApp } from '@/store/app'
import { tx } from '@/lib/i18n'

type Mode = 'idle' | 'window' | 'token'

export function Login(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('idle')
  const [error, setError] = useState<string | null>(null)

  const start = async (): Promise<void> => {
    setMode('window')
    setError(null)
    const err = await login()
    setMode('idle')
    if (err) setError(err)
  }

  return (
    <div className="login">
      <div className="drag-strip" />
      <div className="login-col">
        <Logo size={56} />
        <h1 className="login-title">Heddify</h1>
        <p className="login-lead">{tx('SoundCloud, Яндекс Музыка и Audius в одном плеере.')}</p>

        {mode === 'window' ? (
          <div className="login-wait">
            <Spinner size={20} />
            <span>{tx("Завершите вход в открывшемся окне")}</span>
            <button className="btn btn-text" onClick={() => void cancelLogin()}>{tx("Отмена")}</button>
          </div>
        ) : (
          <div className="login-actions">
            <button className="btn btn-primary btn-lg" onClick={continueAsGuest} disabled={mode === 'token'}>
              {tx('Начать')}
            </button>
            <button className="btn btn-outline btn-lg" onClick={() => void start()} disabled={mode === 'token'}>{tx("Войти через SoundCloud")}</button>
          </div>
        )}

        {error && (
          <p className="login-error" role="alert">
            {tx(error)}
          </p>
        )}

        <p className="login-note">{tx('Сервисы можно подключить позже в настройках. Пароли приложению не передаются.')}</p>

      </div>
      <p className="credit">{tx('Версия {0}', __APP_VERSION__)}</p>
    </div>
  )
}

export function Offline(): React.JSX.Element {
  const error = useApp((s) => s.bootError)
  return (
    <div className="login">
      <div className="drag-strip" />
      <div className="login-col">
        <Icon name="refresh" size={40} className="state-icon" />
        <h1 className="login-title small">{tx("Нет связи с SoundCloud")}</h1>
        <p className="login-lead">{error ? tx(error) : tx('Проверьте подключение к интернету.')}</p>
        <div className="row-gap">
          <button className="btn btn-primary" onClick={() => void boot()}>{tx("Повторить")}</button>
          <button className="btn btn-outline" onClick={listenOffline}>{tx('Слушать скачанное')}</button>
          <button className="btn btn-outline" onClick={continueAsGuest}>{tx('Продолжить без SoundCloud')}</button>
          <button className="btn btn-text" onClick={() => void logout()}>{tx("Выйти")}</button>
        </div>
      </div>
    </div>
  )
}
