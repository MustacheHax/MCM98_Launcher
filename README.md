# MCM98 Launcher

A Windows/macOS/Linux desktop launcher and updater for MCM98 games and applications. It lists the repositories you choose, resolves their newest GitHub Releases through a small relay on Render, downloads the right build for the user's platform, verifies it, installs it into a local library, and launches it.

This first version is intentionally account-free: no Entra/SSO, profiles, entitlements, or game keys. It is a launcher and product updater, not a storefront yet.

```
GitHub Releases ──► Render relay ──► Electron launcher ──► local library ──► game/app
                  (catalog, asset    (download, verify,
                   resolution)        install, launch)
```

## What is included

- **Desktop launcher** — Electron + React + TypeScript, twelve complete appearance themes, generated cover art, install/update/play/uninstall flows, download queue, settings, logs.
- **Relay** — Express + TypeScript API suitable for Render. It reads a developer-owned catalog, resolves GitHub releases server-side, caches responses, and streams private release assets without exposing a GitHub token.
- **In-app launcher updates** — the relay resolves the launcher's own GitHub releases; the app downloads the installer through the relay, verifies its digest, replaces itself after quitting, and relaunches. **Release notes** remains available in Settings as a fallback.
- **Shared contract** — one set of API/IPC types consumed by both sides.
- **Render Blueprint** — `render.yaml` provisions the web service.
- **Demo mode** — the renderer can run in a browser with sample data for UI work (`npm run dev:ui`).

The launcher **installs prebuilt release artifacts**. It does not run a compiler or build source code on the user's machine. Export your game or app, attach the build to a GitHub Release, and the launcher prepares the playable local install from that archive or portable executable.

## Project layout

```
.
├─ src/
│  ├─ main/             Electron main process
│  │  ├─ index.ts       window, lifecycle, IPC
│  │  ├─ relay.ts       relay client with cold-start retries
│  │  ├─ installer.ts   install queue, staging, atomic swaps, recovery
│  │  ├─ download.ts    streamed download + SHA-256 verification
│  │  ├─ archive.ts     safe zip/tar.gz extraction
│  │  ├─ detect.ts      executable detection
│  │  ├─ launch.ts      detached process launching and tracking
│  │  └─ library.ts     installed-product manifests
│  ├─ preload/          typed contextBridge API
│  └─ renderer/         React UI (+ browser demo bridge)
├─ server/              Render relay service
│  ├─ src/              Express app, GitHub resolver, cache
│  ├─ catalog.json      selected repositories (edit this)
│  └─ catalog.example.json
├─ shared/              API and desktop type contracts
├─ render.yaml          Render Blueprint
└─ electron-builder.yml packaging targets
```

## Quick start

Requirements: Node.js 22.12 or newer, npm, and (for packaging) the platform toolchains electron-builder needs.

```bash
npm install
npm --prefix server install
```

Create a catalog with at least one repository:

```bash
cp server/catalog.example.json server/catalog.json
```

Edit `server/catalog.json` for your repositories, then run the relay and launcher in separate terminals:

```bash
npm --prefix server run dev
```

```bash
npm run dev
```

Packaged builds default to the hosted relay at `https://mcm98-launcher.onrender.com`. Running from source with `npm run dev` defaults to the local relay at `http://localhost:8790`; if another service uses that port, start the relay with `PORT=8791` and point **Settings** at it (or set `MAIN_VITE_BACKEND_URL`). Existing configs that still contain the old localhost default are upgraded to the hosted relay once on launch.

To preview the UI without Electron (sample data, simulated installs):

```bash
npm run dev:ui
```

Then open `http://localhost:5174`.

## Themes

**Settings → Appearance** switches between twelve complete themes. Each family changes typography, corner geometry, surfaces, borders, and control treatment, not only its palette:

- **Graffiti Dark / Light** — the wordmark's cyan, magenta, and orange as the default for new installs.
- **Modern Dark / Light** — the original graphite-and-lime shell and a daylight counterpart.
- **90s Retro Dark / Light** — scanlines, square beveled controls, terminal and desktop type.
- **Bubbly Dark / Light** — rounded display type, pill controls, pastel gradients, oversized radii.
- **Rocker Dark / Light** — condensed italic display type, clipped corners, stage-red accents.
- **Ghost Dark / Light** — fog, translucent glass panels, hairline rules, serif display type.

The theme id is stored in `config.json` and cached in local storage so the window paints the right colours immediately on the next launch. It is applied instantly; no restart is needed. Existing installs keep their saved theme; Graffiti is only the starting point for new ones.

The same tab sets **text size** (Small, Default, Large, Extra large). It scales type through a CSS multiplier, so buttons, the icon rail, and window bounds keep their geometry. The bottom status bar shows relay health — hover it for the address, catalog age, and any error.

## Publishing a product

1. **Export a playable build.** For a Summer/Godot game, export a Windows executable build, a Linux build, and/or a macOS `.app` bundle.
2. **Package it.** Supported formats are `.zip`, `.tar.gz`, `.tgz`, a portable Windows `.exe`, or a Linux `.AppImage`.
   - Windows: a `.zip` with the `.exe` and its data files, or one self-contained portable `.exe`.
   - Linux: a `.tar.gz` (or `.zip`) with the executable bit preserved, or an `.AppImage`.
   - macOS: a `.zip` containing the `.app` bundle. The launcher reads `Contents/Info.plist` to find the bundle executable.
3. **Publish a GitHub Release.** Use a version tag such as `v1.2.0`. Drafts are ignored; prereleases are ignored unless `includePrereleases` is enabled.
4. **Attach the builds** as release assets. Asset names should identify the platform and architecture, for example:
   - `HollowSignal-win64.zip`
   - `HollowSignal-linux-x86_64.tar.gz`
   - `HollowSignal-macos-universal.zip`
   - `HollowSignal-portable.exe`
5. **Add the product to the relay catalog** and redeploy the relay.
6. In the launcher, refresh the catalog. Users can install or update from there.

### Catalog entry

`server/catalog.json`:

```json
{
  "products": [
    {
      "id": "hollow-signal",
      "name": "Hollow Signal",
      "repo": "MCM98/hollow-signal",
      "summary": "A short survival-horror vignette set in a decommissioned radio array.",
      "tags": ["game", "horror"],
      "featured": true,
      "platforms": {
        "win32": {
          "asset": "*win64*.zip",
          "executable": "HollowSignal.exe"
        },
        "linux": {
          "asset": "*linux*x86_64*.tar.gz",
          "executable": "HollowSignal.x86_64"
        }
      }
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable product id: lowercase letters, numbers, dashes. Used as the install folder name. |
| `repo` | yes | GitHub repository in `owner/name` form. |
| `name` | no | Display name. Falls back to the repository name. |
| `summary` | no | Overrides the GitHub repository description. |
| `tags` | no | Up to eight display tags. Falls back to repository topics. |
| `featured` | no | Picks the large hero card in the catalog (the first featured ready product). |
| `includePrereleases` | no | Uses the newest non-draft prerelease too. Default `false`. |
| `platforms` | no | Per-OS asset rules. If omitted, the relay auto-detects archives and portable executables from their names. |

Each platform rule supports:

- `asset` — a case-insensitive glob such as `*win64*.zip` or `*Portable*.exe`. If several assets match, the relay prefers the product's main build over symbols, PDBs, checksums, and tooling archives.
- `executable` — optional path inside the archive. This is the most reliable way to launch. If omitted, the launcher scores likely executables (and reads macOS app bundles). For a single-file executable, omit it and the launcher uses the downloaded file.
- `args` — optional array of launch arguments.

When `platforms` is present, only those platforms are offered. Without it, the relay offers an archive on every platform unless asset names clearly identify a different OS. A single unnamed archive is treated as universal. A raw `.exe` is only offered on Windows, and a raw `.AppImage` is only offered on Linux.

Supported asset selection details:

- The relay considers `.zip`, `.tar.gz`, `.tgz`, portable `.exe` (Windows), and `.AppImage` (Linux) assets. Archives are preferred when a release offers both.
- Cross-platform asset names are not arch-aware beyond the glob you write. Use explicit patterns such as `*win64*.zip` when a release contains multiple architectures.
- GitHub's sha256 asset digest is passed to the launcher when GitHub provides one; the launcher verifies it after download.

## Publishing a launcher update

The launcher checks its own repository for stable GitHub Releases. By default this is `MustacheHax/MCM98_Launcher`; change it on the relay with `LAUNCHER_REPO`.

1. Set `version` in `package.json` to the next semantic version, for example `0.3.0`.
2. Build the installer with `npm run dist:win` (and the platform-specific command for macOS/Linux).
3. Publish a **stable** GitHub Release tagged `v0.3.0` (or `0.3.0`) and attach the launcher artifact:
   - Windows: `MCM98 Launcher-0.3.0-win-x64.exe` or a Windows `.zip`
   - macOS: a `.dmg` or macOS `.zip`
   - Linux: an `.AppImage`, `.tar.gz`, or `.zip`
4. Redeploy the relay if `LAUNCHER_REPO` changed. The launcher checks on startup, every six hours, and when **Check now** is clicked in Settings.

The app compares the release version with its own and only prompts when the release is newer. Semantic versions are read from the tag first, then from the asset name and release title, so a rolling tag such as `newest` still resolves to a comparable version. **Update now** downloads the build through the relay, verifies GitHub's digest when present, and hands off to a small detached helper. The helper waits for the launcher to exit, runs the NSIS installer (or copies a portable zip / AppImage / archive into place), and relaunches the launcher. On macOS, the downloaded DMG or zip is opened in Finder and the user finishes the drag-install. The published release must not be a prerelease or draft.

The current app version is `0.3.4`. If the newest release has no comparable version at all, Settings explains that instead of offering a bogus update.

Self-installation arrived in 0.2.0. Install 0.2.0 or newer manually once (run `release/MCM98 Launcher-0.3.4-win-x64.exe` after attaching it to the release); every later version can then update from inside the running launcher. A 0.1.0 build can only detect the release and open GitHub.

## Deploying the relay to Render

### Blueprint (recommended)

1. Push this repository to GitHub.
2. In Render, choose **New → Blueprint** and select the repository. `render.yaml` creates `mcm98-launcher-api`.
3. Set `GITHUB_TOKEN` when prompted (it is marked `sync: false`, so it is never stored in the repository). Use a fine-grained personal access token, not a GitHub App private key or JWT; see [GitHub token for private repositories](#github-token-for-private-repositories).
4. Deploy. Copy the service URL, for example `https://mcm98-launcher.onrender.com` (the address official builds use).
5. Put that URL into the launcher's **Settings**, or bake it in at build time with `MAIN_VITE_BACKEND_URL`.

### Manual web service

- Root directory: `server`
- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Health check path: `/api/health`
- Runtime: Node 22.12+

### GitHub token for private repositories

The relay needs a **personal access token** that can read the repository. The simplest option is a fine-grained token:

1. In GitHub, open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Under **Repository access**, choose **Only select repositories** and select every private repository the relay must read — for example, `MustacheHax/StreamFriend` and `MustacheHax/MCM98_Launcher` (the launcher update source).
3. Under **Permissions → Repository permissions**, set **Contents** to **Read-only**. **Metadata** is included automatically.
4. Generate the token and copy the value beginning with `github_pat_`.
5. In Render, open the relay service → **Environment**, set `GITHUB_TOKEN` to exactly that value, and save. The value must not include quotes, `Bearer`, or line breaks.
6. Redeploy the relay and refresh the launcher.

Do **not** put any of these in `GITHUB_TOKEN`:

- A GitHub App **private key** (the `-----BEGIN … PRIVATE KEY-----` block, or its base64 body starting with `MII`).
- A GitHub App **JWT** (starts with `eyJ`). It is only accepted by GitHub's `/app` endpoints, not repository endpoints.
- A GitHub App **client secret**, password, or OAuth client secret.

A GitHub App **installation access token** (`ghs_…`) also works with the relay, but GitHub expires those tokens after one hour, so a fine-grained PAT is more practical for a Render environment variable. The relay validates `GITHUB_TOKEN` at startup and rejects private keys, JWTs, and unrecognized values before contacting GitHub.

### Relay environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | unset | GitHub API token. Strongly recommended. Required for private repositories. Use a fine-grained personal access token with read-only Contents access. Never use a GitHub App private key or JWT. |
| `LAUNCHER_REPO` | `MustacheHax/MCM98_Launcher` | Repository whose stable GitHub Releases are checked for launcher updates. |
| `CATALOG_PATH` | `server/catalog.json` | Alternate catalog file path. |
| `PUBLIC_BASE_URL` | request origin | Public relay base used to build private-asset download URLs. Set this when behind a custom domain/proxy. |
| `CACHE_TTL_SECONDS` | `300` | How long resolved GitHub releases stay cached in memory. |
| `PORT` | `8790` | HTTP port. Render sets this automatically. |
| `FORCE_RELAY` | unset | Set to `1` to route even public assets through the relay (useful for testing the streaming path). |
| `NODE_VERSION` | `22.12.0` | Render build-time Node version, set in `render.yaml`. |

GitHub's unauthenticated API limit is 60 requests/hour per IP, which a catalog refresh can consume. Set `GITHUB_TOKEN` for any real deployment. Resolution failures are isolated per product so one broken repository does not take down the catalog.

### Relay API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Service version, catalog size, and whether a GitHub token is configured. |
| `GET /api/catalog?platform=win32` | Resolved catalog for `win32`, `linux`, or `darwin`. |
| `GET /api/launcher?platform=win32` | Newest stable launcher release, matching installer asset, download URL, and digest. |
| `GET /api/launcher/download?platform=win32` | Streams the launcher installer through the relay, or redirects to GitHub for public assets. |
| `GET /api/download/:productId?platform=win32` | Streams a private asset through the relay, or redirects to GitHub for public assets. |

The catalog response includes the latest release tag, release notes, asset name/size/digest, a platform-specific download URL, available platforms, and the configured executable hint.

Render's free tier sleeps. The desktop client retries the catalog request and explains that the relay may be waking; the first request after idle can take up to a minute.

## Building the desktop app

```bash
npm run typecheck     # main/preload + renderer
npm run build         # typecheck, then electron-vite production bundle
npm run dist:win      # NSIS installer + portable zip
npm run dist:mac      # DMG + zip
npm run dist:linux    # AppImage
```

Packaged output goes to `release/`.

Packaged builds already point at `https://mcm98-launcher.onrender.com`. To ship a different relay, set it before building:

```bash
cp .env.example .env
# MAIN_VITE_BACKEND_URL=https://your-service.onrender.com
npm run dist:win
```

Users can still override the relay in Settings after installation.

### Where files live

- Settings and logs: Electron's `userData` folder (Windows: `%APPDATA%\MCM98 Launcher`).
- Launcher log: `<userData>/logs/launcher.log`.
- Installed products: `<userData>/Library` by default, configurable in Settings. Each product has an `app/` folder and an `install.json` manifest.

Changing the install folder does not move existing installs.

## How installs and updates work

1. The launcher asks the relay for the catalog for the current platform.
2. The relay resolves `releases/latest` (or the newest prerelease), selects a build, and returns the asset metadata.
3. The launcher downloads the asset to a temporary folder inside the library. Public assets come directly from GitHub; private assets are streamed by the relay.
4. The SHA-256 digest is verified when GitHub supplied one.
5. Archives are extracted into a staging folder with path-traversal protection; a single-file executable is moved into the staging folder as-is.
6. The launcher detects or uses the configured executable.
7. The previous `app/` folder is moved aside, the staging folder becomes the new `app/`, the manifest is written, and the previous version is removed. If anything fails, the previous version is restored.
8. The app is launched detached, so closing the launcher does not close the game.
9. An update is available when the installed version is older than the newest release tag. Updates are blocked while that product is running.

On startup the launcher repairs interrupted updates, restores a previous `app/` folder when possible, and clears abandoned staging/download folders.

## Security notes

- The Electron renderer is sandboxed with context isolation, no Node integration, a restricted preload bridge, and a content security policy.
- Downloads are limited to GitHub hosts and the configured relay. Checksums are verified when available. Archive paths and install/manifest paths are checked against traversal.
- The launcher executes programs from release assets. Treat write access to the catalog repositories and the relay as code-execution trust.
- **The relay has no user authentication yet.** Its catalog endpoints are public. If you give the relay a token that can read private repositories, anyone who discovers the relay URL can list those products and request their assets through `/api/download`. Keep the deployed catalog public-only until SSO/profiles/entitlements exist, or put the relay behind your own access control.
- GitHub tokens stay on the relay and are never sent to the launcher. Relay errors are scrubbed so a credential is not echoed back to clients or written to logs. Never store a GitHub App private key in `GITHUB_TOKEN`; if a credential is exposed, revoke or rotate it immediately.
- Release notes and metadata are rendered as text, not HTML.

## Current limitations and next steps

- No accounts, profiles, SSO, game keys, or per-user entitlements yet.
- Windows/Linux launcher updates install in place after the app exits. macOS opens the downloaded DMG/zip in Finder instead of replacing the `.app` bundle automatically.
- Launcher updates are unsigned, like product builds. Windows SmartScreen may still warn on the helper-run installer.
- No resumable downloads, delta updates, or parallel chunking.
- No 7z, DMG, or MSI installation. Supported formats are archives, portable Windows `.exe`, and Linux `.AppImage`.
- No code signing on Windows or notarization on macOS. Users may see SmartScreen/Gatekeeper warnings; production distribution needs signing.
- No custom application icon is wired into electron-builder yet (the renderer uses the MCM98 mark).
- The relay cache is in memory and resets on redeploy.
- No per-release arch metadata; use explicit asset globs.
- Rollback is crash-recovery only, not a user-facing version picker.

Natural next steps: SSO profiles and entitlements, automatic launcher installer replacement, save/data management, per-product news and patch notes, and relay-side access control.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Electron app with Vite hot reload. |
| `npm run dev:ui` | Renderer-only browser preview with demo data on port 5174. |
| `npm run typecheck` | Type-check main/preload and renderer. |
| `npm run build` | Type-check and build the Electron app. |
| `npm run start` | Launch the production bundle through electron-vite preview. |
| `npm run dist:*` | Build platform installers into `release/`. |
| `npm --prefix server run dev` | Relay with file watching. |
| `npm --prefix server run build` | Bundle the relay into `server/dist`. |
| `npm --prefix server start` | Run the built relay. |

The Electron smoke test used during development is:

```bash
npm run build
npx electron . --smoke-test
```

It opens a hidden window, checks that the preload bridge exists and the React UI rendered, then exits.

## Troubleshooting

- **"The relay is not answering"** — confirm the Render service is awake and the URL in Settings is exactly the service URL, with no trailing path. Free instances can take up to a minute to wake.
- **"No launcher release has been published yet"** — publish a stable release in `LAUNCHER_REPO` with a Windows `.exe`/`.zip`, macOS `.dmg`/`.zip`, or Linux `.AppImage`/`.tar.gz` asset. Drafts and prereleases are ignored.
- **Launcher update prompt does not appear** — confirm the release is newer than `package.json`. The version is read from the tag, then the asset name, then the release title, so a rolling tag such as `newest` works as long as the build asset or title contains a semantic version such as `0.3.0`. The release also needs an asset for the current platform.
- **Launcher update download or install fails** — the relay must be reachable and able to resolve `LAUNCHER_REPO`; the build must be an NSIS `.exe` or portable `.zip` on Windows, an AppImage or archive on Linux. On macOS the downloaded file is opened in Finder. In-app installation is disabled when running from source (`npm run dev`).
- **A theme looks wrong after switching** — themes are applied instantly and saved in `config.json`. Switch back to **Graffiti Dark** in Settings → Appearance; the theme is also cached locally for the next start.
- **"The relay's GITHUB_TOKEN is not usable..."** — the relay rejected the credential before contacting GitHub. Usually `GITHUB_TOKEN` holds a GitHub App private key, an App JWT, or a malformed value. Replace it with a fine-grained personal access token as described in [GitHub token for private repositories](#github-token-for-private-repositories). Rotate any private key that was pasted into the variable.
- **"GitHub rejected the configured GITHUB_TOKEN"** — the token is expired, revoked, or lacks access to the repository. Generate a fresh fine-grained token with Contents read access and update the Render environment variable.
- **"Repository not found, or it is private..."** — set `GITHUB_TOKEN` on the relay. For public repositories, also confirm `repo` is `owner/name` and the release is published (not a draft).
- **"No installable build"** — attach a `.zip`, `.tar.gz`, `.tgz`, portable `.exe` (Windows), or `.AppImage` (Linux); adjust the platform `asset` glob. If the release is a prerelease, set `includePrereleases: true`.
- **"No runnable executable was found"** — set `platforms.<os>.executable` to the path inside the archive and republish.
- **Windows SmartScreen warning** — the installer and product builds are unsigned. Use **More info → Run anyway** for your own builds, or sign them for distribution.
- **Update fails with an access/busy error** — close the product and any related background process, then retry.
- **Relay port already in use locally** — run `PORT=8791 npm --prefix server run dev` and update the Settings URL to `http://localhost:8791` (development builds only; packaged builds use the hosted relay).
- **GitHub rate limit** — add `GITHUB_TOKEN` to the relay or raise `CACHE_TTL_SECONDS`.
