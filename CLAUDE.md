# Heddify

Desktop music player for Windows by Heddrate (called "SC Player" before 1.2): **SoundCloud,
Yandex Music and Audius in one window**, styled like Spotify / Yandex Music. Current version:
**1.3.0** (`package.json`). Spotify is planned as the next service — keep new code
service-agnostic (one library, one likes list, one search).
The owner talks in Russian, casually; answer in Russian, short and to the point.

## The owner's rules (follow them, they were learned the hard way)

- **Design:** monochrome only. Dark theme + mono accent by default. No purple, no neon, no
  glassmorphism, no decorative "AI slop". Spotify-like layout, calm short animations
  (`styles/motion.css`), everything off under `prefers-reduced-motion`.
- **Texts:** plain, short, useful. No slogans, no greetings ("Доброй ночи" on home was
  removed twice — never bring it back), no "без VPN / открытая музыка / спокойной ночи"
  style lines. Branding stays understated: only "автор — Heddrate" in Settings → О приложении.
- **No wave "характер" (mood) UI** — the wave always runs in mixed mode.
- **One library, no per-service sections.** Sidebar, likes, history, search and home mix all
  services; never add "SOUNDCLOUD / ЯНДЕКС" headings or per-service tabs again. Small origin
  badges in mixed track lists are fine. Discord status shows track + artist only (no
  "Моя волна · Яндекс" source line).
- Settings open from the **avatar menu** (no gear button). Settings order: Аккаунт,
  Оформление, Воспроизведение, Кеш, Discord, **О приложении last**.
- Both languages must work and **switch live** (Russian strings are the keys; see i18n below).
- Every new user-facing string: wrap in `tx()` and add the English to `lib/i18n.en.ts`.
- The app is a product for regular users, not just the owner: guest mode (no SoundCloud)
  must stay fully usable.

## Hard limits (do not cross)

- Never extract, read or type the user's tokens/passwords/cookies yourself. The app has a
  "Войти по токену" dialog where the *user* pastes `oauth_token`.
- Never evade or auto-solve captchas / DataDome (SoundCloud anti-bot). A solvable captcha is
  shown to the user; a hard block is reported in plain words.
- Don't scrape SoundCloud's JS for a client_id (was blocked as a third-party attack).
- No unofficial Yandex API signing secrets or stream-URL signing. Yandex playback goes
  through the official music.yandex.ru page only.
- Don't store the Discord public key. The Discord application ID (`1557715252651495475`) is
  public and baked in.

## Commands

```
npm run dev          # Electron with hot reload
npm run dev:web      # renderer only, in a browser, with mock data (src/renderer/src/dev/mock.ts)
npm run typecheck    # tsc for main/preload and renderer — run after every change
npm run build        # electron-vite build → out/
npx electron-vite preview --skipBuild   # run the built app
npm run dist         # build + electron-builder → dist/ (NSIS installer + portable exe)
```

The browser preview config is `.claude/launch.json` → `renderer-mock` (port 5173). In the
preview, Audius really plays; SoundCloud/Yandex are mocked.

Logs (no tokens): `<userData>\logs\api.log` — renderer `console.error` lands there too. Read it
before guessing. userData is `%APPDATA%\Heddify` for new installs, but stays
`%APPDATA%\SC Player` for users who had the old app (`src/main/userData.ts` keeps the old
folder so nobody gets signed out). Inside: `state.json` (prefs, encrypted token),
`cache\audio\` (audio cache + `index.json`). appId / AppUserModelId stay
`com.heddrate.scplayer` on purpose (in-place upgrade of old installs, pinned taskbar icons).

## Release checklist

1. Bump `version` in `package.json` (1.2.0 → 1.2.1 for fixes, 1.3.0 for features).
2. `npm run typecheck`, then close any running "Heddify" / "SC Player" (it locks `dist/`), `npm run dist`.
   To ship as an auto-update: commit, then push a tag `v<version>` to
   https://github.com/Heddrate/Heddify (public) — `.github/workflows/release.yml` builds on
   GitHub and publishes the installer + `latest.yml` + blockmap to Releases with the built-in
   GITHUB_TOKEN (no personal token). Fallback from this PC: `npm run release` with `GH_TOKEN`
   set by the owner. Installed apps download it in the background and install on restart.
3. Also ship a zip: copy `dist/win-unpacked` to a folder named `Heddify` and zip it
   *with that folder inside* → `dist/Heddify-<ver>-win-x64.zip` (electron-builder's zip
   target puts files at the root, so it's not in the targets). Some PCs fail the NSIS
   installer with "ошибка записи файла …app-64.7z" (antivirus / no space) — the zip avoids it.
4. Promo image / post text live in `release/` (`SC-Player-1.1.png`, `post.txt` — still the old
   name, redo for Heddify). The icon (`build/icon.png`) and the installer side images
   (`build/installerSidebar.bmp`, `installerHeader.bmp`) were rendered with an offscreen-Electron script (load HTML → `capturePage` → PNG / 24-bit BMP;
   needs `app.on('window-all-closed', () => {})`). The promo captures the real UI from
   `npm run dev:web` with mock data.
5. Installer is unsigned → Windows SmartScreen warns ("Подробнее → Выполнить в любом случае").

Not done yet: **Last.fm scrobbling** (needs an API key the owner registers), code signing
(paid certificate), Spotify (official API allows only 5 allowlisted users + Premium, and its
DRM doesn't work in Electron — owner was told). Git: repo is on GitHub (Heddrate/Heddify,
branch main); commit as "Heddrate <211876846+Heddrate@users.noreply.github.com>".

**SoundCloud DRM (tried 2026-10-09, not shipped):** castlabs Electron 44.5.1+wvcus gets the
Widevine CDM and passes EME; the owner made a castlabs EVS account and VMP-signed a test build
himself (Claude may not run EVS signing). soundcloud.com still gets **403 from
license.media-streaming.soundcloud.cloud** on the licence request — either the region (owner is
in Russia behind a VPN) or SoundCloud refusing such clients. Don't dig into the licence protocol
(blocked as an attack). Next step only if the owner reports DRM tracks play in plain Chrome
with his VPN: then retry with a VPN country SoundCloud licenses.

## Stack

Electron 44, electron-vite 5, Vite 7, React 19, zustand 5, hls.js (lazy-loaded), TypeScript
5.9. Sandboxed preload, `contextIsolation`, IPC bridge `window.sc` (typed in
`src/shared/ipc.ts`). TS 7 / Vite 8 were skipped on purpose (electron-vite 5 peers ≤ Vite 7).

## Architecture map

### Main process (`src/main`)
- `index.ts` — window (frameless, title bar overlay colours per theme), IPC handlers,
  `will-attach-webview` lock-down for the Yandex webview (partition `persist:yandex`, our own
  preload `preload/yandex.js` only), Yandex sign-in window, header sniffing for the Yandex
  API, `stream:resolve` (cache first, then SoundCloud/Audius), thumbar buttons,
  `shell:open` allowlist (soundcloud.com, discord.com, music.yandex.ru, audius.co).
  `autoplay-policy=no-user-gesture-required` (the hidden Yandex page must start audio).
- `soundcloud.ts` — api-v2 client. OAuth token + client_id are sniffed from the
  soundcloud.com web app's own requests in partition `persist:soundcloud`. Writes (likes,
  follows) go through a hidden soundcloud.com page ("web bridge") because direct calls get
  403 from DataDome. `resolveStream` picks the best transcoding, detects DRM-only tracks.
  Firefox UA spoof only for Google sign-in pages (a session-wide spoof triggered DataDome).
- `auth.ts` — sign-in window, `loginWithToken` (accepts bare token, `OAuth …`, or a whole
  cookie string with `oauth_token=`), logout.
- `store.ts` — `state.json`: prefs, token (encrypted with `safeStorage`), window bounds.
- `cache.ts` — audio cache: `scp-cache://audio/<key>` protocol with byte ranges + CORS,
  LRU by size limit (`cacheLimitMb`, default 1 GB), background download after a track starts
  (HLS segments are joined; mp3/ogg/m4a). "Скачать" pins entries (never evicted, outside the
  limit) with track metadata for the offline page. Keys: `sc-<id>`, `au-<audiusId>`.
- `audius.ts` — Audius API host discovery + stream URLs (`/v1/tracks/<id>/stream?app_name=SCPlayer`).
- `tray.ts` — tray menu, "close to tray" (`closeToTray` pref). Icon: `resources/icon.png`
  in the installed app (extraResources), `build/icon.png` in dev.
- `mediaKeys.ts` — grabs keyboard media keys via `globalShortcut` while a track is loaded.
- `discord.ts` — Discord Rich Presence over the IPC pipe (activity type 2, button label). The
  name after "Слушает" is the Discord application's name in the Developer Portal.
- `updater.ts` — electron-updater (GitHub Releases): checks 15 s after start and every 4 h,
  downloads silently, installs on quit or via "Обновить" (avatar dot + menu item, Settings →
  О приложении). Only the NSIS install updates; portable / zip / dev report 'unsupported'.
- `userData.ts` — imported first: keeps the old `%APPDATA%\SC Player` profile.

### Preload (`src/preload`)
- `index.ts` — the `window.sc` bridge. `login.ts` — sign-in pages helper.
- `yandex.ts` — runs in the Yandex page's main world before its scripts: routes all Web Audio
  through a gain node + overrides media element volume → our volume slider works for Yandex.

### Renderer (`src/renderer/src`)
- `App.tsx` — auth gate (checking / out → Login / offline / in / guest), shell, routes
  (most views lazy-loaded), hotkeys. The shell remounts on language change; the hidden
  Yandex engine (`YandexHost`) lives outside it so it never reloads.
- `store/app.ts` — auth, navigation (route + back/forward stacks), SoundCloud library,
  likes/follows with a **pending queue** (likes refused by anti-bot are kept locally and
  re-sent quietly later), guest mode (`continueAsGuest`, pref `guest`), `listenOffline`.
- `store/player.ts` — queue/context/manual queue, shuffle/repeat, generators (wave),
  **external drivers** (`registerExternal`/`externalEvents` — Yandex plays in its page and is
  mirrored), media session, `mediaCommand()` (one deduplicated entry for media keys, Windows
  overlay, taskbar, tray, Yandex page — 400 ms dedupe), saved session restore.
- `player/engine.ts` — our `<audio>` engine: progressive + hls.js (loaded on demand) + joined
  Ogg/Opus; recovery re-resolves with `fresh: true` (drops a bad cached copy, rerolls the
  Audius node); optional volume leveling (Web Audio compressor, pref `leveling`).
- `store/ui.ts` — toasts, context menu, dialogs (`askText` with `secret` option, `askConfirm`).
- `lib/api.ts` — SoundCloud api-v2 wrapper. `lib/hooks.ts` — `useAsync`/`usePaged` with
  stale-while-revalidate via `lib/listCache.ts` (`p:` keys persist across launches).
- `lib/yandex.ts` — the Yandex engine: webview registry, client-side navigation through the
  site's own Next.js router, click-to-play via the TrackModal "Воспроизведение" button,
  state from the timecode slider `input[aria-label="Управление таймкодом"]` + media session,
  `startYandexWave` / `warmYandexWave` (with timing traces in the log).
- `lib/yandexApi.ts` — Yandex library (account, likes, playlists, artists, albums, rotor wave
  tracks) by calling api.music.yandex.ru *inside* the page with its own headers. Library and
  track metadata are persisted in localStorage for instant start.
- `lib/audius.ts` — Audius catalogue (trending by genre/period, underground, search, artists,
  related), local likes (pref `audiusLikes`), wave picks. Track ids `1e12 + track_id`.
- `lib/wave.ts` — "Моя волна": SoundCloud related-tracks wave mixed with Yandex rotor and
  Audius picks (weights sc:ya:au = 3:2:1, `waveServices()`), artist keys for skip/dislike,
  "не нравится" remembered 60 days (pref `waveDislikes`), sources chip (pref `waveSources`).
- `lib/library.ts` — `useLibraryItems()`: own + SoundCloud + Yandex playlists as one list
  (sidebar, Медиатека page, home shelf; `components/LibCard.tsx`).
- `lib/likes.ts` — `useAllLikes()`: SoundCloud (paged) + Yandex + Audius likes merged by like
  time (Yandex `likeAt` from the API timestamps, Audius `liked_at`); a service with more pages
  hides likes older than its oldest loaded one so pages never jump in above.
- `lib/played.ts` — the app's own listening history (all services, localStorage `played`),
  merged with SoundCloud's in `useHistory()`.
- `lib/update.ts` — update state for the avatar dot / Settings.
- `lib/playlists.ts` — the app's own cross-service playlists (pref `localPlaylists`): create /
  rename / delete / reorder, custom cover (square-cropped JPEG data URL), `offline` flag
  auto-downloads newly added tracks.
- `lib/offline.ts` + `components/DownloadButton.tsx` — downloads for offline listening.
- `lib/lyrics.ts` — LRCLIB lyrics (synced when the duration matches, plain text otherwise).
- `lib/sleep.ts` — sleep timer. `lib/presence.ts` — Discord status from the player.
- `lib/i18n.ts` — `tx()`; `lang` is live, `onLangChange`. **Never call `tx()` at module
  level** (labels must be functions or computed in render), or a language switch won't update
  them. `lib/bridge.ts` — `whenBridge()` for modules that touch `window.sc` at import (the
  browser preview installs its mock asynchronously).
- `lib/theme.ts` + `styles/themes.css` — themes (dark, oled, graphite, light) and accent
  (mono / SoundCloud orange) via `data-theme` / `data-accent` on `<html>`.
- Views: Home (shelves only — no greeting, no tile grid), Wave, Search (tabs Всё / Треки /
  Исполнители / Плейлисты / Альбомы; tracks of all services mixed), Library (unified likes,
  history, following, Медиатека), Playlist, User, Yandex views, Audius view ("В тренде"),
  Local (own playlists: cover button says "Выбрать обложку", "Добавить треки" search over
  all services right on the page; "Скачанное"), Settings, Login ("Начать" = guest).
- Components worth knowing: Sidebar (one list: wave, Мне нравится, История, Подписки, then all
  playlists; drop a dragged track on an own playlist to add it; "Подключить сервисы" row while
  something isn't connected; "Скачанное" lives in Settings → Кеш), TopBar (back/forward as
  48px circles like the home button), Onboarding (first run: SoundCloud → Яндекс → готово,
  pref `onboarded`; installs with `ya-checked` in localStorage skip it), UpdateBanner
  ("Доступно обновление" with Перезапустить / Позже), TrackList rows: draggable (TRACK_MIME
  in lib/playlists.ts), "+" (add to playlist) next to the heart, `onReorder` for own
  playlists; Artwork `letter` fallback (artist initial) when there's no cover/avatar, PlayerBar (cover click opens "Сейчас играет"), NowPlayingPanel
  (lyrics + sleep timer buttons in its header, lyrics card), LyricsPanel, QueuePanel
  ("Недавно звучало"), TrackList (service badges only in mixed lists).

## Known facts and gotchas

- SoundCloud is unavailable in Russia without a VPN; the owner uses one (Hiddify).
  `/users/{id}/playlists_liked_and_owned` and `/me/followings/ids` return 404 → fallbacks exist.
- DRM-only SoundCloud tracks (monetised, only encrypted HLS) can't play; the app marks and skips them (see "SoundCloud DRM" above).
- Yandex plays through Web Audio (no DOM `<audio>`); `loadURL` of the webview may never
  resolve — don't await it. The hidden page is lightened: main cancels image/font/ads/Metrika
  requests for the engine webview only (`lightenYandexEngine`, not the sign-in window — it can
  show a captcha), YandexHost injects CSS that ends animations at once and hides canvas/video,
  and lib/yandex.ts unloads the page after 15 min without Yandex use. Yandex tracks have `origin: 'yandex'` and negative ids.
- Narrow / vertical monitors (window ≥ 980 px): side panels overlay the page below 1240 px,
  autoplay toggle hides; volume slider has a fixed comfortable width.
- PowerShell edits: aliases like `R` collide with built-ins (`R` = Invoke-History) — name
  helper functions something else.
