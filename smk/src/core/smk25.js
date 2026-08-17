// smk25.js — the M-VAVE SMK-25, and nothing else.
//
// WHAT THIS DEVICE IS. Verified on the owner's own unit (LIVEx probe,
// 2026-07-23) and against the M-VAVE manual (read 2026-08-10):
//
//   · 25 velocity-sensitive mini keys, first note C3 (48), shifted by OCT±
//   · EIGHT drum pads in a 2x4 block on the right-hand side, DP1 top-left
//   · PAD-B — a second pad bank, so 8 pads address 16 sounds
//   · EIGHT 360° rotary encoders
//   · KNOB-B — a second knob shelf, so 8 knobs address 16 assignments
//   · ARP — arpeggiator. Held, it turns the 25 keys into a shortcut row:
//     UP DOWN INCL EXCL RAND ORDER REPEAT OCT+ LATCH GATE+ GATE- TAP
//     SWING+ SWING- TEMPO+ TEMPO- SYNC 1/4 1/4T 1/8 1/8T 1/16 1/16T 1/32 1/32T
//   · SC/CH — smart scale and chord. Held, the upper keys pick:
//     CH TRIAD 7TH 9TH RAND OFF MAJOR MINOR
//   · PLAY · STOP · REC transport buttons
//   · OCT+ / OCT− and transpose
//   · capacitive touch strips for PITCH and MOD, and a SUS button
//   · BT button — Bluetooth LE MIDI; also sets the velocity curve
//   · USB-C, and a rechargeable battery
//
//   USB port name : "SMK25"  (plus "MIDIIN2 (SMK25)" and "MIDIIN3 (SMK25)")
//   USB VID/PID   : 0x4353 / 0x4B4D
//   BLE name      : "SMK25V2"
//
// THE TWO FACTS THAT DECIDE THE DESIGN
//
// 1. THE MANUAL PUBLISHES NO CC NUMBERS AND NO PAD NOTES. Every knob, every pad
//    and every button is reassignable in M-VAVE's CubeSuite editor, and units
//    ship configured differently. So nothing here is hard-coded as truth: the
//    tables below are where a LEARN starts, and what the unit actually sends is
//    recorded per unit, by port name, the first time you show it.
//
// 2. THE KEYS AND THE PADS ARE DIFFERENT INSTRUMENTS AND STAY THAT WAY. The
//    pads are a 2x4 block that fires sounds; the keys are 25 keys that play
//    pitches. Nothing maps a pad onto a key or a key onto a pad — a keyboard
//    whose C4 secretly fires a snare is a keyboard you cannot play.

export const KEYS = 25;
export const FIRST_NOTE = 60;          // C4 (middle C), before OCT± moves it
export const PADS = 8;
export const PAD_ROWS = 2, PAD_COLS = 4;
export const PAD_BANKS = 2;            // PAD-B
export const KNOBS = 8;
export const KNOB_BANKS = 2;           // KNOB-B

// DP1 IS TOP-LEFT. The block is printed 1-4 across the top row and 5-8 across
// the bottom, which is the opposite of an MPC grid — so an app numbering from
// the bottom left would be unfollowable while looking at the unit.
export const PAD_LABELS = ['DP1', 'DP2', 'DP3', 'DP4', 'DP5', 'DP6', 'DP7', 'DP8'];

// Where a learn starts. General MIDI percussion from 36, channel 10 — what
// these controllers ship as before anyone opens CubeSuite.
// PAD 1 IS TOP-LEFT AND TAKES THE FIRST NOTE. The unit silkscreens Pad 1..Pad 4
// across the top row and Pad 5..Pad 8 across the bottom, so the numbering runs
// the same way the screen does and the first pad gets the first note.
//
// I had this as an MPC-style bottom-up map for one build, on the assumption
// that this family numbers pads from the bottom left. A photograph of the unit
// says otherwise. If a particular unit disagrees — they are all remappable in
// M-VAVE's editor — FLIP ROWS in the pad menu swaps the two rows in one tap,
// and teaching a pad overrides the factory map entirely.
export const FACTORY_PAD_NOTES = [36, 37, 38, 39, 40, 41, 42, 43];
export const FACTORY_PAD_CH = 9;       // zero-based: MIDI channel 10

// And the eight knobs, which conventionally start at CC 21.
export const FACTORY_KNOB_CC = [21, 22, 23, 24, 25, 26, 27, 28];

// WHAT EACH KNOB IS FOR — the thing the manual does not tell you and the reason
// eight identical unlabelled encoders feel useless out of the box. Bank A is
// the sound under your hands; bank B is the room it is in and the machine
// around it. Every one is remappable; these are what they do until you say
// otherwise.
// THE KNOBS ARE ARPEGGIATOR CONTROLS, and they are silkscreened on the unit.
//
// This list used to be CUTOFF/RESO/ATTACK/RELEASE/DRIVE/SPREAD/TUNE/LEVEL —
// a sensible set of synth controls, and not what is printed on the keyboard.
// The panel reads, in the 2x4 block:
//
//     MODE    OCT     LATCH   GATE
//     SWING   TEMPO   RATE    TRANSPOSE
//
// which is the arpeggiator, top to bottom. Naming a knob something other than
// what is written on the knob is the worst kind of wrong: everything works and
// nothing is where it says it is.
//
// Bank B (KNOB-B) keeps the voice controls, because they have to live
// somewhere and the unit gives a second bank for exactly this.
export const KNOB_ROLES = [
  // ---- BANK A: the arpeggiator, as printed on the unit --------------------
  { id: 'mode',    l: 'MODE',    d: 'Which order the held notes are played in: UP, DOWN, INCL, EXCL, RAND, ORDER, REPEAT. INCL repeats the top and bottom of the run; EXCL turns without repeating them.' },
  { id: 'oct',     l: 'OCT',     d: 'How many octaves the arpeggio spreads over, 1 to 4. One octave of a three-note chord is nine notes of nothing new.' },
  { id: 'latch',   l: 'LATCH',   d: 'Past halfway the arpeggio keeps running with no keys down. It captures the WHOLE chord, taken as the first finger lifts.' },
  { id: 'gate',    l: 'GATE',    d: 'How long each arpeggiated note holds, as a fraction of its step. Short is staccato; long runs the notes together.' },
  { id: 'swing',   l: 'SWING',   d: 'Delays the offbeats only. Delaying every step would just be a slower tempo.' },
  { id: 'tempo',   l: 'TEMPO',   d: 'Beats per minute, 20 to 300. The arpeggiator, the rhythms, the sequencer and the looper all follow it.' },
  { id: 'rate',    l: 'RATE',    d: 'How often a step happens: 1/4 down to 1/32T, the unit\'s own eight divisions.' },
  { id: 'transpose', l: 'TRANSPOSE', d: 'Shifts every note by semitones without moving the keyboard window, so the shape under your hands stays put.' },
  // ---- BANK B (KNOB-B): the voice ----------------------------------------
  { id: 'cutoff',  l: 'CUTOFF',  d: 'Brightness. Opens and closes the filter — the most useful knob on any synth.' },
  { id: 'reso',    l: 'RESO',    d: 'The peak at the cutoff point. A little adds bite; a lot makes the filter sing on its own.' },
  { id: 'attack',  l: 'ATTACK',  d: 'How fast a note arrives. Down for a stab, up for a swell.' },
  { id: 'release', l: 'RELEASE', d: 'How long it takes to disappear after you let go.' },
  { id: 'drive',   l: 'DRIVE',   d: 'Saturation before the filter. Adds harmonics and weight rather than just volume.' },
  { id: 'space',   l: 'SPACE',   d: 'Reverb send. How much room the sound is in.' },
  { id: 'tune',    l: 'TUNE',    d: 'Pitch in semitones, ±24. Centred is no change.' },
  { id: 'level',   l: 'LEVEL',   d: 'How loud this sound is against the others.' },
];

// The ARP shortcut row, printed under the 25 keys. Index is the key, 0-based
// from the bottom. Held ARP + a key does the thing printed on it.
export const ARP_LEGEND = [
  'UP', 'DOWN', 'INCL', 'EXCL', 'RAND', 'ORDER', 'REPEAT', 'OCT+', 'LATCH',
  'GATE+', 'GATE-', 'TAP', 'SWING+', 'SWING-', 'TEMPO+', 'TEMPO-', 'SYNC',
  '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32', '1/32T',
];

// The SC/CH row, on the upper keys only.
export const SCCH_LEGEND = {
  17: 'CH', 18: 'TRIAD', 19: '7TH', 20: '9TH', 21: 'RAND', 22: 'OFF', 23: 'MAJOR', 24: 'MINOR',
};

export const ARP_MODES = ['UP', 'DOWN', 'INCL', 'EXCL', 'RAND', 'ORDER', 'REPEAT'];
export const ARP_RATES = [
  { id: '1/4', q: 4 }, { id: '1/4T', q: 8 / 3 }, { id: '1/8', q: 2 }, { id: '1/8T', q: 4 / 3 },
  { id: '1/16', q: 1 }, { id: '1/16T', q: 2 / 3 }, { id: '1/32', q: 0.5 }, { id: '1/32T', q: 1 / 3 },
];

// TWELVE RHYTHMS. Not arpeggiator patterns — those decide WHICH note; a rhythm
// decides WHEN. They run on the pads and on a held chord alike, sixteen steps
// each, the number being the velocity weight of that step. A zero is a rest.
export const RHYTHMS = [
  { id: 'straight', l: 'Straight',  d: 'Every step, evenly.',            s: [9,6,7,6, 8,6,7,6, 9,6,7,6, 8,6,7,7] },
  { id: 'fourfloor', l: 'Four-floor', d: 'On every beat and nothing else.', s: [9,0,0,0, 8,0,0,0, 9,0,0,0, 8,0,0,0] },
  { id: 'offbeat', l: 'Offbeat',    d: 'Between the beats — the house pulse.', s: [0,0,7,0, 0,0,7,0, 0,0,7,0, 0,0,7,0] },
  { id: 'backbeat', l: 'Backbeat',  d: 'Two and four, where a snare lives.', s: [0,0,0,0, 9,0,0,0, 0,0,0,0, 9,0,0,0] },
  { id: 'gallop',  l: 'Gallop',     d: 'Long-short-short. Drives forward.', s: [9,0,6,7, 0,0,6,7, 9,0,6,7, 0,0,6,7] },
  { id: 'dotted',  l: 'Dotted',     d: 'Every third sixteenth — the pattern that pulls against the bar.', s: [9,0,0,7, 0,0,8,0, 0,7,0,0, 8,0,0,7] },
  { id: 'clave',   l: 'Clave',      d: 'The son clave. Three then two.',   s: [9,0,0,7, 0,0,8,0, 0,0,7,0, 8,0,0,0] },
  { id: 'dembow',  l: 'Dembow',     d: 'The reggaeton pulse.',             s: [9,0,0,7, 0,0,8,0, 9,0,0,7, 0,0,8,0] },
  { id: 'tresillo', l: 'Tresillo',  d: 'Three even hits across the bar.',  s: [9,0,0,8, 0,0,8,0, 9,0,0,8, 0,0,8,0] },
  { id: 'shuffle', l: 'Shuffle',    d: 'Swung eighths with a ghost between.', s: [9,0,4,7, 0,4,8,0, 9,0,4,7, 0,4,8,0] },
  { id: 'build',   l: 'Build',      d: 'Gets busier and louder across the bar.', s: [6,0,0,0, 6,0,7,0, 7,0,7,7, 8,8,9,9] },
  { id: 'sparse',  l: 'Sparse',     d: 'Once a bar, on the one. Room to breathe.', s: [9,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0] },
];

export const SCALES = {
  off:        { l: 'Off',        iv: null },
  major:      { l: 'Major',      iv: [0, 2, 4, 5, 7, 9, 11] },
  minor:      { l: 'Minor',      iv: [0, 2, 3, 5, 7, 8, 10] },
  dorian:     { l: 'Dorian',     iv: [0, 2, 3, 5, 7, 9, 10] },
  phrygian:   { l: 'Phrygian',   iv: [0, 1, 3, 5, 7, 8, 10] },
  mixolydian: { l: 'Mixolydian', iv: [0, 2, 4, 5, 7, 9, 10] },
  pentatonic: { l: 'Pentatonic', iv: [0, 3, 5, 7, 10] },
};
export const CHORDS = {
  off:   { l: 'Off',   iv: [0] },
  triad: { l: 'Triad', iv: [0, 2, 4] },       // scale degrees, not semitones
  sev:   { l: '7th',   iv: [0, 2, 4, 6] },
  nine:  { l: '9th',   iv: [0, 2, 4, 6, 8] },
};

const JP_LIKE = /\bjp[-\s]?mini\b|\bjp[-\s]?1\b|\bjam\s?jum\b|\bkuwee\b/i;
const SMK_RE = /\bsmk[-\s]?25(?:\s?v\d)?\b|\bsmk25\b|\b(m[-\s]?vave|mvave|m[-\s]?wave|mwave|worlde)\b/i;

// Is this port the SMK-25? Substring matching, because the USB driver publishes
// three ports — "SMK25", "MIDIIN2 (SMK25)", "MIDIIN3 (SMK25)" — and the pads and
// the transport arrive on the second one. Refusing the extra ports would mean
// half the controller was silent over USB, which is exactly the failure this
// pattern exists to avoid.
export function identify(name) {
  const n = String(name || '');
  if (JP_LIKE.test(n)) return { smk: false, other: 'JP pad controller', name: n };
  if (SMK_RE.test(n)) return { smk: true, name: n, ble: /v\d/i.test(n) };
  return { smk: false, name: n };
}

const LS = 'skrimpad.smk.map.v1';

// One learned record per unit, by port name: what the pads send, what the knobs
// send, and what the transport buttons send. Learned once, remembered forever.
function blank() {
  return {
    pads: Array.from({ length: PAD_BANKS }, () =>
      FACTORY_PAD_NOTES.map((note) => ({ note, ch: FACTORY_PAD_CH }))),
    knobs: Array.from({ length: KNOB_BANKS }, (_, bank) =>
      FACTORY_KNOB_CC.map((cc) => ({ cc, ch: 0 }))),
    buttons: {},          // name -> { kind:'cc'|'note'|'rt', a, b, ch }
    learned: { pads: false, knobs: false },
  };
}

export function createUnitMap() {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { all = {}; }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(all)); } catch (e) {} };
  // KEYED BY UNIT, NOT BY PORT. The USB driver publishes three ports for one
  // keyboard; keying on the port name would learn the same unit three times and
  // then disagree with itself about what it had learned.
  const unitKey = (port) => String(port || 'SMK-25').replace(/^MIDIIN\d+\s*\(|\)$/g, '').trim() || 'SMK-25';
  const unit = (port) => {
    const k = unitKey(port);
    if (!all[k]) all[k] = blank();
    return all[k];
  };

  return {
    unitKey,
    padFor(port, bank, note, ch) {
      const u = unit(port);
      const row = u.pads[bank % PAD_BANKS] || [];
      for (let i = 0; i < row.length; i++) {
        if (!row[i] || row[i].note !== note) continue;
        if (u.learned.pads && row[i].ch !== ch) continue;
        return i;
      }
      return -1;
    },
    knobFor(port, bank, cc) {
      const u = unit(port);
      const row = u.knobs[bank % KNOB_BANKS] || [];
      for (let i = 0; i < row.length; i++) if (row[i] && row[i].cc === cc) return i;
      return -1;
    },
    teachPad(port, bank, i, note, ch) {
      const u = unit(port);
      const row = u.pads[bank % PAD_BANKS];
      for (let k = 0; k < row.length; k++) if (row[k] && row[k].note === note && row[k].ch === ch) row[k] = null;
      row[i] = { note, ch };
      u.learned.pads = true; save();
    },
    teachKnob(port, bank, i, cc, ch) {
      const u = unit(port);
      const row = u.knobs[bank % KNOB_BANKS];
      for (let k = 0; k < row.length; k++) if (row[k] && row[k].cc === cc) row[k] = null;
      row[i] = { cc, ch: ch || 0 };
      u.learned.knobs = true; save();
    },
    // A button — PLAY, STOP, REC, ARP, SC/CH, PAD-B, KNOB-B, OCT±. Whatever it
    // sends is what it sends; the app records the signature rather than
    // assuming a standard nobody guarantees.
    teachButton(port, name, sig) { unit(port).buttons[name] = sig; save(); },
    buttonFor(port, sig) {
      const b = unit(port).buttons;
      for (const name of Object.keys(b)) {
        const s = b[name];
        if (!s) continue;
        if (s.kind !== sig.kind) continue;
        if (s.kind === 'rt') { if (s.a === sig.a) return name; continue; }
        if (s.a === sig.a && (s.kind === 'note' || s.b === sig.b || sig.b > 0)) return name;
      }
      return '';
    },
    buttons(port) { return Object.assign({}, unit(port).buttons); },
    learned(port) { return Object.assign({}, unit(port).learned); },
    padSnapshot(port, bank) { return (unit(port).pads[bank % PAD_BANKS] || []).map((x) => x && Object.assign({}, x)); },
    knobSnapshot(port, bank) { return (unit(port).knobs[bank % KNOB_BANKS] || []).map((x) => x && Object.assign({}, x)); },
    reset(port) { all[unitKey(port)] = blank(); save(); },
  };
}

// The signature of an incoming message, for button learning. A transport button
// might send realtime, MMC, a CC or a note depending on how the unit is set up —
// so the app describes what arrived rather than expecting one of them.
export function signature(e) {
  if (e.transport) return { kind: 'rt', a: e.transport };
  if (e.cmd === 0xB0) return { kind: 'cc', a: e.d1, b: e.d2, ch: e.chan };
  if (e.cmd === 0x90 || e.cmd === 0x80) return { kind: 'note', a: e.d1, ch: e.chan };
  if (e.cmd === 0xC0) return { kind: 'pc', a: e.d1, ch: e.chan };
  return null;
}
