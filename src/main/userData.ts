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

// development only: run against a throwaway profile (HEDDIFY_PROFILE=<dir>), next to the real app
if (!app.isPackaged && process.env.HEDDIFY_PROFILE) app.setPath('userData', process.env.HEDDIFY_PROFILE)
else if (profile(OLD) && !profile(app.getPath('userData'))) app.setPath('userData', OLD)
