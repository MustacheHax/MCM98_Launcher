# Roadmap

Planned releases for the MCM98 Launcher and its relay, and the version each kind of change ships under. Shipped work is recorded in [CHANGELOG.md](CHANGELOG.md); this file is intent, not a promise, and it is re-ordered as priorities change.

Current release: **0.4.7**.

## How versions are chosen

The launcher and relay share one version number and are released from the same commit, so `package.json` and `server/package.json` always match.

| Change | Bump | Example |
| --- | --- | --- |
| Docs, copy, comments, build metadata | patch | README corrections, a reworded error |
| Bug fix with no data or contract change | patch | resolver edge case, save detection for one more layout |
| New feature, new persisted field, new theme | minor | save restore, version picker, a new theme family |
| Contract change older builds cannot read (manifest, config, catalog) | minor **with an in-place migration** | adding a manifest field |
| Breaking relay API change, dropped OS/format support, or the stability gate | major | removing `/api/catalog`, requiring signing |

Rules of thumb:

- Never ship a feature in a patch. If the update prompt needs release notes, it is a minor.
- A minor must migrate any config, `install.json`, or `play-state.json` it touches so a 0.4.x install upgrades silently.
- Themes and other purely local appearance changes are minor and never require a migration.
- A patch must not change the relay response shape. Adding an optional field is a minor.

## 0.4.5 — shipped 2026-11-03

Patch. No data or contract changes, so a 0.4.0 install upgrades in place.

- **Save detection for publisher-subfolder layouts.** Detection now also looks inside studio folders (`%LOCALAPPDATA%\<Studio>\<Game>`, Unity's `LocalLow`, and `Company/Product` nesting under Application Support and `.config`), scored slightly below a direct name match.
- **Repair for corrupt installs.** Already covered: the library reports a deleted executable as missing and the UI offers **Repair install**. Verified, no change needed.
- **Discard a retained partial.** A cancelled or failed transfer now offers **Discard partial** in the Downloads view, backed by a new `install:discard-partials` channel.
- **Relay rate-limit politeness.** The relay reads `Retry-After` and `x-ratelimit-reset` from GitHub, reports the wait in its errors, and answers `429` with `Retry-After` on asset downloads. The launcher honours the header, caps the wait at 8s, and adds jitter to its own retries. Both user agents now carry the real version.
- **Automatic relay.** The launcher dials the relay baked in at build time and replaces any stored address, so the **Connection** settings tab is gone. The address and a **Test relay** button live in **Settings → About**.
- **What's New card** rewritten to summarise every change since 0.3.

Deferred from this list: a repeatable `npm test` suite, shipped in 0.4.7.

## 0.4.7 — shipped 2026-11-03

- **Update-check caching fix.** The relay no longer reuses a 5-minute GitHub snapshot for the launcher's own release, and neither `/api/launcher` nor a client may cache the answer; the client also bypasses caches on every check. The relay half fixes existing installs on redeploy; this build carries the client half.
- **Repeatable tests.** `npm test` now runs twelve checks over the downloader, the play-state store, and save detection. The relay range check stays manual because it needs a live GitHub asset.
- **Polish:** no leftover connection-tab surface needed changing — the status chip, About panel, and catalog error copy were already clean.

## 0.5.0 — saves, notes, and versions

Minor. Ships release notes; migrates nothing in the config except an optional `favourites` list.

- **Restore a save backup.** Pick a `.tar.gz` from `<userData>/backups`, confirm the overwrite, extract it back into the detected save folder with the same path-traversal guards used for installs. Closes the gap called out in the README limitations.
- **Patch notes per product.** The relay already returns release notes and metadata; show them in the drawer instead of only linking to GitHub, with the newest entry expanded.
- **Version picker and rollback.** Let the user install an earlier release of a product (the relay can list releases), and keep one previous `app/` folder for a one-click local rollback. Replaces the current "crash recovery only" behaviour.
- **Favourites and manual order.** Pin products to the top of the library and drag to reorder, stored per user.

## 0.6.0 — portability and transfer control

Minor.

- **Library export/import.** Write a portable manifest describing installed products, versions, and save locations so a library can be moved between machines without re-downloading everything.
- **Parallel chunked downloads with a bandwidth cap.** Resume works today but over a single connection; add configurable connections and a speed limit for shared connections.
- **Portable mode.** An opt-in mode that keeps config, library, and play state next to the executable instead of in `userData`, for USB or shared-machine use.

## 0.7.0 — profiles and access

Minor, but the largest structural change since 0.2.0. Introduce the profile schema and migrate the existing single-user config into a default profile.

- **Local profiles.** Per-profile library, play history, and save root, switchable from the titlebar.
- **Relay access control.** Replace the public catalog endpoints with token-scoped requests so a relay holding a private-repo `GITHUB_TOKEN` is not open to anyone who finds the URL. Keep a read-only anonymous mode for public catalogs.
- **Entitlements.** Filter the relay catalog by what a profile is allowed to see, which is the prerequisite for shipping any paid or invite-only product through the launcher.

## 1.0.0 — trustworthy distribution

Major. The stability gate: after 1.0.0 the manifest, config, and relay API are documented contracts.

- **Code signing on Windows and notarization on macOS.** Removes the SmartScreen and Gatekeeper warnings the README still lists as a limitation.
- **macOS in-place updates.** Replace the `.app` bundle instead of opening the DMG in Finder.
- **Frozen schemas with explicit migrations.** Version `config.json`, `install.json`, and `play-state.json`, and refuse rather than guess when a schema is newer than the build.
- **Versioned relay API.** Move to `/api/v1` with a documented compatibility note, keeping `/api/*` as a redirect for one release.
- **Delta updates.** Optional, only if the transfer work in 0.6.0 shows it is worth the signing and verification complexity.

## Release checklist

Copy this into the release commit or issue for each version:

1. Bump `version` in `package.json` **and** `server/package.json` (both lockfiles follow with `npm version <x.y.z> --no-git-tag-version`).
2. Move the shipped items from this file into a new `CHANGELOG.md` section, and add the compare link at the bottom.
3. Update `README.md` if behaviour, file locations, themes, or limitations changed — including the "current app version" line in **Publishing a launcher update**.
4. `npm run typecheck`, `npm --prefix server run typecheck`, `npm --prefix server run build`, `npm run build`, `npx electron . --smoke-test`.
5. Build artifacts with `npm run dist:win` (plus the macOS/Linux commands) and confirm the filenames match the pattern the self-updater expects: `MCM98 Launcher-<version>-win-x64.exe`.
6. Publish a stable GitHub Release tagged `v<version>` with the installer attached. Drafts and prereleases are ignored by the updater.
7. Redeploy the relay if `LAUNCHER_REPO`, `CATALOG_PATH`, or the response shape changed.
8. Verify the update prompt on the previous version before announcing.
