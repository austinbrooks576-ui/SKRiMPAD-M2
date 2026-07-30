# SKRiMPADxLIVEx — Architecture

> Plug in any controller. LIVEx identifies it, draws a **top-down schematic** of it in
> clean line-art (like the M-Wave SMK-25 box), maps every input, and lets you play live
> with **Record / Stop / Play / Export loop**, a **BPM meter + metronome**, and a
> drag-and-drop **library sidebar** you can drop a file straight onto any pad or key.

## Targets

| Platform | Shell | MIDI path |
|---|---|---|
| Windows | Electron (bundled Chromium) | Web MIDI + Web Bluetooth GATT |
| Linux   | Electron (bundled Chromium) | Web MIDI + Web Bluetooth GATT |
| Android | Capacitor WebView + native MIDI plugin | native bridge (`window.AndroidMidi`) — System WebView has **no** Web MIDI |

**Android responsive rule:** on **every new input**, call `fitHint(svg)` (schematic.js) and
re-lock `ScreenOrientation` + rescale to that controller's aspect — wide boards (61/88-key)
→ landscape, compact banks (8-pad, gamepad) → portrait. Each connection re-fits
orientation and scaling individually; CSS `max-width:100%`/`height:auto` does the scaling.

Not targeting iOS/macOS (Apple/WebKit blocks Web MIDI). Chosen to **maximize reuse of
SKRiMPAD M2's proven I/O layer** (Web MIDI hot-plug, BLE GATT, Gamepad, WebAudio).

## Confirmed design decisions

1. **Schematic front-end** — the UI *is* a scaled top-down line drawing of whatever is
   plugged in. 25/61/88-key keyboards scale and lay out; 8/16-pad banks + transport pads
   build; game controllers map via the Gamepad API.
2. **Identification** = name/manufacturer **regex** (`core/profiles.js` pattern DB) +
   live **capability probe** (channel-10 = drums, note range = keys, CC-only = control
   surface). Gamepads come through the Gamepad API, never MIDI.
3. **Accidentals ("minor" keys)** are drawn in a **contrary / complementary color**
   derived per-skin from the white-key tone — a contrasting hue, **not** a dark inverted
   fill.
4. **6-second press-and-hold → right-hand config drop-down** on **all elements**
   (keys, pads, knobs, transport) — **Android .apk only**, so the hold never breaks
   contact with the input toggle on touch. Desktop uses right-click for the same menu.
5. **Library sidebar → drop-to-target** — drop an audio file straight onto any pad/key.
6. **Transport** — Record / Stop / Play / Export loop + BPM meter + metronome.
7. **Full-width keyboard + printed legend** — keys stretch the entire board width; the
   exact printed legend renders above every key (note letters on octave 1, the SC/CH row
   — CH/TRIAD/7TH/9TH/RAND/OFF/MAJOR/MINOR — on the right, and the ARP shortcut row
   UP…1/32T under all 25 keys). Legend data lives on `profile.keys.legend {arp[], scch{}}`.
8. **One-shot SYNC button** — lives in the **app chrome, OUTSIDE the controller schematic**.
   Momentary (NOT a toggle): on press it quantizes active loops' beat phase + snaps
   sounding/held notes to the grid and resets the metronome to the downbeat, then releases
   — "corrects timing and takes its hands off." No persistent engaged state.
9. **Large-board auto-windowing** — when full-width keys would fall below a playable
   minimum (`minKeyW`, default 24px), the keyboard renders an **abridged span** of
   `visibleWhites` keys with **octave paging** (◀8VE / 8VE▶, ±7 whites) and a range map,
   instead of squashing 60+ keys. Wide surfaces show the whole board; narrow ones window.
   `renderSchematic(profile,{minKeyW,startWhite,maxWidth})`; `svg.__keyboard` exposes
   `{windowed,startWhite,visibleWhites,whiteTotal}` for the host to drive paging. On
   Android this composes with the per-input `fitHint` orientation/scaling re-fit.

## Module layout

```
electron/            desktop shell (main + preload)
capacitor.config.*   android shell config (+ native MIDI plugin)
src/
  index.html         single entry (renderer)
  core/
    midi-io.js       Web MIDI hot-plug, BLE GATT, native Android bridge  (from SKRiMPAD M2)
    gamepad.js       Gamepad API loop + universal "button → pad" bind     (from SKRiMPAD M2)
    profiles.js      controller pattern DB + known-device seeds
    identify.js      regex + capability probe → profile object
    schematic.js     profile → top-down SVG face (scales to input counts)
  ui/
    library.js       sidebar + drag/drop-to-pad/key   (from SKRiMPAD M2 libDrop*)
    transport.js     REC/STOP/PLAY/EXPORT + BPM + metronome
    holdmenu.js      6s hold → config drop-down (apk-gated)
  styles/
    theme.js         skin loader + contrary-color(accidentals)
```

## Universal sound-file system (library)

The library is format-agnostic — drop or import any of these; drop straight onto a pad/key.

| Kind | Formats | Path (reused from SKRiMPAD M2) |
|---|---|---|
| **Audio** | WAV, MP3, FLAC, OGG/Opus, AIFF/AIF, M4A/AAC, + more | `ctx.decodeAudioData(arrayBuffer)` behind broad `AUDIO_EXT` regex → `libRegisterImport` |
| **MIDI** | `.mid`, `.midi` | separate MIDI-file parser (net-new small module) → mappable/playable clip |
| **Packs** | `.zip` sample/skin packs | `importZipPack → importZipData()` — self-extracts and sorts into tabs |

- **Direct download / export** (loops, projects, rendered stems): `bufferToWav → Blob →
  URL.createObjectURL → <a download>.click()` — identical to SKRiMPAD.
- **Export loop** (transport) renders the active loop to WAV via the same download path.

## Profile object (the contract between identify → schematic)

```js
{
  id: 'smk25',                 // stable key once known
  class: 'keyboard+pads',      // keyboard | pads | grid | control | gamepad | hybrid
  source: 'midi',             // midi | ble | gamepad
  portName: 'SMK-25',          // raw input.name captured at connect
  keys:   { count: 25, firstNote: 48 },
  pads:   { count: 8, layout: [2,4], channel: 10 },
  transport: ['play','stop','rec'],
  knobs:  8,
  wheels: ['pitch','mod'],
  confidence: 0.9              // regex hit = high; probe-only = lower
}
```

## Reuse map (what's lifted from SKRiMPAD M2 vs net-new)

| Lifted (proven) | Net-new for LIVEx |
|---|---|
| Web MIDI hot-plug (`onstatechange` re-hook) | `identify.js` classifier |
| BLE GATT connect + `parseBLEMIDI` | `profiles.js` pattern DB |
| native `window.AndroidMidi` bridge | `schematic.js` top-down renderer |
| Gamepad loop + universal bind | contrary-color accidentals |
| `libDrop*` drag/drop-to-target | 6s hold menu (apk) |
| WebAudio engine, `detectBPM` | schematic-driven layout scaling |
| `decodeAudioData` universal import + `AUDIO_EXT` | `.mid/.midi` file parser |
| `importZipData` ZIP pack import | — |
| `bufferToWav` + `<a download>` export | — |

## v1 — sound + loop (implemented)

- `core/audio.js` — WebAudio engine: synth key voices, synthesized drum pads,
  library-sample playback; voice factory reused by the OfflineAudioContext WAV
  export (`bufferToWav` from SKRiMPAD M2).
- `core/library.js` — universal decode (WAV/MP3/FLAC/OGG/AIFF/M4A…), `.zip`
  sample-pack import via native `DecompressionStream`, assign sample → pad/key.
- `core/transport.js` — lookahead-scheduled loop machine: Record / overdub / Play /
  Stop / Clear, metronome, BPM + bars (events stored in beats so tempo stays
  musical), one-shot **quantize** (wired to SYNC), **Export loop → WAV**.
- Live input (MIDI/gamepad/tap) → lights the schematic **and** plays sound; hits are
  captured into the loop while REC is armed. Verified end-to-end in-browser.
