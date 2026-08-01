# SKRiMPAD M2

A full-featured browser-based music production studio — available as an Android app and Windows desktop app.

## Features

- **20 Drum Pads** — synthesized kicks, snares, hi-hats, cymbals, claps, bass & FX with per-pad volume faders
- **Step Sequencer** — 20-track × 16-step drum machine with BPM control and universal play/pause
- **Sound Library** — 14 onboard synthesized sounds across 5 categories (KICKS, SNARES, BASS, SYNTH, FX)
- **Dual/Layer Sampling** — load two samples per pad (WAV, MP3, OGG, AAC, FLAC)
- **Synthesizer** — dual-oscillator subtractive synth with ADSR envelope, filter, LFO, and wave shaper
- **Keyboard** — 2-octave piano with 6 voice modes: Electronic, Piano, Bass, Pad, LASER, ROBOT
- **FX Chain** — Drive, Delay, Reverb, Chorus, Phaser, Compressor, CLIP (hard/soft saturation pedal)
- **Loop Machine** — 4-track event looper with record/play/overdub
- **AI Composer** — real-time key detection + style-based drum & melody generation
- **Studio Layout** — fullscreen desktop mode with resizable tiles, skins, and drag-to-swap panels

## Downloads

Download the latest APK or Windows installer from [Releases](https://github.com/austinbrooks576-ui/SKRiMPAD-M2/releases).

### Android APK
1. Download `app-debug.apk`
2. On Android: Settings → Security → allow "Install unknown apps"
3. Open the APK to install

### Windows
- **Installer** — installs to Program Files with Start Menu + Desktop shortcuts
- **Portable** — runs from anywhere, no install needed

**Requirements:** Windows 10+ (64-bit)

### iPad / iPhone

There is no App Store build — iOS can't install an APK or an `.exe`. The studio
runs instead as a home-screen web app, which on an iPad is close to
indistinguishable from a native one: fullscreen, its own icon, and it works
offline once installed.

1. Open the hosted studio in **Safari** (Chrome on iOS can't install web apps)
2. Tap **Share** → **Add to Home Screen**
3. Launch it from the new icon — no Safari chrome, no address bar

Audio starts on your first tap, which is an iOS rule, not a bug: Safari keeps
the audio engine suspended until the page gets a real gesture.

**If you hear nothing,** check the iPad isn't in Silent Mode. The app asks for
the `playback` audio session so it should sound anyway, but that only works on
iPadOS 16.4+ — older versions follow the mute switch.

**Requirements:** iPadOS / iOS 15+ (16.4+ recommended)

## Build

### Android APK
```bash
cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### Windows (Electron)
```bash
cd electron
npm install
npm run build:win
# Output: electron/dist/
```

### Web
Open `android/app/src/main/assets/index.html` in any modern browser — no server needed.

### Web app / PWA (what the iPad installs)
Pushing to `main` publishes the landing page and the studio to GitHub Pages via
`.github/workflows/deploy-pages.yml` — the landing page at `/`, the installable
studio at `/app/`. This needs **Settings → Pages → Source = GitHub Actions**
enabled once; the workflow can also be run by hand from the Actions tab.

The home-screen shell lives in `web/` (manifest, service worker, icons). Icons
are generated, not committed by hand:

```bash
python3 scripts/make-icons.py    # regenerates web/icons/
```

To check it locally the way an iPad sees it, serve over http — `file://`
disables service workers, so Add to Home Screen won't offer offline support:

```bash
python3 -m http.server 8000      # then open http://localhost:8000/app/
```
