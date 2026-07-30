// profiles.js — controller pattern DB + known-device seeds.
//
// identify.js walks PATTERNS in order; the first regex to match a device's
// name+manufacturer string wins and supplies a base profile. The live
// capability probe (see identify.js) then refines counts/flags at runtime,
// so a generic "USB MIDI" device that hits no pattern still gets classified
// by what it actually sends.
//
// Profile shape (the contract consumed by schematic.js):
//   { id, class, source, portName, keys:{count,firstNote}, pads:{count,layout,channel},
//     transport:[...], knobs, wheels:[...], confidence }

export const CLASSES = Object.freeze({
  KEYBOARD: 'keyboard',
  PADS: 'pads',
  GRID: 'grid',
  CONTROL: 'control',
  GAMEPAD: 'gamepad',
  HYBRID: 'keyboard+pads',
});

// Merge a partial profile onto the canonical default so every profile is complete.
export function makeProfile(partial = {}) {
  return {
    id: null,
    class: CLASSES.CONTROL,
    source: 'midi',            // midi | ble | gamepad
    portName: '',
    keys: null,                // { count, firstNote } or null
    pads: null,                // { count, layout:[rows,cols], channel, banks } or null
    transport: [],             // subset of ['play','stop','rec']
    knobs: 0,                  // knob COUNT (per bank)
    knobBanks: 1,              // 2 on the SMK-25 (KNOB-B second shelf)
    wheels: [],                // subset of ['pitch','mod']
    buttons: [],               // named function buttons: arp, scch, bt, knobB, padB, oct-, oct+
    features: [],              // capability flags: arp, scaleChord, octave, transpose, sustain, bt, latch, swing, gate, tempo
    confidence: 0,
    ...partial,
    // deep-merge the nested shapes so callers can pass just one field
    keys: partial.keys ? { count: 0, firstNote: 36, ...partial.keys } : (partial.keys === undefined ? null : partial.keys),
    pads: partial.pads ? { count: 0, layout: [0, 0], channel: 10, ...partial.pads } : (partial.pads === undefined ? null : partial.pads),
  };
}

// Ordered pattern DB. Put SPECIFIC device families before GENERIC families.
// `test` runs against `${name} ${manufacturer}` lowercased.
export const PATTERNS = [
  // --- M-Wave / Worlde SMK-25 — the reference device (25 keys + 8 pads) ---
  // Verified on the owner's unit (2026-07-23):
  //   USB  input.name : "SMK25"  (+ "MIDIIN2 (SMK25)", "MIDIIN3 (SMK25)" — 3 ports)
  //   USB  VID/PID     : VID_4353 & PID_4B4D
  //   BLE  name        : "SMK25V2"  (via KORG BLE-MIDI stack)
  // The (?:v\d)? tail matches the "V2" BLE suffix; matching is substring-based so it
  // also fires inside "MIDIIN2 (SMK25)". Extra ports are coalesced in identify.js.
  {
    test: /\bsmk[-\s]?25(?:\s?v\d)?\b|\b(m[-\s]?wave|mwave|worlde)\b/i,
    usb: { vid: 0x4353, pid: 0x4b4d },
    base: () => makeProfile({
      id: 'smk25',
      class: CLASSES.HYBRID,
      keys: {
        count: 25, firstNote: 48,               // C3; shifts with OCT±/TRANSPOSE at runtime
        // printed key legend (M-Vave SMK-25), 0-indexed per key:
        //   arp[]  = bottom row, one shortcut per key (hold ARP)
        //   scch{} = top row on the right keys (hold SC/CH); note names on keys 0-11
        legend: {
          arp: ['UP', 'DOWN', 'INCL', 'EXCL', 'RAND', 'ORDER', 'REPEAT', 'OCT+',
            'LATCH', 'GATE+', 'GATE-', 'TAP', 'SWING+', 'SWING-', 'TEMPO+', 'TEMPO-',
            'SYNC', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32', '1/32T'],
          scch: { 17: 'CH', 18: 'TRIAD', 19: '7TH', 20: '9TH', 21: 'RAND', 22: 'OFF', 23: 'MAJOR', 24: 'MINOR' },
        },
      },
      pads: { count: 8, layout: [2, 4], channel: 10, banks: 2 }, // PAD-B = second bank → 16 sounds
      transport: ['play', 'stop', 'rec'],
      knobs: 8,
      knobBanks: 2,                             // KNOB-B = second shelf → 16 CC assignments
      wheels: ['pitch', 'mod'],                 // capacitive touch strips
      buttons: ['arp', 'scch', 'bt', 'knobB', 'padB', 'oct-', 'oct+'],
      features: ['arp', 'scaleChord', 'octave', 'transpose', 'sustain', 'bt',
        'latch', 'swing', 'gate', 'tempo', 'order', 'repeat'],
      confidence: 0.95,
    }),
  },

  // --- Akai MPK mini family (25 keys + 8 pads + 8 knobs) ---
  {
    test: /\bmpk\s?mini\b/i,
    base: () => makeProfile({
      id: 'mpkmini', class: CLASSES.HYBRID,
      keys: { count: 25, firstNote: 48 }, pads: { count: 8, layout: [2, 4], channel: 10 },
      knobs: 8, wheels: [], transport: [], confidence: 0.9,
    }),
  },

  // --- Pad banks (MPD / LPD / SPD / Maschine) ---
  {
    test: /\b(mpd\d*|lpd\d*|spd|maschine|drum\s?pad|beatpad)\b/i,
    base: () => makeProfile({
      id: 'padbank', class: CLASSES.PADS,
      pads: { count: 16, layout: [4, 4], channel: 10 }, knobs: 4,
      transport: ['play', 'stop', 'rec'], confidence: 0.85,
    }),
  },

  // --- 8x8 grids (Launchpad / APC) ---
  {
    test: /\b(launchpad|apc\s?mini|apc40|grid)\b/i,
    base: () => makeProfile({
      id: 'grid', class: CLASSES.GRID,
      pads: { count: 64, layout: [8, 8], channel: 1 }, confidence: 0.85,
    }),
  },

  // --- Full-size keyboards, by key count in the name (49/61/76/88) ---
  {
    test: /\b(88|76|61|49|37|32|25)\s?(?:[-\s]?key|keys?)\b/i,
    base: (m) => {
      const n = parseInt(m[1], 10);
      return makeProfile({
        id: 'keyboard' + n, class: CLASSES.KEYBOARD,
        keys: { count: n, firstNote: n >= 61 ? 36 : 48 }, wheels: ['pitch', 'mod'],
        confidence: 0.75,
      });
    },
  },

  // --- Generic keyboard words ---
  {
    test: /\b(keystation|keyboard|keylab|keys|piano|oxygen|launchkey)\b/i,
    base: () => makeProfile({
      id: 'keyboard', class: CLASSES.KEYBOARD,
      keys: { count: 49, firstNote: 36 }, wheels: ['pitch', 'mod'], confidence: 0.6,
    }),
  },

  // --- Control surfaces (knobs/faders only) ---
  {
    test: /\b(nanokontrol|control|mixer|fader|nano\s?kontrol)\b/i,
    base: () => makeProfile({ id: 'control', class: CLASSES.CONTROL, knobs: 8, confidence: 0.6 }),
  },
];

// Normalize a port name to a stable device signature so the 3 SMK25 ports
// ("SMK25", "MIDIIN2 (SMK25)", "MIDIIN3 (SMK25)", "SMK25V2") all collapse to one
// learned device. Strips MIDIIN/OUT prefixes, (Bluetooth MIDI …) qualifiers,
// port numbers, and the V-suffix; keeps the core model token.
export function deviceSignature(name = '', manufacturer = '') {
  let s = String(name).toLowerCase();
  s = s.replace(/midi(in|out)\d*/g, ' ');          // MIDIIN2 / MIDIOUT3
  s = s.replace(/\((?:bluetooth\s+)?midi(?:\s+(?:in|out))?\)/g, ' '); // (Bluetooth MIDI IN)
  s = s.replace(/[()\[\]]/g, ' ');
  s = s.replace(/\bv\d\b/g, ' ');                    // trailing V2
  s = s.replace(/[^a-z0-9]+/g, '');                 // collapse to token
  const mfr = String(manufacturer).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return (s || 'device') + (mfr ? ':' + mfr : '');
}

// Fallback when nothing in PATTERNS matches — the probe carries the classification.
export function unknownProfile(portName, source = 'midi') {
  return makeProfile({ id: null, class: CLASSES.CONTROL, source, portName, confidence: 0 });
}

// When the user plugs in a device we've never seen, identify.js emits its raw
// `input.name` here so we can grow the DB. Wire this to a log/telemetry sink.
export function reportUnknownDevice(name, manufacturer) {
  // eslint-disable-next-line no-console
  console.info('[SKRiMPADxLIVEx] unrecognized controller — seed a pattern for:', { name, manufacturer });
}
