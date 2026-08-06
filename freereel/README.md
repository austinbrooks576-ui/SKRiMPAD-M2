# FREEREEL

A cross-platform finder for **free, legal streaming in the United States** — every
no-subscription platform worth knowing about, a personalised watchlist, live TV
and news, and a family section with parental-control setup that actually holds
on shared hardware.

No accounts, no tracking, no network calls. The whole catalogue ships inside the
app and everything you save stays in `localStorage` on your device.

## What it answers

| Section | What it does |
|---|---|
| **Tonight** | Pick a mood and how long you've got; get a shortlist. |
| **List** | Personalised watchlist by taste, with where each title is free and why it's there. Saves across sessions. |
| **Platforms** | Every free legal US service, filtered by what it offers and which device you're on. Plus the ones that shut down, so you stop hunting for them. |
| **Hidden** | Lesser-known libraries and broadcaster platforms — the library-card tier, restoration-quality cult channels, public-domain archives. |
| **Live** | Free live news (national and international), sport, and channel grids. |
| **Family** | Age-filtered lists for a 6–12 year old and a teenager, plus parental controls in the order worth doing them. |

An **Adults / Teen / Kids** switch in the header filters every section by
age at once — the Kids profile only ever shows titles rated 10 and under.

## Running it

### Web (any browser, any OS)

Open `app/index.html`. No server, no build step. It also installs as a PWA —
"Add to Home Screen" on iOS/Android, or the install button in a desktop browser —
and works offline after the first load.

To serve it properly (needed for the service worker):

```bash
cd freereel/app
python3 -m http.server 8080
```

### Desktop — Windows, macOS, Linux

```bash
cd freereel/electron
npm install
npm start              # run it

npm run build:win      # NSIS installer + portable .exe
npm run build:mac      # .dmg (x64 + arm64)
npm run build:linux    # AppImage + .deb
```

### Android

```bash
cd freereel/android
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

CI builds all three on push to `main` — see
[`.github/workflows/build-freereel.yml`](../.github/workflows/build-freereel.yml).

## Layout

```
freereel/
  app/            the entire application — this is the single source of truth
    index.html
    app.css
    app.js        rendering and state; no framework, no build
    data.js       the catalogue — edit this to update content
    sw.js         offline cache
  electron/       thin desktop shell
  android/        thin WebView shell
```

`app/` is copied into the Android APK by the `syncWebApp` Gradle task and into
the Electron bundle by `extraResources`, so there is exactly one copy of the app
and the shells can never drift from it.

## Updating the catalogue

Everything content-related lives in [`app/data.js`](app/data.js). Edit it and
every platform picks the change up on the next build — nothing else needs
touching.

- `PLATFORMS` — services, what each provides, signup requirements, devices
- `TITLES` — the watchlist, with `where`, `mood`, `age` and a rationale
- `LIVE` — news, sport and channel grids
- `CONTROLS` — parental-control setup
- `RETIRED` — services that no longer exist

Bump `CATALOG_UPDATED` when you touch it; the footer shows that date.

## Two design decisions worth knowing

**Free catalogues rot.** A film that's free on Tubi this month can be gone next
month, so a hardcoded list is wrong the day after you write it. Every title
therefore carries a live **"Free right now?"** lookup alongside its usual home,
and each one is tagged with how much you should trust the placement:

- `free forever` — public domain, cannot be taken away
- `stable` — rarely moves
- `verify` — rotates; check before you plan an evening on it

**Roku has no user profiles.** That means per-app filters are the only in-app
control and none of them cover the device as a whole. The Family section leads
with router-level DNS filtering for exactly that reason — it's the one change
that covers every screen in the house, including the Roku, at once.

## Scope

Everything listed is a rights-holder-sanctioned way to watch at no cost:
ad-supported services, public broadcasters, public-domain films, official studio
channels, and public library cards. Nothing here links to piracy, and the app
does not index adult content.
