/**
 * Feeds Discord Rich Presence from the player (SoundCloud and Yandex tracks alike):
 * track change, play/pause and seeks update it; pausing clears it (like Spotify does).
 * Rate limiting lives in main.
 */
import { trackArt } from './artwork'
import { usePlayer } from '@/store/player'
import { tx } from '@/lib/i18n'

let shownKey = ''

usePlayer.subscribe((s, prev) => {
  const t = s.current
  if (!t || !s.playing) {
    if (shownKey !== 'none') {
      shownKey = 'none'
      window.sc.discord.update(null)
    }
    return
  }

  const duration = s.duration || (t.duration ?? 0) / 1000
  const key = `${t.id}:${Math.round(duration)}`
  const seeked = prev.current?.id === t.id && Math.abs(s.position - prev.position) > 3
  if (key === shownKey && !seeked) return
  shownKey = key

  const yandex = t.origin === 'yandex'
  const startedAt = Date.now() - s.position * 1000
  window.sc.discord.update({
    title: t.title ?? tx("Без названия"),
    artist: t.user?.username ?? '',
    artwork: trackArt(t, 't500x500'),
    url: t.permalink_url,
    buttonLabel: yandex ? tx("Открыть в Яндекс Музыке") : t.origin === 'audius' ? tx('Слушать на Audius') : tx("Слушать на SoundCloud"),
    startedAt,
    endsAt: duration > 0 ? startedAt + duration * 1000 : undefined
  })
})
