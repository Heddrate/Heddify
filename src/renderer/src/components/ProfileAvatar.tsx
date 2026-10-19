import { Artwork } from './Artwork'
import { userArt } from '@/lib/artwork'
import { useProfile } from '@/lib/profile'
import { useYa } from '@/lib/yandexApi'
import { useApp } from '@/store/app'

/** The person's picture: their own from the Heddify profile, else SoundCloud's, else Yandex's. */
export function ProfileAvatar({ size }: { size: number }): React.JSX.Element {
  const own = useProfile((s) => s.avatar)
  const me = useApp((s) => s.me)
  const ya = useYa((s) => (s.status === 'in' ? s.avatar : null))
  const src = own ?? (me ? userArt(me, 'large') : null) ?? ya
  return <Artwork src={src} size={size} round placeholder="person" />
}
