/**
 * Keeps the "Продолжить" shelf on Home up to date: each time a playlist, the wave or radio
 * plays a new track, that context moves to the front. Saved in localStorage — it's only a
 * convenience, the shelf simply starts empty without it.
 */
import { create } from 'zustand'
import { slim, usePlayer } from '@/store/player'
import { CONTINUE_MAX, CONTINUE_ROUTES, pushContinue, type ContinueItem } from './continueList'

const KEY = 'continueList'

function read(): ContinueItem[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as ContinueItem[]
    return Array.isArray(list) ? list.filter((c) => c?.route?.name && typeof c.at === 'number').slice(0, CONTINUE_MAX) : []
  } catch {
    return []
  }
}

export const useContinue = create<{ items: ContinueItem[] }>(() => ({ items: read() }))

usePlayer.subscribe((s, prev) => {
  const route = s.source?.route
  if (!s.current || !route || !CONTINUE_ROUTES.includes(route.name)) return
  if (s.current === prev.current && s.source === prev.source) return
  const items = pushContinue(useContinue.getState().items, {
    route,
    label: s.source!.label,
    at: Date.now(),
    // a station keeps its stream address (slim() drops it), so it can play from the shelf
    track: route.name === 'radio' ? s.current : slim(s.current)
  })
  useContinue.setState({ items })
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* storage full: the shelf just isn't kept */
  }
})
