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
