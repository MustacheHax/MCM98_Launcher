# Changelog

All notable changes to the MCM98 Launcher and its relay. The launcher and the relay are versioned together from the same commit, so a release number covers both `package.json` files.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) as described in [README → Versioning and roadmap](README.md#versioning-and-roadmap).

## [Unreleased]

Planned work and the version each item ships under live in [ROADMAP.md](ROADMAP.md).

## [0.4.7] — 2026-11-03

### Added

- **A real test suite** — `npm test` runs twelve checks over the parts that broke before or would break silently: the downloader against a local range-capable server (resume from a partial, a server that ignores `Range`, a `416` retry, and a bad digest discarding its partial), the play-state store (a live session surviving a restart, a dead PID being reaped with its playtime folded in, normal exits adding playtime, and the persisted JSON round-tripping), and save detection (publisher nesting, direct folders beating nested ones, install folders beating fuzzy matches, and a clean miss).
- The downloader and save detection no longer import Electron directly, so they run in plain Node: `downloadFile` takes its transport as `fetchImpl` (the app passes `net.fetch`) and `detectSaveDirectory` takes the platform folders from the new `saveRoots.ts`.
- Test files are typechecked with the rest of the main process (`test/**/*.mts` in `tsconfig.node.json`).

### Changed

- **The theme picker is a grid again.** The appearance tab had grown a section per family, each holding two cards, which read as eleven stacked rows in a six-column panel. All themes render in one grid now, in family order, with the family and brightness printed under each name; the All / Dark / Light filter and a live count stay on top.
- **Arcade has its own typeface.** `Press Start 2P` is bundled as a 6.6 KB woff2 with its SIL OFL licence beside it, so the family's headings are pixel marquees offline instead of Arial Black. Cabinet headings run smaller so the wide face fits.
- **The newer families are pulled apart where they overlapped.** Arcade Light moved from lavender to warm coin-op paper, so it no longer twins Vaporwave Light; Night Shift Light sits on deeper parchment to separate it from Terminal Light's green-bar cream and 90s Retro Light's grey beige. Every family now differs in palette, geometry, and type, not just hue.
- **Settings copy corrected:** the appearance panel said twelve themes when there are twenty-two across eleven families.

### Fixed

- **A freshly published launcher release could stay undetected for hours.** Two caches stacked on the update check: the relay reused its GitHub snapshot for `CACHE_TTL_SECONDS` (300s) on the launcher's own repository, and it answered `/api/launcher` with `Cache-Control: public, max-age=60, stale-while-revalidate=300`, which Electron's `net.fetch` honours — a second check inside that window was served from disk without the server being contacted at all, and because the launcher only polls every six hours, one stale answer hid the release until the next poll.
  - The launcher's snapshot now has its own 30-second ceiling (`LAUNCHER_SNAPSHOT_TTL_MS`), long enough to absorb a burst of clients, short enough that a new release is never hidden.
  - `/api/launcher` answers with `Cache-Control: no-store, max-age=0` and `Pragma: no-cache`, and `/api/catalog` with `no-cache` so it revalidates through its ETag instead of serving a stale copy.
  - The client appends `_t=<timestamp>` and sends `Cache-Control: no-cache` for catalog and launcher checks, so it never trusts a stored answer even when the relay it talks to still runs the older headers.

  Verified by reproducing the stale read against a local server that returns the same cache headers: the second `net.fetch` was answered from cache with no request reaching the server, and the same URL with a cache-busting parameter returned the updated body.

  Fixing existing installs needs only a relay redeploy, because the new headers stop every client — including 0.3.4 — from caching the answer. A client built after this change also bypasses any relay that still sends the old headers.

## [0.4.5] — 2026-11-03

### Added

- **Publisher-folder save detection** — beyond the install folder and folders named after the product, detection now looks one level deeper for studio nesting: `%LOCALAPPDATA%\<Studio>\<Game>`, Unity's `LocalLow`, and `Company/Product` under Application Support or `.config`. Nested matches score one point below a direct match, so an exact top-level folder still wins.
- **Discard partial** — a cancelled or failed transfer keeps its `.part` file so the next attempt resumes; the Downloads view now offers **Discard partial** to reclaim that space immediately instead of waiting for the 14-day sweep. Backed by the `install:discard-partials` channel, which refuses while a download for that product is active.
- **Test relay** in **Settings → About**, with the relay's version, catalog size, and GitHub token state.

### Changed

- **The relay is automatic.** The launcher dials the relay baked in at build time (`MAIN_VITE_BACKEND_URL`, otherwise the hosted service, otherwise the local relay in development) and replaces a stored address from an older build at launch.
- **Relay rate-limit handling.** The relay reads `Retry-After` and `x-ratelimit-reset` from GitHub, includes the wait in its error text, and answers asset downloads with `429` plus `Retry-After` when GitHub is rate limiting. The launcher honours that header (capped at 8s), adds jitter to its own retry delays, and both user agents now report the real version instead of `0.2`.
- **What's New card** rewritten for 0.4.5 to summarise everything since 0.3: themes, play history, resumable downloads, library tools, saves, offline catalog, keyboard shortcuts, and the automatic relay.
- Error and hint copy no longer points at a relay address field, because there is not one.

### Removed

- **Settings → Connection tab.** It only existed to edit the relay URL and run a health check; the URL is now fixed at build time and the check moved to About.
- The relay status chip in the status bar is no longer a button to that tab; it still reveals the host and any last error on hover or focus.

## [0.4.0] — 2026-11-02

The largest release so far: the launcher gained persistence, resume, and library tooling, and the theme system was rebuilt around families.

### Added

- **Persisted play sessions** — a new `PlayStateStore` (`src/main/playState.ts`) records running processes, start times, and playtime in `<userData>/play-state.json`. Sessions survive a launcher restart, dead PIDs are reaped on load, and updates/uninstalls stay blocked while a product is still running.
- **Play history** — last played, total playtime, and launch count per product, shown on library cards, in the drawer, and used by the new "recently played" sort.
- **Resumable downloads** — interrupted transfers continue from a `<productId>-<hash>.part` file with an HTTP `Range` request. A SHA-256 digest is verified across the prefix and appended bytes; servers that ignore `Range` fall back to a clean restart, and a 416 response triggers a fresh attempt. Partials are swept after 14 days, on uninstall, and after a successful install.
- **Relay range mirroring** — the relay now passes `Range` through to GitHub and mirrors `206 Partial Content` / `Content-Range` / `Accept-Ranges`, so private assets streamed through the relay resume as well.
- **Update all** — sequential update of every outdated product from the library toolbar, with progress and skipped-version awareness.
- **Skip this version** — per-product skip stored in `config.skippedUpdates`; skipped releases stop prompting, stop counting in "Update all", and are listed in Settings with **Update again**.
- **Library search and sort** — search across name, id, repository, and description; sort by name, recently played, or size; plus an updates-only filter.
- **Save tools** — save-folder detection (install folder first, then platform user-data locations), **Open folder**, and one-click `.tar.gz` backup into `<userData>/backups`.
- **Offline catalog cache** — the last resolved catalog is cached in `<userData>/cache/catalog-*.json` and reused when the relay is unreachable; the status bar labels it "Relay offline · cached".
- **Window bounds memory** — size and position are remembered per layout preset (compact/cozy/spacious) and restored on the next launch.
- **Command palette** — `Ctrl/Cmd + K` searches views, products, and maintenance actions; `Ctrl/Cmd + 1-4` switches views; a titlebar button opens the palette.
- **Repair install** — re-download and reinstall a product whose recorded executable has gone missing.
- **Five new theme families** — Vapor, Terminal, Arcade, Night, and Mono, each in dark and light variants, for twenty-two themes across eleven families. Every family changes typography, geometry, and texture in addition to colour; Mono doubles as a high-contrast option.
- **Grouped theme picker** — themes are grouped by family with All/Dark/Light filtering and family-specific preview treatments.

### Changed

- All product version comparisons and labels go through one `versionFromRelease()` helper (`shared/version.ts`) instead of reading `release.name` directly, so cards, the drawer, update prompts, and the self-updater agree on the same version.
- The status bar distinguishes a cached catalog from a live one instead of reporting an error.
- `README.md` documents the new features, file locations, resume behaviour, theme families, and limitations.

### Fixed

- Product cards and the drawer displayed the release title where a version belonged, which could hide or invent updates.
- The packaged window icon pointed at a path that only exists in development; it now falls back to `out/renderer/app-icon.png`.
- The launcher could fail to start if the install root was unwritable; config persistence now treats directory creation as best-effort and logs failures instead of throwing during boot.

## [0.3.4] — 2026-10-30

### Fixed

- Launcher self-update extraction and handoff: the downloaded installer is unpacked or executed reliably, and the relaunch helper survives the launcher exiting.

## [0.3.0] — 2026-10-30

### Added

- In-app launcher updates from the launcher's own GitHub releases, including download through the relay, digest verification, and relaunch.
- The first theme system with multiple palettes and instant switching.

## 0.2.0 and 0.1.0

Releases before 0.3.0 predate this changelog. In short: 0.2.0 brought self-installation and the relay-backed catalog, and 0.1.0 was the first release with catalog listing, install, launch, and uninstall.

[Unreleased]: https://github.com/MustacheHax/MCM98_Launcher/compare/v0.4.7...HEAD
[0.4.7]: https://github.com/MustacheHax/MCM98_Launcher/compare/v0.4.5...v0.4.7
[0.4.5]: https://github.com/MustacheHax/MCM98_Launcher/compare/v0.4.0...v0.4.5
[0.4.0]: https://github.com/MustacheHax/MCM98_Launcher/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/MustacheHax/MCM98_Launcher/compare/v0.3.0...v0.3.4
[0.3.0]: https://github.com/MustacheHax/MCM98_Launcher/compare/v0.1.0...v0.3.0
[0.1.0]: https://github.com/MustacheHax/MCM98_Launcher/releases/tag/v0.1.0
