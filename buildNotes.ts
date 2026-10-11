// Release notes of one version, baked into the renderer at build time ("Что нового" in Settings).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function releaseNotes(version: string): string {
  const file = resolve('release/notes', `v${version}.md`)
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
