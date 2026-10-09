import type { ScBridge } from '../shared/ipc'

declare global {
  interface Window {
    sc: ScBridge
  }
}

export {}
