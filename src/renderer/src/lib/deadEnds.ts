/**
 * Some api-v2 routes answer 404 for some accounts on every start (/me/followings/ids,
 * /users/{id}/playlists_liked_and_owned) and only the fallback works. Remember that per account
 * and go straight to the fallback; try the main route again every few days in case it comes back.
 */
export const RETRY_AFTER_MS = 3 * 24 * 3600_000

/** `${userId}:${route}` → when the route last answered 404. */
export type DeadEnds = Record<string, number>

export interface DeadEndStore {
  read(): DeadEnds
  write(d: DeadEnds): void
}

export const isDead = (dead: DeadEnds, key: string, now: number): boolean => {
  const at = dead[key]
  return at !== undefined && now - at < RETRY_AFTER_MS
}

export function markDead(dead: DeadEnds, key: string, failed: boolean, now: number): DeadEnds {
  if (!failed && !(key in dead)) return dead
  const next = { ...dead }
  if (failed) next[key] = now
  else delete next[key]
  return next
}

const KEY = 'deadEnds'

const localStore: DeadEndStore = {
  read() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
      return d && typeof d === 'object' ? (d as DeadEnds) : {}
    } catch {
      return {}
    }
  },
  write(d) {
    try {
      localStorage.setItem(KEY, JSON.stringify(d))
    } catch {
      /* storage full or off: the next start just asks again */
    }
  }
}

const is404 = (e: unknown): boolean => (e as { status?: unknown } | null)?.status === 404

/** `main()`, or `fallback()` when it fails; a 404 is remembered, so the next starts skip `main` for a while. */
export async function withFallback<T>(
  key: string,
  main: () => Promise<T>,
  fallback: () => Promise<T>,
  store: DeadEndStore = localStore,
  now: () => number = Date.now
): Promise<T> {
  if (isDead(store.read(), key, now())) return fallback()
  let result: T
  try {
    result = await main()
  } catch (e) {
    if (is404(e)) store.write(markDead(store.read(), key, true, now()))
    return fallback()
  }
  const dead = store.read()
  if (key in dead) store.write(markDead(dead, key, false, now()))
  return result
}
