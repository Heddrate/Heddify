/**
 * Last loaded results of lists and shelves. Pages show them instantly and refresh in the
 * background (stale-while-revalidate). Keys starting with `p:` also survive restarts, so
 * the home page is filled the moment the app opens.
 */
const memo = new Map<string, unknown>()
const PREFIX = 'list-cache:'
/** Most recently used lists kept in memory; older ones fall back to localStorage (`p:`) or reload. */
const MAX_MEMO = 120

function remember(key: string, value: unknown): void {
  memo.delete(key)
  memo.set(key, value)
  while (memo.size > MAX_MEMO) memo.delete(memo.keys().next().value as string)
}

export function readCache<T>(key: string | null | undefined): T | undefined {
  if (!key) return undefined
  if (memo.has(key)) {
    const value = memo.get(key) as T
    remember(key, value)
    return value
  }
  if (!key.startsWith('p:')) return undefined
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return undefined
    const value = JSON.parse(raw) as T
    remember(key, value)
    return value
  } catch {
    return undefined
  }
}

export function writeCache(key: string | null | undefined, value: unknown): void {
  if (!key) return
  remember(key, value)
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
