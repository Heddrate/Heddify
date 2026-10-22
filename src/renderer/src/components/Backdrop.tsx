import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '@/lib/hooks'

/**
 * The cover, blurred, behind a screen. When the cover changes the new one fades in over the
 * old instead of cutting to it. Without a cover it draws nothing (the page's own gradient shows).
 */
export function CoverBackdrop({ art }: { art: string | null }): React.JSX.Element {
  const last = useRef(art)
  const [under, setUnder] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (last.current === art) return
    setUnder(last.current)
    last.current = art
    // the new cover fades in over several seconds (see .cover-bg-in in styles/shell.css)
    const t = window.setTimeout(() => setUnder(null), 7500)
    return () => window.clearTimeout(t)
  }, [art])
  return (
    <div className={cx("cover-bg", !art && "empty")} aria-hidden>
      {under && <img key={`under-${under}`} className="cover-bg-img" src={under} alt="" />}
      {art && <img key={`now-${art}`} className="cover-bg-img cover-bg-in" src={art} alt="" />}
    </div>
  )
}

/** The user's own picture behind the interface; its blur, veil and colour come from CSS variables (see App). */
export function Wallpaper({ url }: { url: string }): React.JSX.Element {
  return (
    <div className="wallpaper" aria-hidden>
      <img key={url} className="wallpaper-img" src={url} alt="" />
    </div>
  )
}
