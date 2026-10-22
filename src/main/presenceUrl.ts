/**
 * Discord checks every link in an activity (button url, image) as a strict RFC 3986 uri and
 * rejects the whole status over one bad character: a space, Cyrillic, `|`, a stray `%`.
 * Returns the link in a form Discord accepts, or undefined when it can't be one.
 */
export function presenceUrl(raw: string | null | undefined, max = 512): string | undefined {
  if (!raw) return undefined
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' || !u.hostname) return undefined
  // URL already turns non-ASCII into %XX (and the host into punycode) but leaves a few characters RFC 3986 forbids
  const href = u.href
    .replace(/%(?![0-9A-Fa-f]{2})/g, '%25')
    .replace(/[^A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]/g, (c) => encodeURIComponent(c))
  return href.length <= max ? href : undefined
}
