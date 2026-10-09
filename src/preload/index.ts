import { contextBridge, ipcRenderer } from 'electron'
import type { DiscordStatus, DownloadProgress, ScBridge, UpdateState } from '../shared/ipc'

const bridge: ScBridge = {
  platform: process.platform,
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    login: () => ipcRenderer.invoke('auth:login'),
    cancelLogin: () => ipcRenderer.invoke('auth:cancel'),
    setToken: (token) => ipcRenderer.invoke('auth:setToken', token),
    logout: () => ipcRenderer.invoke('auth:logout')
  },
  api: (method, path, params, body, opts) => ipcRenderer.invoke('api', method, path, params, body, opts),
  resolveStream: (track) => ipcRenderer.invoke('stream:resolve', track),
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch)
  },
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  cache: {
    stats: () => ipcRenderer.invoke('cache:stats'),
    clear: () => ipcRenderer.invoke('cache:clear'),
    list: () => ipcRenderer.invoke('cache:list'),
    download: (reqs) => ipcRenderer.invoke('cache:download', reqs),
    unpin: (keys) => ipcRenderer.invoke('cache:unpin', keys),
    onProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, p: DownloadProgress): void => cb(p)
      ipcRenderer.on('cache:progress', listener)
      return () => ipcRenderer.removeListener('cache:progress', listener)
    }
  },
  setWindowTheme: (colors) => ipcRenderer.send('window:theme', colors),
  yandex: {
    headers: () => ipcRenderer.invoke('ya:headers'),
    onHeaders: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, h: Record<string, string>): void => cb(h)
      ipcRenderer.on('ya:headers', listener)
      return () => ipcRenderer.removeListener('ya:headers', listener)
    },
    login: () => ipcRenderer.invoke('ya:login'),
    logout: () => ipcRenderer.invoke('ya:logout')
  },
  playerState: (s) => ipcRenderer.send('player:state', s),
  onPlayerCommand: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, cmd: 'prev' | 'toggle' | 'next' | 'play' | 'pause'): void => cb(cmd)
    ipcRenderer.on('player:command', listener)
    return () => ipcRenderer.removeListener('player:command', listener)
  },
  local: {
    folders: () => ipcRenderer.invoke('local:folders'),
    addFolder: () => ipcRenderer.invoke('local:addFolder'),
    removeFolder: (dir) => ipcRenderer.invoke('local:removeFolder', dir),
    tracks: () => ipcRenderer.invoke('local:tracks'),
    scan: () => ipcRenderer.invoke('local:scan'),
    onProgress: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, p: { done: number; total: number }): void => cb(p)
      ipcRenderer.on('local:progress', listener)
      return () => ipcRenderer.removeListener('local:progress', listener)
    }
  },
  update: {
    state: () => ipcRenderer.invoke('update:get'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onState: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, s: UpdateState): void => cb(s)
      ipcRenderer.on('update:state', listener)
      return () => ipcRenderer.removeListener('update:state', listener)
    }
  },
  discord: {
    update: (p) => ipcRenderer.send('discord:update', p),
    status: () => ipcRenderer.invoke('discord:status'),
    onStatus: (cb) => {
      const listener = (_e: Electron.IpcRendererEvent, s: DiscordStatus): void => cb(s)
      ipcRenderer.on('discord:status', listener)
      return () => ipcRenderer.removeListener('discord:status', listener)
    }
  }
}

contextBridge.exposeInMainWorld('sc', bridge)
