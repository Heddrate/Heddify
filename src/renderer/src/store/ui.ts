import { create } from 'zustand'
import type { IconName } from '@/components/Icon'

interface Toast {
  id: number
  text: string
}

export const useToasts = create<{ items: Toast[] }>(() => ({ items: [] }))
let toastSeq = 0

export function toast(text: string, ms = Math.max(2800, text.length * 55)): void {
  const id = ++toastSeq
  useToasts.setState((s) => ({ items: [...s.items.slice(-2), { id, text }] }))
  setTimeout(() => useToasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })), ms)
}

export type MenuItem =
  | { label: string; icon?: IconName; onSelect: () => void; disabled?: boolean; danger?: boolean }
  | { separator: true }

interface MenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
}

export const useMenu = create<MenuState>(() => ({ open: false, x: 0, y: 0, items: [] }))

export function openMenu(at: { x: number; y: number }, items: MenuItem[]): void {
  useMenu.setState({ open: true, x: at.x, y: at.y, items })
}

/** Opens a menu below an anchor element (for "…" buttons). */
export function openMenuAt(el: Element, items: MenuItem[]): void {
  const r = el.getBoundingClientRect()
  openMenu({ x: r.left, y: r.bottom + 4 }, items)
}

export const closeMenu = (): void => useMenu.setState({ open: false })

/* ---------- dialogs ---------- */

interface DialogState {
  open: boolean
  kind: 'text' | 'confirm'
  title: string
  text?: string
  value: string
  confirm: string
  danger?: boolean
  /** Text input only: hide what's typed (tokens), hint inside the empty field. */
  secret?: boolean
  placeholder?: string
  resolve?: (value: string | null) => void
}

export const useDialog = create<DialogState>(() => ({ open: false, kind: 'text', title: '', value: '', confirm: '' }))

function openDialog(state: Omit<DialogState, 'open' | 'resolve'>): Promise<string | null> {
  useDialog.getState().resolve?.(null)
  return new Promise((resolve) => useDialog.setState({ ...state, open: true, resolve }))
}

/** Asks for a short text (a playlist name); null when cancelled. */
export const askText = (
  title: string,
  value: string,
  confirm: string,
  opts: { text?: string; secret?: boolean; placeholder?: string } = {}
): Promise<string | null> => openDialog({ kind: 'text', title, value, confirm, ...opts })

/** Asks to confirm an action; true when confirmed. */
export const askConfirm = (title: string, text: string, confirm: string, danger = false): Promise<boolean> =>
  openDialog({ kind: 'confirm', title, text, value: '', confirm, danger }).then((v) => v !== null)

export function closeDialog(value: string | null): void {
  const { resolve } = useDialog.getState()
  useDialog.setState({ open: false, resolve: undefined })
  resolve?.(value)
}