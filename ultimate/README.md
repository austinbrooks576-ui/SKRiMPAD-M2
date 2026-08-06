# SKRiMPAD ULTIMATE — ATLAS

**One surface. Five altitudes. No windows, no tabs, no panels.**

Every DAW solves "there is too much to show" the same way: cut the screen into
panels, stack them in tabs, float them in windows. You end up managing furniture
instead of making music — and on a phone it collapses, because there is no room
for furniture.

ULTIMATE has none. There is one surface and you move through it **vertically**.
Pinch out or scroll up to rise; pinch in to descend into whatever is under your
finger.

| # | Altitude | What you see |
|---|---|---|
| 0 | **CONSTELLATION** | the whole song as a field of light — every cell at once, brightness = energy, orbit = density |
| 1 | **DECK** | the performance surface: 16 cells, step ribbons, transport |
| 2 | **CELL** | one cell's 16 steps — tap to place, drag to paint |
| 3 | **VOICE** | the synth behind it: cutoff, resonance, envelope, drive, space |
| 4 | **GRAIN** | the live waveform, sample-accurate |

This is **semantic zoom**, not a magnifying glass. The drawing does not get
bigger — at each altitude it becomes a *different representation of the same
data*. That is why one gesture reaches everything: you are never navigating an
interface, only choosing how close to stand.

## Why it is better than panels

- Nothing to arrange, so nothing to arrange **wrong**.
- The same gesture works at every level — exactly one thing to learn. Anyone can pinch.
- Depth is **continuous**. You may sit *between* two altitudes and see both, which
  is where you actually work when tweaking a filter while watching the song run.
- Adding a sixth altitude later costs nothing. Panels cost screen.

## Design rules

1. **One light source, above.** Every raised thing is lit on its top edge and casts down.
2. **Colour means identity.** A cell owns its hue at every altitude — learn "the kick is the red one" once.
3. **Light means energy.** Nothing glows for decoration; if it is bright, audio is leaving it right now.

## Under the hood

- **Fully modular ES modules** — `core/atlas.js` (altitude engine), `core/model.js`
  (the only source of truth), `core/engine.js` (audio + clock), `core/midi-io.js`.
- **90 KB self-contained** — the whole app, font included. The Consumer edition is 765 KB.
- **Look-ahead scheduling** against `AudioContext.currentTime`, not `setInterval`,
  so a late timer cannot make a late note.
- **Disposable voices** — no pool, so no stuck note under a 128-note flood.
- **Shape-checked persistence** — a corrupt save is discarded, never half-loaded.
- **The hardened MIDI stack** from LIVEx: waits for the Android bridge, sweeps on a
  backoff while nothing is attached, re-scans the moment the app returns to the
  foreground (i.e. right after you pair something in Settings).

Build: `node ultimate/tools/bundle.js` → `ultimate/dist/index.html`

## The documentation rule

Every control in the app is listed in the `HELP` table in `src/index.html`, and
each entry names what it documents with a CSS selector. `ultwin.cjs` walks every
`button[id]`, `input[id]` and `[role="slider"][id]` in the document — at every
altitude, with the library populated — and fails if one of them is not in that
table. It fails the other way too: a selector in the table that no longer
matches anything is a stale entry and also fails.

So a new feature is not finished when it works. It is finished when it is
written up in `HELP`, and the build says so.
