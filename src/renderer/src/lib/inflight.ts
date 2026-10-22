/**
 * Runs `fn` once per key while its promise is pending: whoever asks for the same key meanwhile
 * gets that same promise (play pressed again while a Yandex stand-in is still searched for).
 * Once it settles the key is free again.
 */
export function shareInFlight<K, V>(pending: Map<K, Promise<V>>, key: K, fn: () => Promise<V>): Promise<V> {
  const running = pending.get(key)
  if (running) return running
  const p = fn().finally(() => {
    if (pending.get(key) === p) pending.delete(key)
  })
  pending.set(key, p)
  return p
}
