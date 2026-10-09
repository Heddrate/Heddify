import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface Bounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

interface State {
  token?: string
  tokenEncrypted?: boolean
  clientId?: string
  appVersion?: string
  prefs?: Record<string, unknown>
  bounds?: Bounds
}

let state: State | null = null

const file = (): string => path.join(app.getPath('userData'), 'state.json')

function load(): State {
  if (state) return state
  try {
    state = JSON.parse(fs.readFileSync(file(), 'utf8')) as State
  } catch {
    state = {}
  }
  return state
}

function save(): void {
  const target = file()
  const tmp = target + '.tmp'
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(load(), null, 2))
  fs.renameSync(tmp, target)
}

export const store = {
  getToken(): string | null {
    const s = load()
    if (!s.token) return null
    if (!s.tokenEncrypted) return s.token
    try {
      return safeStorage.decryptString(Buffer.from(s.token, 'base64'))
    } catch {
      return null
    }
  },

  setToken(token: string | null): void {
    const s = load()
    if (!token) {
      delete s.token
      delete s.tokenEncrypted
    } else if (safeStorage.isEncryptionAvailable()) {
      s.token = safeStorage.encryptString(token).toString('base64')
      s.tokenEncrypted = true
    } else {
      s.token = token
      s.tokenEncrypted = false
    }
    save()
  },

  getClient(): { clientId?: string; appVersion?: string } {
    const s = load()
    return { clientId: s.clientId, appVersion: s.appVersion }
  },

  setClient(clientId: string, appVersion?: string): void {
    const s = load()
    if (s.clientId === clientId && (!appVersion || s.appVersion === appVersion)) return
    s.clientId = clientId
    if (appVersion) s.appVersion = appVersion
    save()
  },

  getPrefs(): Record<string, unknown> {
    return load().prefs ?? {}
  },

  setPrefs(patch: Record<string, unknown>): void {
    const s = load()
    s.prefs = { ...(s.prefs ?? {}), ...patch }
    save()
  },

  getBounds(): Bounds | undefined {
    return load().bounds
  },

  setBounds(bounds: Bounds): void {
    load().bounds = bounds
    save()
  }
}
