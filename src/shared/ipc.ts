export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type ApiResult<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; auth?: boolean; /** refused by SoundCloud's anti-bot */ blocked?: boolean }

export interface ApiOptions {
  /** Background request: never pop up a captcha window for it. */
  quiet?: boolean
}

export interface StreamRequest {
  id: number
  track_authorization?: string
  media?: { transcodings?: Transcoding[] }
  /** Audius track id: the stream comes from Audius instead of SoundCloud. */
  audius?: string
  /** Skip (and drop) the cached copy — it failed to play. */
  fresh?: boolean
  /** The track itself (slimmed), kept with the cached file for the offline list. */
  meta?: unknown
}

export interface Transcoding {
  url: string
  preset: string
  snipped: boolean
  quality?: string
  format: { protocol: string; mime_type: string }
}

export interface StreamInfo {
  url: string
  protocol: 'progressive' | 'hls'
  mime: string
  snipped: boolean
  /** Plays from the local audio cache. */
  cached?: boolean
}

export interface CacheStats {
  bytes: number
  count: number
  /** Downloaded on purpose; never evicted, outside the limit. */
  pinnedBytes: number
  pinnedCount: number
  limitMb: number
  enabled: boolean
}

export interface CachedTrack {
  key: string
  meta: unknown
  pinned: boolean
  size: number
}

export interface DownloadProgress {
  done: number
  total: number
  failed: number
}

export interface AuthStatus {
  loggedIn: boolean
}

export type Prefs = Record<string, unknown>

/** What Discord shows as "Слушает …". Times are epoch milliseconds. */
export interface Presence {
  title: string
  artist: string
  album?: string
  artwork?: string | null
  url?: string
  /** Text of the link button under the status. */
  buttonLabel?: string
  startedAt?: number
  endsAt?: number
}

/** A music file from the user's own folders (main/local.ts). */
export interface LocalTrack {
  key: string
  title: string
  artist: string
  album: string
  /** ms; 0 when the file doesn't say */
  duration: number
  hasCover: boolean
  addedAt: number
}

export interface LocalScan {
  total: number
  added: number
  removed: number
}

/** Self-update: 'unsupported' = portable exe / zip / development, they don't update themselves. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'error' | 'unsupported'
  version?: string
  percent?: number
  /** "What's new": short lines from the GitHub release description. */
  notes?: string[]
}

export type DiscordStatus = 'off' | 'connecting' | 'ready' | 'no-discord' | 'bad-id'

export interface ScBridge {
  platform: string
  auth: {
    status(): Promise<AuthStatus>
    login(): Promise<{ ok: boolean; error?: string }>
    cancelLogin(): Promise<void>
    setToken(token: string): Promise<{ ok: boolean; error?: string }>
    logout(): Promise<void>
  }
  api<T = unknown>(
    method: ApiMethod,
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    body?: unknown,
    opts?: ApiOptions
  ): Promise<ApiResult<T>>
  resolveStream(track: StreamRequest): Promise<ApiResult<StreamInfo>>
  prefs: {
    get(): Promise<Prefs>
    set(patch: Prefs): Promise<void>
  }
  openExternal(url: string): Promise<void>
  copyText(text: string): Promise<void>
  openLogs(): Promise<void>
  cache: {
    stats(): Promise<CacheStats>
    clear(): Promise<void>
    list(): Promise<CachedTrack[]>
    /** Download for offline listening (pinned). */
    download(reqs: StreamRequest[]): Promise<void>
    unpin(keys: string[]): Promise<void>
    onProgress(cb: (p: DownloadProgress) => void): () => void
  }
  /** Colours of the native window frame (title bar buttons). */
  setWindowTheme(colors: { bg: string; symbol: string }): void
  /** Headers the Yandex Music site uses for its own API (see main/index.ts). */
  yandex: {
    headers(): Promise<Record<string, string>>
    onHeaders(cb: (h: Record<string, string>) => void): () => void
    /** Opens the Yandex sign-in window; true once signed in. */
    login(): Promise<boolean>
    logout(): Promise<void>
  }
  /** Taskbar thumbnail buttons mirror the player and send commands back. */
  playerState(s: { playing: boolean; hasTrack: boolean; title?: string }): void
  onPlayerCommand(cb: (cmd: 'prev' | 'toggle' | 'next' | 'play' | 'pause') => void): () => void
  local: {
    folders(): Promise<string[]>
    /** Folder picker; the chosen folder is remembered (null = cancelled). */
    addFolder(): Promise<string | null>
    removeFolder(dir: string): Promise<void>
    tracks(): Promise<LocalTrack[]>
    scan(): Promise<LocalScan>
    onProgress(cb: (p: { done: number; total: number }) => void): () => void
  }
  update: {
    state(): Promise<UpdateState>
    check(): Promise<void>
    /** Restarts into the downloaded version. */
    install(): Promise<void>
    onState(cb: (s: UpdateState) => void): () => void
  }
  discord: {
    update(p: Presence | null): void
    status(): Promise<DiscordStatus>
    onStatus(cb: (s: DiscordStatus) => void): () => void
  }
}
