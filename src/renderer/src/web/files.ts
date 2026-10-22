/**
 * The visitor's own music on the website: a folder picked in the browser. The files play
 * straight from the computer (object URLs), nothing is uploaded; the list lasts while the
 * tab is open (a browser gives a site no lasting access to a folder without asking every time).
 * Titles come from the file names ("Artist - Title.mp3").
 */
import type { LocalScan, LocalTrack, ScBridge } from '../../../shared/ipc'

const AUDIO = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm)$/i

interface Picked {
  folder: string
  file: File
  track: LocalTrack
}

const files = new Map<string, Picked>()
const urls = new Map<string, string>()
let lastAdded = 0

/** A hex key from the file's place, size and date: the same file keeps its id (lib/local.ts reads it as hex). */
function keyOf(path: string, f: File): string {
  const s = `${path}|${f.size}|${f.lastModified}`
  let a = 0x811c9dc5
  let b = 7
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193)
    b = Math.imul(b, 31) + s.charCodeAt(i)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** "Artist - Title.mp3" → both; anything else is the title. */
export function namesFrom(fileName: string): { artist: string; title: string } {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim()
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base }
}

/** The browser's folder picker; null when the visitor closes it. Runs inside their click. */
function pickFolder(): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.setAttribute('webkitdirectory', '')
    input.hidden = true
    document.body.append(input)
    let done = false
    const finish = (list: File[] | null): void => {
      if (done) return
      done = true
      input.remove()
      resolve(list)
    }
    input.addEventListener('change', () => finish(input.files?.length ? Array.from(input.files) : null))
    input.addEventListener('cancel', () => finish(null))
    input.click()
  })
}

export const webFiles: ScBridge['local'] = {
  folders: async () => [...new Set([...files.values()].map((p) => p.folder))],
  addFolder: async () => {
    const list = await pickFolder()
    if (!list) return null
    const folder = list[0].webkitRelativePath.split('/')[0] || list[0].name
    const now = Date.now()
    lastAdded = 0
    for (const file of list) {
      if (!AUDIO.test(file.name)) continue
      const path = file.webkitRelativePath || file.name
      const key = keyOf(path, file)
      if (files.has(key)) continue
      const { artist, title } = namesFrom(file.name)
      // the folder inside the picked one is the album, as music folders usually go
      const parts = path.split('/')
      const album = parts.length > 2 ? parts[parts.length - 2] : ''
      files.set(key, { folder, file, track: { key, title, artist, album, duration: 0, hasCover: false, addedAt: now } })
      lastAdded++
    }
    return folder
  },
  removeFolder: async (dir) => {
    for (const [key, p] of files) {
      if (p.folder !== dir) continue
      files.delete(key)
      const url = urls.get(key)
      if (url) URL.revokeObjectURL(url)
      urls.delete(key)
    }
  },
  tracks: async () => [...files.values()].map((p) => p.track),
  scan: async (): Promise<LocalScan> => {
    const added = lastAdded
    lastAdded = 0
    return { total: files.size, added, removed: 0 }
  },
  onProgress: () => () => undefined,
  url: (key) => {
    const p = files.get(key)
    if (!p) return null
    let url = urls.get(key)
    if (!url) {
      url = URL.createObjectURL(p.file)
      urls.set(key, url)
    }
    return url
  }
}
