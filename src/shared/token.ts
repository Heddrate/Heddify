/**
 * Pulls the SoundCloud token out of whatever the user pasted. Returns null when it doesn't
 * look like a token. Accepts the bare token, "OAuth <token>", or a cookie string with
 * oauth_token=… in it.
 */
export function parseToken(raw: string): string | null {
  const fromCookie = raw.match(/oauth_token=([^;\s"']+)/i)?.[1]
  const token = (fromCookie ?? raw).trim().replace(/^["']|["']$/g, '').replace(/^(OAuth|Bearer)\s+/i, '')
  // old tokens look like 2-123456-…; newer ones are JWTs (eyJ….….…) with dots in them
  return /^[\w.-]{10,}$/.test(token) ? token : null
}
