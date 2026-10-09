import { lang, locale, tx } from '@/lib/i18n'
const pad = (n: number): string => String(n).padStart(2, '0')

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec % 60)
  const m = Math.floor(sec / 60) % 60
  const h = Math.floor(sec / 3600)
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export const fmtDuration = (ms?: number): string => fmtTime((ms ?? 0) / 1000)

export function fmtTotal(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return tx("{0} мин", min)
  return tx("{0} ч {1} мин", Math.floor(min / 60), min % 60)
}

// formatters follow the language, which can change while the app runs
const formatters = new Map<string, { compact: Intl.NumberFormat; full: Intl.NumberFormat }>()
function fmt(): { compact: Intl.NumberFormat; full: Intl.NumberFormat } {
  const loc = locale()
  let f = formatters.get(loc)
  if (!f) {
    f = { compact: new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: 1 }), full: new Intl.NumberFormat(loc) }
    formatters.set(loc, f)
  }
  return f
}

export const fmtCount = (n?: number | null): string => (n == null ? '' : fmt().compact.format(n))
export const fmtNumber = (n?: number | null): string => (n == null ? '' : fmt().full.format(n))

export function plural(n: number, one: string, few: string, many: string): string {
  if (lang === 'en') return n === 1 ? one : many
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export const countLabel = (n: number, one: string, few: string, many: string): string =>
  `${fmtNumber(n)} ${plural(n, one, few, many)}`

const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' })
const dateFmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' })

export function fmtRelative(value?: string | number): string {
  if (value == null) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return tx("только что")
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute')
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour')
  if (diff < 86400 * 7) return rtf.format(-Math.floor(diff / 86400), 'day')
  if (diff < 86400 * 28) return rtf.format(-Math.floor(diff / (86400 * 7)), 'week')
  return dateFmt.format(d)
}

export function year(value?: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : String(d.getFullYear())
}
