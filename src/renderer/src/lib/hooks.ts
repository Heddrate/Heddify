import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { Collection } from './types'
import { tx } from '@/lib/i18n'
import { readCache, writeCache } from './listCache'

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')

export interface Async<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * Runs an async loader when deps change. With a cacheKey the last result shows instantly
 * and is refreshed in the background (see listCache.ts); a failed refresh keeps it.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], cacheKey?: string | null): Async<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>(() => ({
    data: readCache<T>(cacheKey) ?? null,
    error: null,
    loading: true
  }))
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setState((s) => ({ data: readCache<T>(cacheKey) ?? s.data, error: null, loading: true }))
    fn().then(
      (data) => {
        writeCache(cacheKey, data)
        if (alive) setState({ data, error: null, loading: false })
      },
      (e: unknown) => {
        if (!alive) return
        const kept = readCache<T>(cacheKey)
        setState({ data: kept ?? null, error: kept ? null : e instanceof Error ? e.message : tx("Ошибка"), loading: false })
      }
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, cacheKey, tick])

  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) }
}

interface Paged<T> {
  items: T[]
  next: string | null
  loading: boolean
  error: string | null
  loadMore: () => void
  reload: () => void
}

/**
 * Infinite list over api-v2 `next_href` pagination. Pass `key = null` to stay idle.
 * The first page is cached under the key (`p:` keys survive restarts, see listCache.ts).
 */
export function usePaged<T>(key: string | null, first: () => Promise<Collection<T>>): Paged<T> {
  const [items, setItems] = useState<T[]>(() => readCache<Collection<T>>(key)?.collection ?? [])
  const [next, setNext] = useState<string | null>(() => readCache<Collection<T>>(key)?.next_href ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const gen = useRef(0)
  const busy = useRef(false)
  const firstRef = useRef(first)
  firstRef.current = first

  useEffect(() => {
    if (key === null) return
    const g = ++gen.current
    const cached = readCache<Collection<T>>(key)
    setItems(cached?.collection ?? [])
    setNext(cached?.next_href ?? null)
    setError(null)
    setLoading(true)
    busy.current = true
    firstRef.current().then(
      (page) => {
        writeCache(key, { collection: page.collection ?? [], next_href: page.next_href ?? null })
        if (g !== gen.current) return
        setItems(page.collection ?? [])
        setNext(page.next_href ?? null)
        setLoading(false)
        busy.current = false
      },
      (e: unknown) => {
        if (g !== gen.current) return
        if (!cached) setError(e instanceof Error ? e.message : tx("Ошибка"))
        setLoading(false)
        busy.current = false
      }
    )
  }, [key, tick])

  const loadMore = useCallback(() => {
    if (!next || busy.current) return
    const g = gen.current
    busy.current = true
    setLoading(true)
    api.page<T>(next).then(
      (page) => {
        if (g !== gen.current) return
        setItems((prev) => [...prev, ...(page.collection ?? [])])
        setNext(page.next_href ?? null)
        setLoading(false)
        busy.current = false
      },
      () => {
        if (g !== gen.current) return
        setLoading(false)
        busy.current = false
      }
    )
  }, [next])

  return { items, next, loading, error, loadMore, reload: useCallback(() => setTick((t) => t + 1), []) }
}

/** How many fixed-min-width columns fit into an element. Returns a callback ref. */
export function useColumns(min = 176, gap = 16): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [cols, setCols] = useState(5)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      setCols(Math.max(2, Math.floor((w + gap) / (min + gap))))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, min, gap])
  return [setEl, cols]
}
