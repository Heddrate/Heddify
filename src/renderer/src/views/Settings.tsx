import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CacheStats, DiscordStatus } from '../../../shared/ipc'
import { Artwork } from '@/components/Artwork'
import { Slider } from '@/components/Slider'
import { Icon, Logo } from '@/components/Icon'
import { userArt } from '@/lib/artwork'
import { cx } from '@/lib/hooks'
import { ACCENTS, anchorsOf, isUserTheme, PALETTES, setAccent, setBg, setCustomColors, setLook, setTheme, THEMES, usesPalette, useTheme } from '@/lib/theme'
import { cleanName, LOOK_LIMITS, type BgLook, type BgMode, type UserTheme } from '@/lib/themeFile'
import { applyUserTheme, deleteUserTheme, exportUserTheme, importThemeFile, saveCurrentTheme, themeIdOf } from '@/lib/userThemes'
import { getImage, prepareImage, setWallpaper, themeImageKey, useWallpaper } from '@/lib/wallpaper'
import { derivePalette } from '@/lib/palette'
import { pickAvatar, removeAvatar, setProfileName, useProfile } from '@/lib/profile'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { GetAppLink } from '@/components/GetApp'
import { loginWithToken, logout, navigate, openUrl, signInSoundcloud, useApp } from '@/store/app'
import { askConfirm, askText, openMenu, toast } from '@/store/ui'
import { loginYandex, logoutYandex, useYa } from '@/lib/yandexApi'
import { loginVk, logoutVk, useVk } from '@/lib/vkLibrary'
import { countLabel } from '@/lib/format'
import { player, usePlayer } from '@/store/player'
import { engine } from '@/player/engine'
import { lang, setLang, tx, type Lang } from '@/lib/i18n'
import { checkUpdate, installUpdate, useUpdate } from '@/lib/update'

/** The notes of this version, one line each, bullets dropped. */
const whatsNew = (): string[] =>
  __RELEASE_NOTES__.split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)

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
  const yaAvatar = useYa((s) => s.avatar)
  const vkStatus = useVk((s) => s.status)
  const vkUid = useVk((s) => s.uid)
  const vkTracks = useVk((s) => s.mine.length)
  const ownAvatar = useProfile((s) => s.avatar)
  const ownName = useProfile((s) => s.name)
  const autoplay = usePlayer((s) => s.autoplay)
  const [discordOn, setDiscordOn] = useState(true)
  const [toTray, setToTray] = useState(false)
  const [leveling, setLeveling] = useState(false)
  const [fade, setFade] = useState(false)
  /** Glow strength 0..1; 0 is off. */
  const [bassGlow, setBassGlow] = useState(0)
  const [status, setStatus] = useState<DiscordStatus>('off')

  useEffect(() => {
    void window.sc.prefs.get().then((p) => {
      setDiscordOn(p.discordEnabled !== false)
      setToTray(p.closeToTray === true)
      setLeveling(p.leveling === true)
      setFade(p.crossfade === true)
      setBassGlow(typeof p.bassGlow === 'number' ? p.bassGlow : p.bassGlow === true ? 0.6 : 0)
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

      <div className="settings-cols">
        <div className="settings-col">
        <Section title={tx("Аккаунт")}>
          <Row
            label={
              <AccountLabel
                avatar={<ProfileAvatar size={40} />}
                service={ownName || me?.username || yaName || tx('Ваш профиль')}
                stats={tx('Фото и имя видны только в Heddify')}
              />
            }
            control={
              <div className="settings-inline">
                <button className="btn btn-outline" onClick={pickAvatar}>
                  {ownAvatar ? tx('Сменить фото') : tx('Загрузить фото')}
                </button>
                {ownAvatar && (
                  <button className="btn btn-outline" onClick={removeAvatar}>
                    {tx('Убрать фото')}
                  </button>
                )}
                <button
                  className="btn btn-outline"
                  onClick={() =>
                    void askText(tx('Имя в Heddify'), ownName || me?.username || '', tx('Сохранить'), { placeholder: me?.username ?? '' }).then(
                      (v) => v !== null && setProfileName(v)
                    )
                  }
                >
                  {tx('Имя')}
                </button>
              </div>
            }
          />
          {!__WEB__ && (
            <>
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
                    avatar={
                      yaStatus === 'in' && yaAvatar ? (
                        <Artwork src={yaAvatar} size={40} round placeholder="person" />
                      ) : (
                        <div className="ya-mark round">Я</div>
                      )
                    }
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
                    avatar={<div className="ya-mark round vk">{tx('ВК')}</div>}
                    service={tx('ВКонтакте')}
                    stats={
                      vkStatus === 'in'
                        ? tx('Моя музыка · {0}', countLabel(vkTracks, tx('трек'), tx('трека'), tx('треков')))
                        : vkStatus === 'unknown'
                          ? tx('Подключаюсь…')
                          : tx('Не подключено')
                    }
                  />
                }
                control={
                  vkStatus === 'in' ? (
                    <div className="settings-inline">
                      <button className="btn btn-outline" onClick={() => openUrl(vkUid ? `https://vk.com/audios${vkUid}` : 'https://vk.com/audio')}>
                        {tx("Профиль")}
                      </button>
                      <button className="btn btn-outline" onClick={() => void logoutVk()}>{tx("Выйти")}</button>
                    </div>
                  ) : (
                    <div className="settings-inline">
                      <button className="btn btn-outline" onClick={() => void loginVk()}>{tx("Войти")}</button>
                    </div>
                  )
                }
              />
            </>
          )}
          {/* the website: these services live in the desktop app */}
          {__WEB__ && (
            <Row
              label={
                <AccountLabel
                  avatar={<Logo size={40} />}
                  service={tx('Heddify для Windows')}
                  stats={tx('SoundCloud, Яндекс Музыка, ВКонтакте, Discord и музыка без интернета')}
                />
              }
              control={<GetAppLink />}
            />
          )}
        </Section>

        <LookSection />

        </div>
        <div className="settings-col">
        <Section title={tx("Воспроизведение")}>
          {!__WEB__ && (
            <>
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
                label={tx('Подсветка баса в полном экране')}
                hint={tx('Весь экран светится в такт басу. Ноль — выключено')}
                control={
                  <div className="settings-slider">
                    <Slider
                      value={Math.round(bassGlow * 100)}
                      max={100}
                      label={tx('Подсветка баса в полном экране')}
                      onChange={(v) => {
                        setBassGlow(v / 100)
                        engine.setBassGlow(v / 100)
                      }}
                      onCommit={(v) => void window.sc.prefs.set({ bassGlow: v / 100 })}
                    />
                    <span className="settings-slider-value">{Math.round(bassGlow * 100)}%</span>
                  </div>
                }
              />
              <Row
                label={tx('Плавный переход между треками')}
                hint={tx('Звук плавно нарастает в начале трека и затихает в конце')}
                control={
                  <Switch
                    on={fade}
                    onToggle={() => {
                      setFade(!fade)
                      engine.setFade(!fade)
                      void window.sc.prefs.set({ crossfade: !fade })
                    }}
                    label={tx('Плавный переход между треками')}
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
            </>
          )}
          <Row
            label={tx("Автопродолжение")}
            hint={tx("Когда очередь закончится, играть похожие треки. Выключено по умолчанию")}
            control={<Switch on={autoplay} onToggle={player.toggleAutoplay} label={tx("Автопродолжение")} />}
          />
        </Section>

        {!__WEB__ && <CacheSection />}

        {!__WEB__ && (
          <Section title="Discord">
            <Row
              label={tx("Показывать в Discord, что я слушаю")}
              control={<Switch on={discordOn} onToggle={toggleDiscord} label="Discord Rich Presence" />}
            />
            {discordOn && (
              <p className={cx('settings-status', status === 'ready' && 'ok', status === 'bad-id' && 'bad')}>{discordText()[status]}</p>
            )}
          </Section>
        )}

        <Section title={tx('Что нового')}>
          <p className="settings-hint">{tx('Версия {0}', __APP_VERSION__)}</p>
          <ul className="whats-new">
            {whatsNew().map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
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
          {!__WEB__ && (
            <>
              <UpdateRow />
              <Row
                label={tx("Журнал ошибок")}
                control={
                  <button className="btn btn-outline" onClick={() => void window.sc.openLogs()}>{tx("Открыть папку")}</button>
                }
              />
            </>
          )}
        </Section>
        </div>
      </div>
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

/** Labels of the three custom colours (translated where shown). */
const CUSTOM_COLOR_LABEL = { bg: "Фон", text: "Текст", accent: "Акцент" } as const

/** The whole "Оформление" section: themes (built in and the user's own), the background, the accent. */
function LookSection(): React.JSX.Element {
  const theme = useTheme((s) => s.theme)
  const accent = useTheme((s) => s.accent)
  const custom = useTheme((s) => s.custom)
  const bg = useTheme((s) => s.bg)
  const look = useTheme((s) => s.look)
  const mine = useTheme((s) => s.userThemes)
  const wallpaper = useWallpaper((s) => s.url)
  const picture = useRef<HTMLInputElement>(null)
  const themeFile = useRef<HTMLInputElement>(null)

  const pickPicture = async (file: File | undefined): Promise<void> => {
    if (!file) return
    try {
      await setWallpaper(await prepareImage(file))
      setBg('image')
    } catch {
      toast(tx('Не получилось открыть картинку'))
    }
  }

  const saveTheme = async (): Promise<void> => {
    const name = await askText(tx('Сохранить как тему'), tx('Моя тема {0}', mine.length + 1), tx('Сохранить'), {
      text: tx('Сохранятся цвета и фон вместе с картинкой')
    })
    if (name?.trim()) await saveCurrentTheme(cleanName(name, tx('Тема')))
  }

  const customColors = anchorsOf(theme, custom) ?? custom

  return (
    <Section title={tx('Оформление')}>
      <div className="theme-grid" role="radiogroup" aria-label={tx('Тема')}>
        {THEMES.map((t) => (
          <ThemeCard
            key={t.id}
            label={tx(t.label)}
            colors={t.preview}
            accentColor={accent === 'mono' ? t.preview[3] : '#ff5500'}
            active={theme === t.id}
            onPick={() => setTheme(t.id)}
          />
        ))}
        {PALETTES.map((p) => {
          const v = derivePalette(p.colors)
          return (
            <ThemeCard
              key={p.id}
              label={tx(p.label)}
              colors={[v.bg, v.panel, v.raised, v.text]}
              accentColor={v.accent}
              active={theme === p.id}
              onPick={() => setTheme(p.id)}
            />
          )
        })}
        <ThemeCard
          label={tx('Своя')}
          colors={(() => {
            const v = derivePalette(custom)
            return [v.bg, v.panel, v.raised, v.text]
          })()}
          accentColor={custom.accent}
          active={theme === 'custom'}
          onPick={() => setTheme('custom')}
        />
        {mine.map((t) => (
          <UserThemeCard key={t.id} theme={t} active={theme === themeIdOf(t)} />
        ))}
      </div>
      <div className="settings-actions">
        <button className="btn btn-outline" onClick={() => void saveTheme()}>
          <Icon name="add" size={18} />
          {tx('Сохранить как тему')}
        </button>
        <button className="btn btn-outline" onClick={() => themeFile.current?.click()}>
          <Icon name="folder" size={18} />
          {tx('Загрузить тему…')}
        </button>
        <input
          ref={themeFile}
          type="file"
          accept=".heddify-theme,.json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importThemeFile(file)
          }}
        />
      </div>
      {(theme === 'custom' || isUserTheme(theme)) && (
        <Row
          label={tx("Свои цвета")}
          hint={isUserTheme(theme) ? tx('Новый цвет сделает из темы «Свою»') : undefined}
          control={
            <div className="chips">
              {(['bg', 'text', 'accent'] as const).map((k) => (
                <label key={k} className="color-pick">
                  <span>{tx(CUSTOM_COLOR_LABEL[k])}</span>
                  <input type="color" value={customColors[k]} onChange={(e) => setCustomColors({ [k]: e.target.value })} />
                </label>
              ))}
            </div>
          }
        />
      )}
      <Row
        label={tx('Фон')}
        hint={tx('Что видно за панелями')}
        control={
          <div className="chips" role="radiogroup" aria-label={tx('Фон')}>
            {(
              [
                ['plain', 'Без фона'],
                ['cover', 'Обложка трека'],
                ['image', 'Своя картинка']
              ] as [BgMode, string][]
            ).map(([id, label]) => (
              <button key={id} role="radio" aria-checked={bg === id} className={cx('chip', bg === id && 'on')} onClick={() => setBg(id)}>
                {tx(label)}
              </button>
            ))}
          </div>
        }
      />
      {bg === 'image' && (
        <>
          <Row
            label={
              <span className="settings-account">
                {wallpaper ? (
                  <img className="wall-thumb" src={wallpaper} alt="" width={64} height={40} />
                ) : (
                  <span className="wall-thumb empty" aria-hidden>
                    <Icon name="add" size={18} />
                  </span>
                )}
                <span className="settings-account-text">
                  <strong>{tx('Картинка')}</strong>
                  <span className="settings-hint block">{wallpaper ? tx('Хранится в приложении') : tx('PNG, JPG, WebP или GIF')}</span>
                </span>
              </span>
            }
            control={
              <div className="settings-inline">
                <button className="btn btn-outline" onClick={() => picture.current?.click()}>
                  {wallpaper ? tx('Другая…') : tx('Выбрать…')}
                </button>
                {wallpaper && (
                  <button className="btn btn-outline" onClick={() => void setWallpaper(null)}>
                    {tx('Убрать')}
                  </button>
                )}
              </div>
            }
          />
          <input
            ref={picture}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              void pickPicture(file)
            }}
          />
          {wallpaper &&
            LOOK_ROWS.map((r) => (
              <Row
                key={r.key}
                label={tx(r.label)}
                control={
                  <div className="look-slider">
                    <Slider
                      value={look[r.key]}
                      max={LOOK_LIMITS[r.key].max}
                      step={r.step}
                      label={tx(r.label)}
                      onChange={(v) => setLook({ [r.key]: v }, false)}
                      onCommit={(v) => setLook({ [r.key]: v })}
                    />
                    <span className="look-value">{r.show(look[r.key])}</span>
                  </div>
                }
              />
            ))}
        </>
      )}
      {!usesPalette(theme) && (
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
      )}
    </Section>
  )
}

const pct = (v: number): string => `${Math.round(v * 100)}%`

/** The picture's settings, in the order they are shown. */
const LOOK_ROWS: { key: keyof BgLook; label: string; step: number; show: (v: number) => string }[] = [
  { key: 'blur', label: 'Размытие', step: 1, show: (v) => `${Math.round(v)} px` },
  { key: 'dim', label: 'Затемнение', step: 0.05, show: pct },
  { key: 'saturate', label: 'Насыщенность', step: 0.05, show: pct },
  { key: 'clear', label: 'Прозрачность панелей', step: 0.05, show: pct }
]

/** One theme in the grid. */
function ThemeCard({
  label,
  colors,
  accentColor,
  active,
  image,
  onPick,
  onMenu
}: {
  label: string
  colors: [string, string, string, string]
  accentColor: string
  active: boolean
  image?: string | null
  onPick: () => void
  onMenu?: (at: { x: number; y: number }) => void
}): React.JSX.Element {
  return (
    <div className={cx('theme-card', active && 'on')}>
      <button
        role="radio"
        aria-checked={active}
        className="theme-pick"
        onClick={onPick}
        onContextMenu={
          onMenu
            ? (e) => {
                e.preventDefault()
                onMenu({ x: e.clientX, y: e.clientY })
              }
            : undefined
        }
      >
        <ThemePreview colors={colors} accentColor={accentColor} image={image} />
        <span className="theme-name ellipsis">{label}</span>
      </button>
      {onMenu && (
        <button
          className="icon-btn theme-more"
          aria-label={tx('Ещё: {0}', label)}
          title={tx('Ещё')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            onMenu({ x: r.left, y: r.bottom + 4 })
          }}
        >
          <Icon name="more" size={18} />
        </button>
      )}
    </div>
  )
}

/** A theme the user saved or loaded: its picture shows in the miniature; the menu shares or deletes it. */
function UserThemeCard({ theme, active }: { theme: UserTheme; active: boolean }): React.JSX.Element {
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    if (!theme.image) return
    let url: string | null = null
    let gone = false
    void getImage(themeImageKey(theme.id)).then((blob) => {
      if (!blob || gone) return
      url = URL.createObjectURL(blob)
      setImage(url)
    })
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [theme.id, theme.image])
  const v = derivePalette(theme.colors)
  return (
    <ThemeCard
      label={theme.name}
      colors={[v.bg, v.panel, v.raised, v.text]}
      accentColor={v.accent}
      active={active}
      image={theme.bg === 'image' ? image : null}
      onPick={() => void applyUserTheme(theme)}
      onMenu={(at) =>
        openMenu(at, [
          { label: tx('Сохранить в файл'), icon: 'download', onSelect: () => void exportUserTheme(theme) },
          { separator: true },
          {
            label: tx('Удалить тему'),
            icon: 'trash',
            danger: true,
            onSelect: () =>
              void askConfirm(tx('Удалить тему «{0}»?', theme.name), tx('Её цвета и картинка пропадут из приложения'), tx('Удалить'), true).then(
                (yes) => yes && void deleteUserTheme(theme)
              )
          }
        ])
      }
    />
  )
}

/** Miniature of the app (sidebar, list, player bar) drawn in a theme's colours, over its picture if it has one. */
function ThemePreview({ colors, accentColor, image }: { colors: [string, string, string, string]; accentColor: string; image?: string | null }): React.JSX.Element {
  const [bg, panel, raised, text] = colors
  const acc = accentColor
  // over a picture the panels let it through, as in the app
  const over = image ? 0.72 : 1
  return (
    <svg viewBox="0 0 160 100" className="theme-preview" aria-hidden>
      <rect width="160" height="100" fill={bg} />
      {image && <image href={image} width="160" height="100" preserveAspectRatio="xMidYMid slice" />}
      <rect x="4" y="4" width="40" height="78" rx="3" fill={panel} fillOpacity={over} />
      <rect x="48" y="4" width="108" height="78" rx="3" fill={panel} fillOpacity={over} />
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
