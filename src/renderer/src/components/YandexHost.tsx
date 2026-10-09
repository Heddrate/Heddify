import { useEffect, useRef } from 'react'
import { attachView, detachView, onPageMediaKey, onPageStartedPlaying, YA_HOME, type WebviewEl } from '@/lib/yandex'
import { loadYandex, useYa } from '@/lib/yandexApi'

/**
 * The official music.yandex.ru page, never shown: it is only the engine behind the
 * Yandex parts of the app (playback, its own wave, API calls in the user's session).
 * Everything the user sees is our own UI.
 */
export function YandexHost(): React.JSX.Element {
  const ref = useRef<WebviewEl>(null)

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    let lastCheck = 0

    const onReady = (): void => attachView(wv)
    const onPlay = (): void => void onPageStartedPlaying()
    const onStop = (): void => {
      // signed in meanwhile? pick up the library (at most every 10 s)
      if (useYa.getState().status !== 'in' && Date.now() - lastCheck > 10_000) {
        lastCheck = Date.now()
        void loadYandex()
      }
    }

    const onConsole = (e: Event): void => {
      const msg = (e as Event & { message?: string }).message ?? ''
      if (msg.startsWith('__sc_media:')) onPageMediaKey(msg.slice('__sc_media:'.length))
    }

    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('dom-ready', onReady)
    wv.addEventListener('media-started-playing', onPlay)
    wv.addEventListener('did-stop-loading', onStop)
    return () => {
      detachView()
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('dom-ready', onReady)
      wv.removeEventListener('media-started-playing', onPlay)
      wv.removeEventListener('did-stop-loading', onStop)
    }
  }, [])

  return (
    <div className="yandex-engine" aria-hidden>
      <webview
        ref={ref as React.RefObject<HTMLElement | null>}
        src={YA_HOME}
        partition="persist:yandex"
        // React passes unknown attributes through only as strings
        allowpopups={'true' as unknown as boolean}
      />
    </div>
  )
}
