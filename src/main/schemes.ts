import type { CustomScheme } from 'electron'

/**
 * The app's own schemes: cached tracks (main/cache.ts) and the user's own files (main/local.ts).
 * While Web Audio is in the player's path (volume leveling, bass glow) the <audio> element loads
 * with CORS, and Chromium refuses CORS on a custom scheme that isn't `corsEnabled`: every cached
 * track and own file then failed to load. Registered together: Electron takes a single call.
 */
export const APP_SCHEMES: CustomScheme[] = [
  { scheme: 'scp-cache', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'heddify-local', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
]
