import { libArt, libRoute, libSub, libTitle, playLibItem, type LibItem } from '@/lib/library'
import { playlistMenu } from '@/lib/actions'
import { navigate } from '@/store/app'
import { Collage } from '@/views/Local'
import { Card } from './Card'

/** A playlist from any service as a card. */
export function LibCard({ item }: { item: LibItem }): React.JSX.Element {
  const route = libRoute(item)
  return (
    <Card
      title={libTitle(item)}
      sub={libSub(item)}
      art={libArt(item)}
      artNode={item.type === 'local' ? <Collage list={item.list} /> : undefined}
      placeholder="queue"
      route={route}
      onOpen={() => navigate(route)}
      onPlay={() => playLibItem(item)}
      menu={item.type === 'sc' ? () => playlistMenu(item.p) : undefined}
    />
  )
}
