/**
 * Audius (audius.co): open music catalogue with a public API — no account, key or VPN.
 * Lists and search are fetched by the renderer; main only hands out stream URLs so they
 * go through the same audio cache as SoundCloud tracks.
 */
import { net } from 'electron'
import type { ApiResult, StreamInfo } from '../shared/ipc'

export const AUDIUS_APP = 'SCPlayer'
const DISCOVERY = 'https://api.audius.co'

let host: string | null = null
let hostAt = 0

/** One of the API nodes Audius recommends right now (refreshed hourly). */
export async function audiusHost(reroll = false): Promise<string> {
  if (host && !reroll && Date.now() - hostAt < 3600_000) return host
  try {
    const r = await net.fetch(DISCOVERY)
    const j = (await r.json()) as { data?: string[] }
    const list = (j.data ?? []).filter((h) => /^https:\/\//.test(h))
    host = list[Math.floor(Math.random() * list.length)] ?? DISCOVERY
  } catch {
    host = DISCOVERY
  }
  hostAt = Date.now()
  return host
}

/** `retry`: the last stream failed mid-way — ask a different API node this time. */
export async function resolveAudius(id: string, retry = false): Promise<ApiResult<StreamInfo>> {
  if (!/^[A-Za-z0-9]+$/.test(id)) return { ok: false, status: 400, error: 'bad id' }
  const base = await audiusHost(retry)
  return {
    ok: true,
    status: 200,
    data: {
      url: `${base}/v1/tracks/${id}/stream?app_name=${AUDIUS_APP}`,
      protocol: 'progressive',
      mime: 'audio/mpeg',
      snipped: false
    }
  }
}
