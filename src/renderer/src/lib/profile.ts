/**
 * The person's own profile in Heddify: a picture and a name kept in the app (prefs), so changing
 * them never touches the SoundCloud or Yandex account. Without them the account's own show.
 */
import { create } from 'zustand'
import { whenBridge } from './bridge'
import { toCover } from './playlists'
import { tx } from './i18n'
import { toast } from '@/store/ui'

interface Profile {
  /** A small square JPEG (data URL), or null for the account's picture. */
  avatar: string | null
  /** Empty: the account's name. */
  name: string
}

export const useProfile = create<Profile>(() => ({ avatar: null, name: '' }))

whenBridge(() => {
  void window.sc.prefs.get().then((p) =>
    useProfile.setState({
      avatar: typeof p.profileAvatar === 'string' && p.profileAvatar.startsWith('data:image/') ? p.profileAvatar : null,
      name: typeof p.profileName === 'string' ? p.profileName : ''
    })
  )
})

/** Opens a file picker; the chosen picture becomes the avatar. */
export function pickAvatar(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/webp,image/gif'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const avatar = await toCover(file, 256)
      useProfile.setState({ avatar })
      void window.sc.prefs.set({ profileAvatar: avatar })
    } catch {
      toast(tx('Не получилось открыть картинку'))
    }
  }
  input.click()
}

export function removeAvatar(): void {
  useProfile.setState({ avatar: null })
  void window.sc.prefs.set({ profileAvatar: null })
}

export function setProfileName(name: string): void {
  const clean = name.trim().slice(0, 40)
  useProfile.setState({ name: clean })
  void window.sc.prefs.set({ profileName: clean })
}
