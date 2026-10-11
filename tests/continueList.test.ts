import { describe, expect, it } from 'vitest'
import { continueKey, pushContinue, type ContinueItem } from '../src/renderer/src/lib/continueList'

const item = (route: ContinueItem['route'], at: number): ContinueItem => ({ route, label: 'x', at })

describe('continueKey', () => {
  it('keeps one entry for the wave and for radio, whatever the tag', () => {
    expect(continueKey({ name: 'wave' })).toBe('wave')
    expect(continueKey({ name: 'radio', tag: 'jazz' })).toBe('radio')
    expect(continueKey({ name: 'radio' })).toBe('radio')
  })

  it('tells playlists apart by id', () => {
    expect(continueKey({ name: 'local', id: 'a' })).not.toBe(continueKey({ name: 'local', id: 'b' }))
  })
})

describe('pushContinue', () => {
  it('puts the newest context first', () => {
    const list = pushContinue([item({ name: 'wave' }, 1)], item({ name: 'local', id: 'a' }, 2))
    expect(list.map((c) => c.route.name)).toEqual(['local', 'wave'])
  })

  it('moves an existing context to the front instead of repeating it', () => {
    const list = pushContinue(
      [item({ name: 'local', id: 'a' }, 1), item({ name: 'wave' }, 2)],
      item({ name: 'local', id: 'a' }, 3)
    )
    expect(list.map((c) => [c.route.name, c.at])).toEqual([
      ['local', 3],
      ['wave', 2]
    ])
  })

  it('keeps only the newest entries', () => {
    let list: ContinueItem[] = []
    for (let i = 0; i < 10; i++) list = pushContinue(list, item({ name: 'local', id: String(i) }, i), 6)
    expect(list).toHaveLength(6)
    expect(list[0].route).toEqual({ name: 'local', id: '9' })
  })
})
