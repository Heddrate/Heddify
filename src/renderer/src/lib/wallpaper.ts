/**
 * Pictures behind the interface: the one in use ("wallpaper") and the ones that belong to the
 * user's own themes ("theme:<id>"). They live in the page's IndexedDB, not in localStorage (too
 * small for pictures), and show through an object URL.
 */
import { create } from 'zustand'

const DB_NAME = 'heddify'
const STORE = 'images'
export const WALLPAPER = 'wallpaper'
export const themeImageKey = (id: string): string => `theme:${id}`

/** Longest side a picture is kept at: sharper than any window, a few hundred KB. */
const MAX_SIDE = 2560
/** An animated GIF is kept as it is up to this size (drawing it to a canvas would stop it). */
const GIF_MAX_BYTES = 12 * 1024 * 1024

let db: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return db
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open()
  return new Promise((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export const getImage = (key: string): Promise<Blob | null> => tx('readonly', (s) => s.get(key)).then((b) => (b instanceof Blob ? b : null))
export const putImage = (key: string, blob: Blob): Promise<unknown> => tx('readwrite', (s) => s.put(blob, key))
export const deleteImage = (key: string): Promise<unknown> => tx('readwrite', (s) => s.delete(key))

/** A picture the user chose, made light enough to keep: at most MAX_SIDE, WebP. */
export async function prepareImage(file: Blob): Promise<Blob> {
  if (file.type === 'image/gif' && file.size <= GIF_MAX_BYTES) return file
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** A data: address back to a picture; decoded here, since the page may not fetch data: addresses (its content policy). */
export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',')
  const type = /^data:([^;,]+)/.exec(url)?.[1] ?? 'application/octet-stream'
  const bin = atob(url.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}

/** The picture in use, as an address for <img>; null without one. */
export const useWallpaper = create<{ url: string | null; ready: boolean }>(() => ({ url: null, ready: false }))

function show(blob: Blob | null): void {
  const old = useWallpaper.getState().url
  useWallpaper.setState({ url: blob ? URL.createObjectURL(blob) : null, ready: true })
  if (old) URL.revokeObjectURL(old)
}

/** Puts a picture in use (already prepared). */
export async function setWallpaper(blob: Blob | null): Promise<void> {
  if (blob) await putImage(WALLPAPER, blob)
  else await deleteImage(WALLPAPER)
  show(blob)
}

/** The picture in use since last time; called once at start. */
export async function loadWallpaper(): Promise<void> {
  try {
    show(await getImage(WALLPAPER))
  } catch {
    show(null)
  }
}
