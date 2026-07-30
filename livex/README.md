# SKRiMPAD LIVEx

Plug in any controller — LIVEx identifies it, **learns** it, and draws a clean
top-down **schematic** of that exact hardware, then lets you play live. A fourth
edition of SKRiMPAD-M2, on branch `claude/skrimpad-livex`, alongside consumer / SE / VGA.

## What's here

- `src/` — the modular app (framework-free ES modules)
  - `core/identify.js` · `core/profiles.js` — regex + capability-probe controller ID
  - `core/devicecache.js` — learns every controller for instant recall
  - `core/schematic.js` — top-down SVG renderer (scales, windows big keyboards, contrary-color accidentals, full key legend)
  - `core/midi-io.js` — Web MIDI hot-plug · BLE-MIDI (driver-port-first, GATT fallback) · native Android bridge
  - `core/gamepad.js` · `core/router.js` — live input → lights up the board, A/B banks, octave, tap-to-play, window auto-follow
  - `core/device-manager.js` — displays + connects ALL controllers at once, one board each
  - `styles/theme.js` — skins + contrary-color
- `docs/` — `bluetooth.md` (the BLE fix), `SMK25-reference.md` (per-controller study standard), previews
- `ARCHITECTURE.md` — full design + decisions
- `tools/bundle.js` — bundles `src/` into one self-contained `dist/index.html`

## Build / release

The packaged app is the **bundled** single file at
`android/app/src/main/assets/index.html`, which the shared `electron/` shell and
the `android/` Capacitor project both load — same as the other editions. CI:
`build-windows-livex.yml` + `build-apk-livex.yml` (push to this branch → Release on
the `latest-livex` update channel).

After editing anything in `src/`, regenerate the packaged file:

```bash
node livex/tools/bundle.js
cp livex/dist/index.html android/app/src/main/assets/index.html
```

## Status — functional

Controller identification + learning, schematic rendering, live input mapping,
multi-device, the fixed Bluetooth path, **sound** (synth keys + drum pads + your
samples), the **loop machine** (record / overdub / play / stop, metronome, BPM,
one-shot SYNC quantize), and **Export loop → WAV** are all in and verified.
`core/audio.js` · `core/transport.js` · `core/library.js` carry the sound + loop stack.
