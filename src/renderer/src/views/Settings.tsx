import { useEffect, useState, type ReactNode } from 'react'
import type { CacheStats, DiscordStatus } from '../../../shared/ipc'
import { Artwork } from '@/components/Artwork'
import { Logo } from '@/components/Icon'
import { userArt } from '@/lib/artwork'
import { cx } from '@/lib/hooks'
import { ACCENTS, setAccent, setTheme, THEMES, useTheme, type AccentName } from '@/lib/theme'
import { useAudius } from '@/lib/audius'
import { loginWithToken, logout, navigate, openUrl, signInSoundcloud, useApp } from '@/store/app'
import { askText, toast } from '@/store/ui'
import { loginYandex, logoutYandex, useYa } from '@/lib/yandexApi'
import { countLabel } from '@/lib/format'
import { player, usePlayer } from '@/store/player'
import { engine } from '@/player/engine'
import { lang, setLang, tx, type Lang } from '@/lib/i18n'
import { checkUpdate, installUpdate, useUpdate } from '@/lib/update'

const discordText = (): Record<DiscordStatus, string> => ({
  off: tx('Выключено'),
  connecting: tx('Подключаюсь к Discord…'),
  ready: tx('Подключено'),
  'no-discord': tx('Discord не запущен'),
  'bad-id': tx('Discord не принял ID приложения')
})

export function Settings(): React.JSX.Element {
  const me = useApp((s) => s.me)
  const scLikes = useApp((s) => s.likes.size)
  const scPlaylists = useApp((s) => s.library.length)
  const yaStatus = useYa((s) => s.status)
  const yaName = useYa((s) => s.name)
  const yaLikes = useYa((s) => s.likeOrder.length)
  const yaPlaylists = useYa((s) => s.playlists.length)
  const autoplay = usePlayer((s) => s.autoplay)
  const auLikes = useAudius((s) => s.likes.length)
  const theme = useTheme((s) => s.theme)
  const accent = useTheme((s) => s.accent)
  const [discordOn, setDiscordOn] = useState(true)
  const [toTray, setToTray] = useState(false)
  const [leveling, setLeveling] = useState(false)
  const [status, setStatus] = useState<DiscordStatus>('off')

  useEffect(() => {
    void window.sc.prefs.get().then((p) => {
      setDiscordOn(p.discordEnabled !== false)
      setToTray(p.closeToTray === true)
      setLeveling(p.leveling === true)
    })
    void window.sc.discord.status().then(setStatus)
    return window.sc.discord.onStatus(setStatus)
  }, [])

  const toggleDiscord = (): void => {
    const next = !discordOn
    setDiscordOn(next)
    void window.sc.prefs.set({ discordEnabled: next })
  }

  return (
    <div className="view settings">
      <h1 className="view-title">{tx("Настройки")}</h1>

      <Section title={tx("Аккаунт")}>
        {!me && (
          <Row
            label={
              <AccountLabel avatar={<div className="ya-mark round sc">SC</div>} service="SoundCloud" stats={tx('Не подключено')} />
            }
            control={
              <div className="settings-inline">
                <button className="btn btn-outline" onClick={() => void signInSoundcloud()}>{tx("Войти")}</button>
                <button className="btn btn-outline" onClick={() => void signInWithToken()}>{tx('По токену')}</button>
              </div>
            }
          />
        )}
        {me && (
          <Row
            label={
              <AccountLabel
                avatar={<Artwork src={userArt(me, 'large')} size={40} round placeholder="person" />}
                service="SoundCloud"
                stats={`${me.username} · ${libraryStats(scLikes, scPlaylists)}`}
              />
            }
            control={
              <div className="settings-inline">
                <button className="btn btn-outline" onClick={() => openUrl(me.permalink_url)}>{tx("Профиль")}</button>
                <button className="btn btn-outline" onClick={() => void signInWithToken()} title={tx('Если сессия слетела — вставьте свежий токен')}>
                  {tx('Токен')}
                </button>
                <button className="btn btn-outline" onClick={() => void logout()}>{tx("Выйти")}</button>
              </div>
            }
          />
        )}
        <Row
          label={
            <AccountLabel
              avatar={<div className="ya-mark round">Я</div>}
              service={tx('Яндекс Музыка')}
              stats={
                yaStatus === 'in'
                  ? `${yaName ? yaName + ' · ' : ''}${libraryStats(yaLikes, yaPlaylists)}`
                  : yaStatus === 'unknown'
                    ? tx('Подключаюсь…')
                    : tx('Не подключено')
              }
            />
          }
          control={
            yaStatus === 'in' ? (
              <div className="settings-inline">
                <button className="btn btn-outline" onClick={() => openUrl('https://music.yandex.ru/')}>{tx("Профиль")}</button>
                <button className="btn btn-outline" onClick={() => void logoutYandex()}>{tx("Выйти")}</button>
              </div>
            ) : (
              <div className="settings-inline">
                <button className="btn btn-outline" onClick={() => void loginYandex()}>{tx("Войти")}</button>
              </div>
            )
          }
        />
        <Row
          label={
            <AccountLabel
              avatar={<div className="ya-mark round">A</div>}
              service="Audius"
              stats={
                auLikes
                  ? tx('Вход не нужен · {0} в «Мне нравится»', countLabel(auLikes, tx('трек'), tx('трека'), tx('треков')))
                  : tx('Вход не нужен')
              }
            />
          }
          control={null}
        />
      </Section>

      <Section title={tx("Оформление")}>
        <Row
          label="Язык · Language"
          control={
            <div className="chips">
              {(
                [
                  ['ru', 'Русский'],
                  ['en', 'English']
                ] as [Lang, string][]
              ).map(([id, label]) => (
                <button key={id} className={cx('chip', lang === id && 'on')} onClick={() => setLang(id)}>
                  {label}
                </button>
              ))}
            </div>
          }
        />
        <div className="theme-grid" role="radiogroup" aria-label={tx("Тема")}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              role="radio"
              aria-checked={theme === t.id}
              className={cx('theme-card', theme === t.id && 'on')}
              onClick={() => setTheme(t.id)}
            >
              <ThemePreview colors={t.preview} accent={accent} />
              <span className="theme-name">{tx(t.label)}</span>
            </button>
          ))}
        </div>
        <Row
          label={tx("Акцент")}
          control={
            <div className="chips">
              {ACCENTS.map((a) => (
                <button key={a.id} className={cx('chip', accent === a.id && 'on')} onClick={() => setAccent(a.id)}>
                  {tx(a.label)}
                </button>
              ))}
            </div>
          }
        />
      </Section>

      <Section title={tx("Воспроизведение")}>
        <Row
          label={tx('Выравнивать громкость')}
          hint={tx('Тихие и громкие треки звучат ровнее')}
          control={
            <Switch
              on={leveling}
              onToggle={() => {
                setLeveling(!leveling)
                engine.setLeveling(!leveling)
                void window.sc.prefs.set({ leveling: !leveling })
              }}
              label={tx('Выравнивать громкость')}
            />
          }
        />
        <Row
          label={tx('Сворачивать в трей при закрытии')}
          hint={tx('Музыка продолжит играть')}
          control={
            <Switch
              on={toTray}
              onToggle={() => {
                setToTray(!toTray)
                void window.sc.prefs.set({ closeToTray: !toTray })
              }}
              label={tx('Сворачивать в трей при закрытии')}
            />
          }
        />
        <Row
          label={tx("Автопродолжение")}
          hint={tx("Когда очередь закончится, включать похожие треки")}
          control={<Switch on={autoplay} onToggle={player.toggleAutoplay} label={tx("Автопродолжение")} />}
        />
      </Section>

      <CacheSection />

      <Section title="Discord">
        <Row
          label={tx("Показывать в Discord, что я слушаю")}
          control={<Switch on={discordOn} onToggle={toggleDiscord} label="Discord Rich Presence" />}
        />
        {discordOn && (
          <p className={cx('settings-status', status === 'ready' && 'ok', status === 'bad-id' && 'bad')}>{discordText()[status]}</p>
        )}
      </Section>

      <Section title={tx("О приложении")}>
        <Row
          label={
            <span className="settings-account">
              <Logo size={40} />
              <span>
                <strong>Heddify</strong>
                <span className="settings-hint block">{tx('Версия {0} · автор — Heddrate', __APP_VERSION__)}</span>
              </span>
            </span>
          }
          control={null}
        />
        <UpdateRow />
        <Row
          label={tx("Журнал ошибок")}
          control={
            <button className="btn btn-outline" onClick={() => void window.sc.openLogs()}>{tx("Открыть папку")}</button>
          }
        />
      </Section>
    </div>
  )
}

/**
 * Sign in to SoundCloud with the oauth_token cookie from a browser where the user is
 * signed in — for when the sign-in window doesn't work or the session expired.
 */
async function signInWithToken(): Promise<void> {
  const token = await askText(tx('Вход в SoundCloud по токену'), '', tx('Войти'), {
    secret: true,
    placeholder: '2-000000-00000000-xxxxxxxxxxxx',
    text: tx(
      'Откройте soundcloud.com в обычном браузере, где вы вошли: F12 → Application → Cookies → https://soundcloud.com → скопируйте значение oauth_token. Можно вставить и всю строку cookie целиком.'
    )
  })
  if (!token) return
  const err = await loginWithToken(token)
  toast(err ? tx(err) : tx('Готово, SoundCloud подключён'))
}

const CACHE_LIMITS: [number, string][] = [
  [512, '512 МБ'],
  [1024, '1 ГБ'],
  [2048, '2 ГБ'],
  [5120, '5 ГБ'],
  [10240, '10 ГБ']
]

const fmtSize = (bytes: number): string =>
  bytes >= 1024 ** 3 ? tx('{0} ГБ', (bytes / 1024 ** 3).toFixed(1)) : tx('{0} МБ', Math.round(bytes / 1024 ** 2))

/** Audio cache: played tracks are kept on disk and play instantly next time, even offline. */
function CacheSection(): React.JSX.Element {
  const [stats, setStats] = useState<CacheStats | null>(null)
  const refresh = (): void => void window.sc.cache.stats().then(setStats)
  useEffect(refresh, [])

  const set = (patch: Record<string, unknown>): void => {
    void window.sc.prefs.set(patch).then(() => setTimeout(refresh, 300))
  }

  return (
    <Section title={tx('Кеш')}>
      <Row
        label={tx('Сохранять прослушанные треки')}
        hint={tx('Повторные запуски — сразу и без интернета')}
        control={
          <Switch
            on={stats?.enabled ?? true}
            onToggle={() => set({ cacheEnabled: !(stats?.enabled ?? true) })}
            label={tx('Сохранять прослушанные треки')}
          />
        }
      />
      {stats?.enabled !== false && (
        <Row
          label={tx('Размер кеша')}
          control={
            <div className="chips">
              {CACHE_LIMITS.map(([mb, label]) => (
                <button key={mb} className={cx('chip', stats?.limitMb === mb && 'on')} onClick={() => set({ cacheLimitMb: mb })}>
                  {tx(label)}
                </button>
              ))}
            </div>
          }
        />
      )}
      {(stats?.pinnedCount ?? 0) > 0 && (
        <Row
          label={tx('Скачанное')}
          hint={countLabel(stats!.pinnedCount, tx('трек'), tx('трека'), tx('треков'))}
          control={
            <button className="btn btn-outline" onClick={() => navigate({ name: 'offline' })}>
              {tx('Открыть')}
            </button>
          }
        />
      )}
      <Row
        label={tx('Занято')}
        hint={stats ? tx('{0} · {1}', fmtSize(stats.bytes), countLabel(stats.count, tx('трек'), tx('трека'), tx('треков'))) : '…'}
        control={
          <button
            className="btn btn-outline"
            disabled={!stats?.count}
            onClick={() =>
              void window.sc.cache.clear().then(() => {
                refresh()
                toast(tx('Кеш очищен'))
              })
            }
          >
            {tx('Очистить')}
          </button>
        }
      />
    </Section>
  )
}

/** Miniature of the app (sidebar, list, player bar) drawn in a theme's colours. */
function ThemePreview({ colors, accent }: { colors: [string, string, string, string]; accent: AccentName }): React.JSX.Element {
  const [bg, panel, raised, text] = colors
  const acc = accent === 'mono' ? text : '#ff5500'
  return (
    <svg viewBox="0 0 160 100" className="theme-preview" aria-hidden>
      <rect width="160" height="100" fill={bg} />
      <rect x="4" y="4" width="40" height="78" rx="3" fill={panel} />
      <rect x="48" y="4" width="108" height="78" rx="3" fill={panel} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="9" y={10 + i * 14} width="9" height="9" rx="1.5" fill={i === 0 ? acc : raised} />
          <rect x="21" y={12 + i * 14} width="18" height="2.5" rx="1" fill={text} opacity="0.75" />
        </g>
      ))}
      <rect x="54" y="10" width="36" height="5" rx="1.5" fill={text} />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x="54" y={24 + i * 12} width={i === 1 ? 70 : 84} height="7" rx="1.5" fill={raised} />
      ))}
      <circle cx="80" cy="91" r="4.5" fill={text} />
      <rect x="92" y="90" width="40" height="2" rx="1" fill={raised} />
      <rect x="92" y="90" width="18" height="2" rx="1" fill={acc} />
    </svg>
  )
}

const libraryStats = (likes: number, playlists: number): string =>
  tx('{0} в «Мне нравится» · {1}', countLabel(likes, tx('трек'), tx('трека'), tx('треков')), countLabel(playlists, tx('плейлист'), tx('плейлиста'), tx('плейлистов')))

/** One account row, the same for every service. */
function AccountLabel({ avatar, service, stats }: { avatar: ReactNode; service: string; stats: string }): React.JSX.Element {
  return (
    <span className="settings-account">
      {avatar}
      <span className="settings-account-text">
        <strong>{service}</strong>
        <span className="settings-hint block ellipsis">{stats}</span>
      </span>
    </span>
  )
}

/** Self-update: checks GitHub Releases; a downloaded version installs on restart. */
function UpdateRow(): React.JSX.Element | null {
  const u = useUpdate()
  if (u.status === 'unsupported') return null
  const hint =
    u.status === 'checking'
      ? tx('Проверяю…')
      : u.status === 'downloading'
        ? tx('Скачиваю версию {0} · {1}%', u.version ?? '', u.percent ?? 0)
        : u.status === 'ready'
          ? tx('Версия {0} скачана — установится при перезапуске', u.version ?? '')
          : u.status === 'latest'
            ? tx('Установлена последняя версия')
            : u.status === 'error'
              ? tx('Не удалось проверить')
              : undefined
  return (
    <Row
      label={tx('Обновления')}
      hint={hint}
      control={
        u.status === 'ready' ? (
          <button className="btn btn-primary" onClick={installUpdate}>
            {tx('Обновить')}
          </button>
        ) : (
          <button className="btn btn-outline" disabled={u.status === 'checking' || u.status === 'downloading'} onClick={checkUpdate}>
            {tx('Проверить')}
          </button>
        )
      }
    />
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="settings-section">
      <h2 className="h3">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, hint, control }: { label: ReactNode; hint?: string; control: ReactNode }): React.JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-text">
        <div className="settings-label">{label}</div>
        {hint && <div className="settings-hint">{hint}</div>}
      </div>
      <div className="settings-control">{control}</div>
    </div>
  )
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }): React.JSX.Element {
  return (
    <button className={cx('switch', on && 'on')} role="switch" aria-checked={on} aria-label={label} onClick={onToggle}>
      <span className="switch-knob" />
    </button>
  )
}
