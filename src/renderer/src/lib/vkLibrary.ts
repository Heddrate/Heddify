/**
 * VK inside our UI: the account and the user's own tracks ("Моя музыка"), which show up in
 * "Мне нравится" next to the other services' likes. Read from the hidden vk.com page (lib/vk.ts).
 */
import { create } from 'zustand'
import { tx } from './i18n'
import type { Track } from './types'
import { readVkMine, reloadVkView, runInPage, setVkOwned, SIGNED_IN } from './vk'
import { stampAdded } from './vkModel'
import { useApp } from '@/store/app'
import { toast } from '@/store/ui'

interface VkState {
  status: 'unknown' | 'out' | 'in'
  uid: number | null
  /** The user's VK tracks, newest first. */
  mine: Track[]
  /** Their keys, for the hearts. */
  mineKeys: Set<string>
  /** When each track was added, as far as we know (VK shows no dates; see stampAdded). */
  added: Record<string, number>
}

/* Remembered between launches, so the tracks show up at once while the hidden page loads. */
const SAVED_KEY = 'vk-state'

interface Saved {
  uid: number
  mine: Track[]
  added: Record<string, number>
}

function readSaved(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as Saved | null
    return s && typeof s.uid === 'number' && Array.isArray(s.mine) ? s : null
  } catch {
    return null
  }
}

const keysOf = (list: Track[]): Set<string> => new Set(list.map((t) => t.vk?.key ?? ''))

const saved = readSaved()

export const useVk = create<VkState>(() =>
  saved
    ? { status: 'in', uid: saved.uid, mine: saved.mine, mineKeys: keysOf(saved.mine), added: saved.added ?? {} }
    : { status: 'out', uid: null, mine: [], mineKeys: new Set(), added: {} }
)

useVk.subscribe((s, prev) => {
  if (s.status === prev.status && s.mine === prev.mine && s.added === prev.added) return
  try {
    if (s.status === 'in' && s.uid) localStorage.setItem(SAVED_KEY, JSON.stringify({ uid: s.uid, mine: s.mine, added: s.added } satisfies Saved))
    else if (s.status === 'out') localStorage.removeItem(SAVED_KEY)
  } catch {
    /* storage full or unavailable: just no instant start */
  }
})

function setMine(mine: Track[], added: Record<string, number>): void {
  useVk.setState({ mine, mineKeys: keysOf(mine), added })
}

/** Who is signed in on the VK page, then their tracks. */
export async function loadVk(): Promise<void> {
  try {
    const uid = await runInPage<number>(SIGNED_IN)
    if (!uid) {
      useVk.setState({ status: 'out', uid: null, mine: [], mineKeys: new Set(), added: {} })
      return
    }
    useVk.setState({ status: 'in', uid })
    void loadVkMine()
  } catch {
    // the page can't be reached right now: a known account stays connected
    useVk.setState({ status: useVk.getState().uid ? 'in' : 'out' })
  }
}

let loadingMine: Promise<void> | null = null

export function loadVkMine(): Promise<void> {
  const uid = useVk.getState().uid
  if (!uid) return Promise.resolve()
  loadingMine ??= (async () => {
    try {
      const list = await readVkMine(uid)
      if (list) setMine(list, stampAdded(list.map((t) => t.vk!.key), useVk.getState().added))
    } catch {
      /* the remembered list stays */
    } finally {
      loadingMine = null
    }
  })()
  return loadingMine
}

/** Sign-in window; on success the hidden page reloads signed in. */
export async function loginVk(): Promise<void> {
  if (!useApp.getState().vkMounted) useApp.setState({ vkMounted: true })
  useVk.setState({ status: 'unknown' })
  const ok = await window.sc.vk.login()
  if (ok) await reloadVkView().catch(() => undefined)
  // give the page a moment to come up with the new session
  setTimeout(() => void loadVk(), ok ? 2500 : 0)
}

export async function logoutVk(): Promise<void> {
  await window.sc.vk.logout()
  useVk.setState({ status: 'out', uid: null, mine: [], mineKeys: new Set(), added: {} })
  // nothing left for the page to do
  useApp.setState({ vkMounted: false })
}

/** The heart on a VK track: adds it to the user's VK music or takes it out. */
export async function toggleVkMine(track: Track): Promise<void> {
  const key = track.vk?.key
  if (!key) return
  if (useVk.getState().status !== 'in') {
    toast(tx('Войдите во ВКонтакте в настройках'))
    return
  }
  const before = useVk.getState()
  const has = before.mineKeys.has(key)
  // the heart changes at once; it goes back if VK refuses
  if (has)
    setMine(
      before.mine.filter((t) => t.vk?.key !== key),
      before.added
    )
  else setMine([track, ...before.mine], { ...before.added, [key]: Date.now() })
  const ok = await setVkOwned(track, !has).catch(() => false)
  if (!ok) {
    setMine(before.mine, before.added)
    toast(tx('ВКонтакте не дал изменить «Мою музыку»'))
  }
}

// Bring the VK page up when the app opens, only for users who connected VK before.
useApp.subscribe((s, prev) => {
  const entered = (s.auth === 'in' || s.auth === 'guest') && prev.auth !== s.auth
  if (!entered || !readSaved()) return
  if (!useApp.getState().vkMounted) useApp.setState({ vkMounted: true })
  setTimeout(() => void loadVk(), 2500)
})
