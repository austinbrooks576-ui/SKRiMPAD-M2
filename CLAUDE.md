# Working on SKRiMPAD

## Standing procedure: post the links

**Every time a build publishes a release, post the download links in the chat.**
Not "it's building", not "check the releases page" — the actual links, newest
per edition and platform, with one line on what changed.

A release nobody can find is a release nobody installed. The whole point of
shipping continuously is that the person who asked for a thing can go and use
it, and that does not happen if finding it means scrolling a releases page with
two hundred tags on it, most of them for other editions.

**How to get them:** `mcp__github__list_releases` on `austinbrooks576-ui/SKRiMPAD-M2`
with `fields: ["tag_name","name","html_url","published_at"]`. Sort by
`published_at` — **not** by tag name, because `v1.0.9` sorts after `v1.0.21`
as a string and you will confidently link a build from two days ago. Take the
newest of each prefix.

**When:** after the workflow run actually finishes and is green. Do not post a
link to a tag that does not exist yet, and do not post a green summary for a run
that is still going.

**Tag prefixes → what they are:**

| Prefix | Edition | Platform |
|---|---|---|
| `ultimate-win-` | ULTIMATE | Windows installer + portable |
| `ultimate-mac-` | ULTIMATE | macOS `.dmg` / `.zip`, arm64 + x64 |
| `ultimate-v` | ULTIMATE | Android APK |
| `ultimate-web-` | ULTIMATE | installable web app (PWA) zip |
| `win-v` / `v` | M2 (consumer) | Windows / Android |
| `se-win-` / `se-v` | Special Edition | Windows / Android |
| `vga-win-` / `vga-v` | VGA | Windows / Android |
| `livex-win-` / `livex-v` | LIVEx | Windows / Android |
| `jp-win-` / `jp-v` | JP | Windows / Android |
| `smk-win-` / `smk-v` | SMK (M-VAVE SMK-25) | Windows / Android |

**Always say with the macOS link** that it is unsigned — first launch is
right-click → Open — and that it does not auto-update. Leaving that out means
someone hits Gatekeeper, believes the build is broken, and throws it away.

**Always say with the web link** that Add to Home Screen needs the hosted URL,
not the zip; a page opened from a local file cannot register a service worker.

## A red build is not automatically a broken app

Two things in CI download from the internet and neither of them is the repo:
the gradle wrapper fetching its distribution, and Electron's postinstall
fetching its ~100MB binary. Both have failed mid-download and taken a build
down with them — `SocketException: Unexpected end of file from server` and
`RequestError: socket hang up`, with nothing wrong in the code at all.

Both are retried three times with a backoff now. **Read the log before
changing any app code in response to a red build**, because the fix for a
socket hang up is not in the app, and a day spent "fixing" working audio code
is a day lost.

`test/workflows.cjs` runs those retry loops for real — it pulls each one out
of the YAML and executes it under the shell GitHub uses against a stub that
fails on demand. Run it after touching any workflow. A retry loop only
executes on the bad day, so it has to be tested on a good one.

## Branches

ULTIMATE is developed on `claude/skrimpad-ultimate` and pushed only there.
M2/SE/VGA share `android/app/src/main/assets/index.html`; LIVEx is separate
under `livex/`.

## The documentation rule

Every feature must be written up in the in-app HELP page in the same commit
that adds it. This is enforced: a test asserts that every `button[id]`,
`input[id]` and `[role=slider][id]` in the app appears in `HELP`, and that every
selector `HELP` names actually resolves. An undocumented control and a
documented ghost both fail the build.

New releases also get an entry at the top of `RELEASES` in
`ultimate/src/index.html` — one list, newest first. Do not go back to a chain of
separately named constants; that is how `WHATS_NEW_2` ended up declared twice
and a whole release silently vanished from the help page.

## Secrets

Nothing secret is committed. `.env`, `node_modules` and
`play-service-account.json` stay out of the tree. API keys are pasted into
`backend/.env` by the repository owner — never ask for them, never handle
account credentials, and never log into payment or store accounts.
