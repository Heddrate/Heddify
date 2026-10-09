/** App self-update state from main (see main/updater.ts): drives the dot on the avatar. */
import { create } from 'zustand'
import type { UpdateState } from '../../../shared/ipc'
import { whenBridge } from './bridge'

export const useUpdate = create<UpdateState>(() => ({ status: 'idle' }))

whenBridge(() => {
  void window.sc.update.state().then((s) => useUpdate.setState(s, true))
  window.sc.update.onState((s) => useUpdate.setState(s, true))
})

export const checkUpdate = (): void => void window.sc.update.check()
/** Set while the app is about to close for the installer (full-screen notice). */
export const useInstalling = create<{ on: boolean }>(() => ({ on: false }))

export const installUpdate = (): void => {
  useInstalling.setState({ on: true })
  void window.sc.update.install()
}
