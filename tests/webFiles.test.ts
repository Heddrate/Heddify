// The website reads a visitor's own files by their names: "Artist - Title.mp3".
import { describe, expect, it } from 'vitest'
import { namesFrom } from '../src/renderer/src/web/files'

describe('names from a file name', () => {
  it('splits "Artist - Title"', () => {
    expect(namesFrom('Test Artist - Test Song.wav')).toEqual({ artist: 'Test Artist', title: 'Test Song' })
    expect(namesFrom('Кино – Группа крови.mp3')).toEqual({ artist: 'Кино', title: 'Группа крови' })
  })

  it('keeps the whole name as the title otherwise', () => {
    expect(namesFrom('track_01_final.flac')).toEqual({ artist: '', title: 'track 01 final' })
    expect(namesFrom('A-B.mp3')).toEqual({ artist: '', title: 'A-B' })
  })
})
