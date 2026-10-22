import { useEffect, useRef } from 'react'
import { attachView, detachView, VK_HOME } from '@/lib/vk'
import type { WebviewEl } from '@/lib/yandex'
import { loadVk, useVk } from '@/lib/vkLibrary'
import { mediaCommand } from '@/store/player'

const LIGHT_CSS = `*,*::before,*::after{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important;transition-delay:0s!important}
canvas,video{display:none!important}`

/**
 * The official vk.com page, never shown: it is only the engine behind the VK parts of the
 * app (playback, search, the user's tracks). Everything the user sees is our own UI.
 */
export function VkHost(): React.JSX.Element {
  const ref = useRef<WebviewEl>(null)

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    let lastCheck = 0

    const onReady = (): void => {
      // nobody looks at this page: animations end at once, no canvases/videos to paint
      void wv.insertCSS(LIGHT_CSS).catch(() => undefined)
      attachView(wv)
    }
    const onStop = (): void => {
      // signed in meanwhile? pick up the account (at most every 10 s)
      if (useVk.getState().status !== 'in' && Date.now() - lastCheck > 10_000) {
        lastCheck = Date.now()
        void loadVk()
      }
    }
    const onConsole = (e: Event): void => {
      const msg = (e as Event & { message?: string }).message ?? ''
      // media keys while the VK page owned the media session (MEDIA_BRIDGE in lib/yandex.ts)
      if (msg.startsWith('__sc_media:')) {
        const action = msg.slice('__sc_media:'.length)
        if (action === 'next' || action === 'prev' || action === 'play' || action === 'pause') mediaCommand(action)
        return
      }
      const level = (e as Event & { level?: number | string }).level
      const loud = level === 2 || level === 3 || level === 'warning' || level === 'error'
      if (/outputs zeroes/.test(msg) || (loud && /AudioContext|MediaSource|SourceBuffer|decode|NotAllowed|audio/i.test(msg))) {
        console.error(`vk page: ${msg.slice(0, 300)}`)
      }
    }

    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('did-stop-loading', onStop)
    return () => {
      detachView()
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('did-stop-loading', onStop)
    }
  }, [])

  return (
    <div className="engine-page" aria-hidden>
      <webview ref={ref as React.RefObject<HTMLElement | null>} src={VK_HOME} partition="persist:vk" />
    </div>
  )
}
