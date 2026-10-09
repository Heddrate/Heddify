import type { Transcoding } from '../../../shared/ipc'

export interface User {
  id: number
  kind: 'user'
  username: string
  full_name?: string
  avatar_url?: string
  permalink_url?: string
  followers_count?: number
  followings_count?: number
  track_count?: number
  playlist_count?: number
  likes_count?: number
  city?: string | null
  country_code?: string | null
  description?: string | null
  verified?: boolean
  badges?: { verified?: boolean; pro?: boolean; pro_unlimited?: boolean }
  visuals?: { visuals?: { visual_url: string }[] } | null
}

export type Policy = 'ALLOW' | 'MONETIZE' | 'SNIP' | 'BLOCK'

export interface Track {
  id: number
  kind: 'track'
  title?: string
  user?: User
  user_id?: number
  artwork_url?: string | null
  duration?: number
  full_duration?: number
  permalink_url?: string
  playback_count?: number
  likes_count?: number
  reposts_count?: number
  created_at?: string
  display_date?: string
  genre?: string | null
  policy?: Policy
  streamable?: boolean
  track_authorization?: string
  media?: { transcodings: Transcoding[] }
  publisher_metadata?: { artist?: string } | null
  /** Set for Yandex Music tracks; they play through the embedded Yandex player. */
  origin?: 'yandex' | 'audius' | 'radio' | 'local'
  ya?: { trackId: number; albumId?: number; artistId?: number }
  /** Set for Audius tracks (string ids of the Audius API). */
  au?: { id: string; userId: string; handle?: string }
  /** A music file from the user's own folders (key in main/local.ts's index). */
  local?: { key: string; album?: string }
  /** Internet radio station (Radio Browser): a live stream, no duration. */
  radio?: { uuid: string; url: string; hls: boolean }
  /** When the track was liked; kept for likes stored in the app (Audius). */
  liked_at?: string
}

export interface Playlist {
  id: number
  kind: 'playlist'
  title: string
  user?: User
  artwork_url?: string | null
  calculated_artwork_url?: string | null
  track_count?: number
  tracks?: Track[]
  duration?: number
  permalink_url?: string
  is_album?: boolean
  set_type?: string | null
  created_at?: string
  published_at?: string | null
  release_date?: string | null
  display_date?: string
  likes_count?: number
}

export interface SystemPlaylist {
  id?: string
  urn: string
  kind: 'system-playlist'
  title: string
  short_title?: string
  description?: string
  short_description?: string
  artwork_url?: string | null
  calculated_artwork_url?: string | null
  tracks?: Track[]
  user?: User
  permalink_url?: string
}

export type AnyPlaylist = Playlist | SystemPlaylist

export interface Collection<T> {
  collection: T[]
  next_href?: string | null
}

export interface LikeItem {
  created_at: string
  track?: Track
}

export interface HistoryItem {
  played_at?: number | string
  track?: Track
}

export interface StreamItem {
  type: string
  created_at?: string
  track?: Track
  playlist?: Playlist
  user?: User
}

export interface Selection {
  urn?: string
  title?: string
  description?: string | null
  items?: Collection<AnyPlaylist | User | Track>
}

export type Route =
  | { name: 'home' }
  | { name: 'search'; q: string; tab?: SearchTab }
  | { name: 'likes' }
  | { name: 'playlists' }
  | { name: 'following' }
  | { name: 'history' }
  | { name: 'playlist'; id: number }
  | { name: 'system'; urn: string }
  | { name: 'user'; id: number; tab?: UserTab }
  | { name: 'wave' }
  | { name: 'settings' }
  | { name: 'yandex' }
  | { name: 'ya-wave' }
  | { name: 'ya-likes' }
  | { name: 'ya-playlist'; uid: number; kind: number }
  | { name: 'ya-artist'; id: number }
  | { name: 'ya-album'; id: number }
  | { name: 'audius'; genre?: string }
  | { name: 'au-likes' }
  | { name: 'au-artist'; id: string }
  | { name: 'local'; id: string }
  | { name: 'offline' }
  | { name: 'radio'; tag?: string }
  | { name: 'files' }

export type SearchTab = 'all' | 'tracks' | 'users' | 'playlists' | 'albums' | 'yandex' | 'audius'
export type UserTab = 'popular' | 'tracks' | 'albums' | 'playlists' | 'reposts'

/** Where the current queue came from; `next` lets the player keep paging. */
export interface PlaySource {
  label: string
  route?: Route
  next?: string | null
  /** Endless generated source (e.g. "Моя волна"); the player asks it for more tracks. */
  kind?: 'wave'
}
