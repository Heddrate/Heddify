import { describe, expect, it } from 'vitest'
import { APP_SCHEMES } from '../src/main/schemes'

// The player loads with CORS while bass glow or volume leveling is on (Web Audio):
// a scheme without corsEnabled then fails for every cached track and own file.
describe('app schemes', () => {
  it('registers the cache and own-files schemes', () => {
    expect(APP_SCHEMES.map((s) => s.scheme).sort()).toEqual(['heddify-local', 'scp-cache'])
  })

  it.each(APP_SCHEMES.map((s) => [s.scheme, s] as const))('%s can be loaded with CORS, streamed and seeked', (_name, s) => {
    expect(s.privileges).toMatchObject({ standard: true, secure: true, stream: true, corsEnabled: true })
  })
})
