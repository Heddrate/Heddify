import { useEffect, useState } from 'react'
import { cx } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import { loginYandex, useYa } from '@/lib/yandexApi'
import { signInSoundcloud, useApp } from '@/store/app'
import { Logo } from './Icon'

/**
 * First run: three short steps — SoundCloud, Yandex Music, done. Shown once (pref
 * `onboarded`); installs that already had the app (Yandex was checked before) skip it.
 */
export function Onboarding(): React.JSX.Element | null {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)
  const me = useApp((s) => s.me)
  const ya = useYa((s) => s.status)
  const yaName = useYa((s) => s.name)

  useEffect(() => {
    const existing = localStorage.getItem('ya-checked') !== null
    void window.sc.prefs.get().then((p) => {
      if (p.onboarded === true) return
      if (existing) void window.sc.prefs.set({ onboarded: true })
      else setShow(true)
    })
  }, [])

  if (!show) return null

  const finish = (): void => {
    setShow(false)
    void window.sc.prefs.set({ onboarded: true })
  }
  const next = (): void => setStep((s) => s + 1)

  const steps = [
    {
      title: 'SoundCloud',
      text: me ? tx('Подключено: {0}', me.username) : tx('Лайки, подписки и плейлисты SoundCloud'),
      done: !!me,
      connect: () => void signInSoundcloud()
    },
    {
      title: tx('Яндекс Музыка'),
      text: ya === 'in' ? tx('Подключено: {0}', yaName ?? tx('Аккаунт Яндекса')) : tx('Лайки, плейлисты и волна Яндекса'),
      done: ya === 'in',
      connect: () => void loginYandex()
    }
  ]
  const s = steps[step]

  return (
    <div className="dialog-backdrop onboarding-backdrop">
      <div className="onboarding" role="dialog" aria-modal="true" aria-label={tx('Добро пожаловать')}>
        <div className="ob-dots" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cx('ob-dot', i === step && 'on')} />
          ))}
        </div>
        {s ? (
          <>
            <div className="ob-mark">{step === 0 ? <span className="ya-mark round sc big">SC</span> : <span className="ya-mark round big">Я</span>}</div>
            <h2 className="ob-title">{s.title}</h2>
            <p className="ob-text">{s.text}</p>
            <div className="ob-actions">
              {s.done ? (
                <button className="btn btn-primary btn-lg" onClick={next}>
                  {tx('Далее')}
                </button>
              ) : (
                <>
                  <button className="btn btn-primary btn-lg" onClick={s.connect}>
                    {tx('Войти')}
                  </button>
                  <button className="btn btn-text" onClick={next}>
                    {tx('Пропустить')}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="ob-mark">
              <Logo size={64} />
            </div>
            <h2 className="ob-title">{tx('Готово')}</h2>
            <p className="ob-text">{tx('Audius работает без входа. Сервисы можно подключить позже в настройках.')}</p>
            <div className="ob-actions">
              <button className="btn btn-primary btn-lg" onClick={finish}>
                {tx('Начать слушать')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
