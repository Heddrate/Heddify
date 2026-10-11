import { describe, expect, it } from 'vitest'
import { parseToken } from '../src/shared/token'

// all values here are fake
describe('parseToken', () => {
  it('takes a bare token', () => {
    expect(parseToken('abcdef1234567890')).toBe('abcdef1234567890')
  })

  it('drops the OAuth or Bearer prefix', () => {
    expect(parseToken('OAuth abcdef1234567890')).toBe('abcdef1234567890')
    expect(parseToken('Bearer abcdef1234567890')).toBe('abcdef1234567890')
  })

  it('reads oauth_token from a cookie string', () => {
    expect(parseToken('foo=1; oauth_token=abcdef1234567890; bar=2')).toBe('abcdef1234567890')
  })

  it('removes quotes and spaces around it', () => {
    expect(parseToken('  "abcdef1234567890"  ')).toBe('abcdef1234567890')
  })

  it('accepts a JWT-like token with dots', () => {
    const jwt = 'eyJhbGciOi.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'
    expect(parseToken(jwt)).toBe(jwt)
  })

  it('rejects too short or broken input', () => {
    expect(parseToken('short')).toBeNull()
    expect(parseToken('has spaces inside it')).toBeNull()
    expect(parseToken('')).toBeNull()
  })
})
