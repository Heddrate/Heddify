/** Sleep timer: pause after N minutes or at the end of the current track. */
import { create } from 'zustand'
import { tx } from './i18n'
import { player, usePlayer } from '@/store/player'
import { toast, type MenuItem } from '@/store/ui'

interface SleepState {
  /** Epoch ms when playback stops, or null. */
  endsAt: number | null
  endOfTrack: boolean
}

export const useSleep = create<SleepState>(() => ({ endsAt: null, endOfTrack: false }))

let timer: number | undefined

function stop(): void {
  window.clearTimeout(timer)
  useSleep.setState({ endsAt: null, endOfTrack: false })
}

function fire(): void {
  stop()
  if (usePlayer.getState().playing) player.toggle()
  toast(tx('Таймер сна: пауза'))
}

export function setSleep(minutes: number | 'track' | null): void {
  stop()
  if (minutes === null) {
    toast(tx('Таймер сна выключен'))
    return
  }
  if (minutes === 'track') {
    useSleep.setState({ endOfTrack: true })
    toast(tx('Пауза после этого трека'))
    return
  }
  const endsAt = Date.now() + minutes * 60_000
  useSleep.setState({ endsAt })
  timer = window.setTimeout(fire, minutes * 60_000)
  toast(tx('Пауза через {0} мин', minutes))
}

// "until the end of the track": stop as soon as the player moves on
usePlayer.subscribe((s, prev) => {
  if (useSleep.getState().endOfTrack && prev.current && s.current?.id !== prev.current.id) fire()
})

export function sleepMenu(): MenuItem[] {
  const { endsAt, endOfTrack } = useSleep.getState()
  const active = endsAt !== null || endOfTrack
  return [
    ...[15, 30, 45, 60, 90].map((m) => ({ label: tx('{0} мин', m), onSelect: () => setSleep(m) })),
    { label: tx('До конца трека'), onSelect: () => setSleep('track') },
    ...(active ? [{ separator: true } as const, { label: tx('Выключить таймер'), icon: 'close' as const, onSelect: () => setSleep(null) }] : [])
  ]
}

/** "23 мин" left, "этот трек", or null when off. */
export function sleepLabel(s: SleepState, now = Date.now()): string | null {
  if (s.endOfTrack) return tx('после этого трека')
  if (s.endsAt === null) return null
  return tx('{0} мин', Math.max(1, Math.ceil((s.endsAt - now) / 60_000)))
}
