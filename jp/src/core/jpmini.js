// jpmini.js — the JamJum JP mini, and nothing else.
//
// WHAT THIS DEVICE ACTUALLY IS (JAMJUM JP-MINI, manual + product spec, read
// 2026-08-07):
//   · 4x4 grid of sixteen silicone pads, velocity AND pressure sensitive
//   · RGB per pad, colours set in the vendor software
//   · 8 PRESETS, switched on the unit — so 8 x 16 = 128 addressable pads
//   · 4 velocity curves
//   · ATOUCH SW: aftertouch can be switched off, in which case the pad sends
//     nothing after the initial strike
//   · NOTE REPEAT, with the rate chosen from pads 1-8 in the shift layer:
//     1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T, 1/32, 1/32T — and a swing percentage
//   · TAP TEMPO on pad 16 of the shift layer, which also sets repeat speed
//   · DARK (night) and ECO (lights off, ~70% battery saved) modes
//   · USB-C and Bluetooth LE MIDI
//   · sends Note, Control Change and Program Change
//
// THE ONE THING THE MANUAL DOES NOT PUBLISH is a default note table, because
// every pad, every button and every knob is remappable in the vendor's PC
// software. Two JP minis on the same desk can be sending completely different
// notes, and a unit somebody has already customised will not match any table
// this file could contain.
//
// So this does NOT identify pads by note number. It LEARNS the grid: you hit
// the sixteen pads in order once, and from then on the mapping is this unit's,
// stored under this unit's port name. The table below is only where the learn
// starts from — the General MIDI drum block from 36 up, which is what these
// controllers ship as before anyone touches them.

export const PADS = 16;
export const PRESETS = 8;                       // the unit's own preset banks
export const ROWS = 4, COLS = 4;

// The factory layout: bottom-left is 36 and it reads left-to-right, bottom row
// first, the way every pad grid since the MPC has been numbered. Index 0 in
// this array is the TOP-LEFT pad on screen, because that is reading order.
export const FACTORY_NOTES = [
  48, 49, 50, 51,
  44, 45, 46, 47,
  40, 41, 42, 43,
  36, 37, 38, 39,
];

// Channel 10 is percussion by MIDI convention and is what a pad bank ships on.
// It is a starting assumption only: the learn records whatever channel the unit
// actually uses, per pad, because a customised unit may not be consistent.
export const FACTORY_CHANNEL = 9;               // zero-based: MIDI channel 10

// The note-repeat divisions the unit itself offers, in the unit's own order —
// pads 1 to 8 of the shift layer, left to right. `q` is the length in
// sixteenth-notes, which is the resolution the sequencer thinks in.
export const RATES = [
  { id: '1/4',   label: '1/4',   q: 4 },
  { id: '1/4T',  label: '1/4T',  q: 8 / 3 },
  { id: '1/8',   label: '1/8',   q: 2 },
  { id: '1/8T',  label: '1/8T',  q: 4 / 3 },
  { id: '1/16',  label: '1/16',  q: 1 },
  { id: '1/16T', label: '1/16T', q: 2 / 3 },
  { id: '1/32',  label: '1/32',  q: 0.5 },
  { id: '1/32T', label: '1/32T', q: 1 / 3 },
];

// The four velocity curves the unit names. Applied here as well as on the
// hardware, because a unit set to LINEAR still benefits from the app being able
// to soften or harden a pad set the player finds unresponsive — and because on
// a unit somebody has already configured, this is the only end we control.
export const CURVES = {
  linear: { l: 'Linear', f: (v) => v },
  soft:   { l: 'Soft',   f: (v) => Math.pow(v, 0.6) },   // easier to play loud
  hard:   { l: 'Hard',   f: (v) => Math.pow(v, 1.7) },   // rewards a firm hit
  fixed:  { l: 'Full',   f: () => 1 },                    // FULL LEVEL: every hit 127
};
export const CURVE_IDS = Object.keys(CURVES);

// Is this port a JP mini? A real unit reports its OEM rather than its product —
// "KUWEE Technology JP-Mini" — so the maker name has to match too, or the
// controller most people actually receive never identifies at all.
const JP_RE = /\bjp[-\s]?mini\b|\bjam\s?jum\b|\bkuwee\b/i;
// The JP-1 is the bigger sibling: same maker, 16 pads, but also 8 knobs and 6
// buttons. It is NOT this app's device, and saying so plainly is better than
// half-working.
const JP1_RE = /\bjp[-\s]?1\b/i;

export function identify(name) {
  const n = String(name || '');
  if (JP1_RE.test(n)) return { jp: false, sibling: 'JP-1', name: n };
  if (JP_RE.test(n)) return { jp: true, name: n };
  return { jp: false, name: n };
}

const LS = 'skrimpad.jp.map.v1';

// ---------------------------------------------------------------------------
// THE GRID MAP
//
// One record per unit, keyed by port name: which note (and channel) each of the
// sixteen pads sends, per preset. A unit is only ever learned once.
// ---------------------------------------------------------------------------
function blank() {
  return {
    // presets[p][i] = { note, ch } or null for a slot not yet learned
    presets: Array.from({ length: PRESETS }, () =>
      FACTORY_NOTES.map((note) => ({ note, ch: FACTORY_CHANNEL }))),
    learned: false,
  };
}

export function createDeviceMap() {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { all = {}; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} };

  const unit = (port) => {
    const k = port || 'JP mini';
    if (!all[k]) all[k] = blank();
    return all[k];
  };

  return {
    // Which pad did this note on this channel come from, in this preset?
    // Returns -1 for a note the grid does not know, which is how a stray
    // message from a knob or a transport button stays out of the pads.
    padFor(port, preset, note, ch) {
      const u = unit(port);
      const p = u.presets[preset % PRESETS] || [];
      for (let i = 0; i < p.length; i++) {
        if (!p[i]) continue;
        // Channel is matched only when the unit has been learned. Before that
        // the assumed channel is a guess, and refusing a pad because a guess
        // was wrong would leave a brand-new controller looking dead.
        if (p[i].note !== note) continue;
        if (u.learned && p[i].ch !== ch) continue;
        return i;
      }
      return -1;
    },
    noteFor(port, preset, i) {
      const p = unit(port).presets[preset % PRESETS];
      return (p && p[i]) ? p[i].note : FACTORY_NOTES[i];
    },
    // Record what a pad actually sends. This is the learn.
    teach(port, preset, i, note, ch) {
      const u = unit(port);
      const p = u.presets[preset % PRESETS];
      // A note already assigned elsewhere in this preset MOVES rather than
      // being bound twice — hitting the wrong pad during a sweep should be
      // correctable by hitting the right one, not fatal.
      for (let k = 0; k < p.length; k++) if (p[k] && p[k].note === note && p[k].ch === ch) p[k] = null;
      p[i] = { note, ch };
      u.learned = true;
      save();
    },
    reset(port, preset) {
      const u = unit(port);
      if (preset == null) { all[port || 'JP mini'] = blank(); save(); return; }
      u.presets[preset % PRESETS] = FACTORY_NOTES.map((note) => ({ note, ch: FACTORY_CHANNEL }));
      save();
    },
    learned(port) { return !!unit(port).learned; },
    snapshot(port, preset) {
      return (unit(port).presets[preset % PRESETS] || []).map((x) => (x ? Object.assign({}, x) : null));
    },
  };
}

// Pad geometry. Row 0 is the top row on screen; the unit's own numbering starts
// at the bottom left, so PAD 1 on the hardware is index 12 here. The label has
// to match what is printed on the pad or the mapping sweep is unfollowable.
export function padLabel(i) {
  const row = Math.floor(i / COLS), col = i % COLS;
  return String((ROWS - 1 - row) * COLS + col + 1);
}
