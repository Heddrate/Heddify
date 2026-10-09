import { useState, type FormEvent } from 'react'
import { Icon, Logo } from '@/components/Icon'
import { Spinner } from '@/components/States'
import { boot, cancelLogin, continueAsGuest, listenOffline, login, loginWithToken, logout, useApp } from '@/store/app'
import { tx } from '@/lib/i18n'

type Mode = 'idle' | 'window' | 'token'

export function Login(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('idle')
  const [showToken, setShowToken] = useState(false)
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  const start = async (): Promise<void> => {
    setMode('window')
    setError(null)
    const err = await login()
    setMode('idle')
    if (err) setError(err)
  }

  const submitToken = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!token.trim()) return
    setMode('token')
    setError(null)
    const err = await loginWithToken(token)
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

        <div className="login-alt">
          {!showToken ? (
            <button className="btn btn-text" onClick={() => setShowToken(true)}>{tx("Войти по токену")}</button>
          ) : (
            <form className="token-form" onSubmit={(e) => void submitToken(e)}>
              <label htmlFor="token" className="token-label">{tx("Откройте soundcloud.com в обычном браузере, где вы вошли, нажмите F12 → «Application» → Cookies → soundcloud.com и скопируйте значение ")}<code>oauth_token</code>.
              </label>
              <div className="token-row">
                <input
                  id="token"
                  className="input"
                  type="password"
                  autoComplete="off"
                  placeholder="2-000000-00000000-xxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoFocus
                />
                <button className="btn btn-outline" disabled={!token.trim() || mode !== 'idle'}>
                  {mode === 'token' ? <Spinner size={16} /> : tx("Войти")}
                </button>
              </div>
            </form>
          )}
        </div>
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
