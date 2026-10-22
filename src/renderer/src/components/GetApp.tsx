import { useEffect, useState } from 'react'
import { cx } from '@/lib/hooks'
import { tx } from '@/lib/i18n'
import { Icon } from './Icon'

/** The releases page: every version, and where the link goes until the installer's own address is known. */
const RELEASES = 'https://github.com/Heddrate/Heddify/releases/latest'
const LATEST = 'https://api.github.com/repos/Heddrate/Heddify/releases/latest'

let installer: Promise<string> | null = null

/** The installer of the latest version (Heddify-Setup-x.y.z.exe), asked from GitHub once per visit. */
function installerUrl(): Promise<string> {
  installer ??= fetch(LATEST)
    .then((r) => r.json() as Promise<{ assets?: { name?: string; browser_download_url?: string }[] }>)
    .then((j) => j.assets?.find((a) => /^Heddify-Setup-[\d.]+\.exe$/.test(a.name ?? ''))?.browser_download_url ?? RELEASES)
    .catch(() => RELEASES)
  return installer
}

/** "Скачать для Windows": the website's way to the desktop app. */
export function GetAppLink({ compact = false, className }: { compact?: boolean; className?: string }): React.JSX.Element {
  const [href, setHref] = useState(RELEASES)
  useEffect(() => {
    let alive = true
    void installerUrl().then((u) => alive && setHref(u))
    return () => {
      alive = false
    }
  }, [])
  return (
    <a className={cx('btn btn-primary get-app', compact && 'compact', className)} href={href} rel="noopener" title={tx('Скачать Heddify для Windows')}>
      <Icon name="download" size={18} />
      <span>{compact ? tx('Скачать') : tx('Скачать для Windows')}</span>
    </a>
  )
}
