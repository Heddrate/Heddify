/**
 * The app was called "SC Player" before 1.2: its data (sign-in, prefs, cache, the Yandex and
 * SoundCloud sessions) lives in %APPDATA%\SC Player. Keep using that folder when it holds a
 * profile and the new one doesn't, so an update never signs anyone out.
 * Imported first in index.ts: it must run before anything touches userData.
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const OLD = join(app.getPath('appData'), 'SC Player')
const profile = (dir: string): boolean => existsSync(join(dir, 'state.json'))

if (profile(OLD) && !profile(app.getPath('userData'))) app.setPath('userData', OLD)
