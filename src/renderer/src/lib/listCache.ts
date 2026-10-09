/**
 * Last loaded results of lists and shelves. Pages show them instantly and refresh in the
 * background (stale-while-revalidate). Keys starting with `p:` also survive restarts, so
 * the home page is filled the moment the app opens.
 */
const memo = new Map<string, unknown>()
const PREFIX = 'list-cache:'

export function readCache<T>(key: string | null | undefined): T | undefined {
  if (!key) return undefined
  if (memo.has(key)) return memo.get(key) as T
  if (!key.startsWith('p:')) return undefined
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return undefined
    const value = JSON.parse(raw) as T
    memo.set(key, value)
    return value
  } catch {
    return undefined
  }
}

export function writeCache(key: string | null | undefined, value: unknown): void {
  if (!key) return
  memo.set(key, value)
  if (!key.startsWith('p:')) return
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* over quota: memory only */
  }
}

/** Drop everything (sign-out / account switch). */
export function clearListCache(): void {
  memo.clear()
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k)
  } catch {
    /* nothing to clear */
  }
}
