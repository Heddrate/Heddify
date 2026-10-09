/**
 * Minimal Discord Rich Presence client over Discord's local IPC pipe
 * (\\?\pipe\discord-ipc-N). Shows "Слушает <app name>" with track, artist,
 * artwork, progress and a link to the track.
 */
import net from 'node:net'
import { randomUUID } from 'node:crypto'
import type { DiscordStatus, Presence } from '../shared/ipc'

/** Application registered by the user in the Discord Developer Portal. */
export const DEFAULT_DISCORD_APP_ID = '1557715252651495475'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

const RETRY_MS = 15_000
/** Discord accepts ~5 activity updates per 20 s. */
const MIN_GAP_MS = 4_000

const pipe = (i: number): string => `\\\\?\\pipe\\discord-ipc-${i}`

const clip = (s: string, max = 128): string => {
  const t = s.trim()
  if (t.length < 2) return (t + '  ').slice(0, 2)
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

class DiscordPresence {
  private sock: net.Socket | null = null
  private clientId: string | null = null
  private ready = false
  private connecting = false
  private buf = Buffer.alloc(0)
  private retry: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private lastSent = 0
  /** latest wanted activity; undefined = nothing new to send */
  private wanted: Presence | null | undefined = undefined
  /** what Discord was last told, re-sent after Discord restarts */
  private shown: Presence | null = null
  private state: DiscordStatus = 'off'
  onStatus: ((s: DiscordStatus) => void) | null = null
  onError: ((message: string) => void) | null = null

  get status(): DiscordStatus {
    return this.state
  }

  configure(clientId: string | null): void {
    if (clientId === this.clientId) return
    this.close()
    this.clientId = clientId
    if (clientId) void this.connect()
    else this.setStatus('off')
  }

  /** null clears the activity (paused / stopped). */
  update(p: Presence | null): void {
    this.wanted = p
    this.scheduleFlush()
  }

  close(): void {
    if (this.retry) clearTimeout(this.retry)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.retry = null
    this.flushTimer = null
    this.ready = false
    const s = this.sock
    this.sock = null
    s?.destroy()
  }

  private setStatus(s: DiscordStatus): void {
    if (this.state === s) return
    this.state = s
    this.onStatus?.(s)
  }

  private scheduleRetry(): void {
    if (this.retry || !this.clientId) return
    this.retry = setTimeout(() => {
      this.retry = null
      void this.connect()
    }, RETRY_MS)
  }

  private tryPipe(i: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection(pipe(i))
      s.once('connect', () => {
        s.removeAllListeners('error')
        resolve(s)
      })
      s.once('error', reject)
    })
  }

  private async connect(): Promise<void> {
    if (!this.clientId || this.sock || this.connecting) return
    this.connecting = true
    this.setStatus('connecting')
    let sock: net.Socket | null = null
    for (let i = 0; i < 10 && !sock; i++) {
      sock = await this.tryPipe(i).catch(() => null)
    }
    this.connecting = false

    if (!sock) {
      this.setStatus('no-discord')
      this.scheduleRetry()
      return
    }
    if (!this.clientId) {
      sock.destroy()
      return
    }

    this.sock = sock
    this.buf = Buffer.alloc(0)
    sock.on('data', (d: Buffer) => this.onData(d))
    sock.on('error', () => sock?.destroy())
    sock.on('close', () => {
      if (this.sock !== sock) return
      this.sock = null
      this.ready = false
      if (this.state !== 'bad-id') {
        this.setStatus('no-discord')
        this.scheduleRetry()
      }
    })
    this.send(OP_HANDSHAKE, { v: 1, client_id: this.clientId })
  }

  private send(op: number, payload: unknown): void {
    if (!this.sock) return
    const data = Buffer.from(JSON.stringify(payload), 'utf8')
    const header = Buffer.alloc(8)
    header.writeInt32LE(op, 0)
    header.writeInt32LE(data.length, 4)
    this.sock.write(Buffer.concat([header, data]))
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk])
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0)
      const len = this.buf.readInt32LE(4)
      if (this.buf.length < 8 + len) break
      let msg: { evt?: string; cmd?: string; code?: number; message?: string; data?: { message?: string } } = {}
      try {
        msg = JSON.parse(this.buf.subarray(8, 8 + len).toString('utf8'))
      } catch {
        /* ignore malformed frame */
      }
      this.buf = this.buf.subarray(8 + len)
      this.handle(op, msg)
    }
  }

  private handle(op: number, msg: { evt?: string; code?: number; message?: string; data?: { code?: number; message?: string } }): void {
    if (op === OP_FRAME && msg.evt === 'ERROR') {
      this.onError?.(`${msg.data?.code ?? ''} ${msg.data?.message ?? 'unknown error'}`.trim())
      return
    }
    if (op === OP_PING) {
      this.send(OP_PONG, msg)
    } else if (op === OP_CLOSE) {
      // 4000 = invalid client id: don't hammer Discord until the id changes
      if (msg.code === 4000) {
        this.setStatus('bad-id')
        this.close()
      } else {
        this.onError?.(`closed: ${msg.code ?? ''} ${msg.message ?? ''}`.trim())
      }
    } else if (op === OP_FRAME && msg.evt === 'READY') {
      this.ready = true
      this.setStatus('ready')
      if (this.wanted === undefined) this.wanted = this.shown
      if (this.wanted === null) {
        this.wanted = undefined
        return
      }
      this.lastSent = 0
      this.scheduleFlush()
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    const wait = Math.max(0, this.lastSent + MIN_GAP_MS - Date.now())
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, wait)
  }

  private flush(): void {
    if (!this.ready || this.wanted === undefined) return
    const p = this.wanted
    this.wanted = undefined
    this.shown = p
    this.lastSent = Date.now()
    this.send(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: p ? activity(p) : null },
      nonce: randomUUID()
    })
  }
}

function activity(p: Presence): Record<string, unknown> {
  const a: Record<string, unknown> = {
    type: 2, // "Listening to"
    details: clip(p.title),
    state: clip(p.artist || 'Heddify'),
    instance: false
  }
  if (p.startedAt && p.endsAt && p.endsAt > p.startedAt) {
    a.timestamps = { start: Math.round(p.startedAt), end: Math.round(p.endsAt) }
  }
  const assets: Record<string, string> = {}
  if (p.artwork?.startsWith('https://') && p.artwork.length <= 256) assets.large_image = p.artwork
  if (p.album) assets.large_text = clip(p.album)
  if (Object.keys(assets).length) a.assets = assets
  if (p.url?.startsWith('https://')) a.buttons = [{ label: clip(p.buttonLabel ?? 'SoundCloud', 32), url: p.url }]
  return a
}

export const discord = new DiscordPresence()
