// identify.js — turn a connected device into a profile object.
//
// Two signals, combined:
//   1) NAME/MANUFACTURER REGEX  (profiles.js PATTERNS)  — instant, high confidence
//   2) LIVE CAPABILITY PROBE    (observe the MIDI stream) — refines counts + catches
//      generic "USB MIDI" devices that hit no pattern.
//
// Gamepads never appear as MIDI — see gamepad.js for that path; identifyGamepad()
// here just wraps a Gamepad object into the same profile shape.

import { PATTERNS, makeProfile, unknownProfile, reportUnknownDevice, CLASSES } from './profiles.js';
import { recall, remember } from './devicecache.js';

// ---- 0) cache-aware entry point (what the I/O layer calls on connect) --------
// Flow: recall a learned profile → if none, regex-classify now and open a probe
// window; when the probe settles, remember the (refined) profile so next plug-in
// is instant. Returns { profile, probe, learned }.
export async function identifyDevice(input, { probeMs = 4000, onReady } = {}) {
  const learned = await recall(input);
  if (learned) {
    if (onReady) onReady(learned);
    return { profile: learned, probe: null, learned: true };
  }

  const profile = identifyMidiInput(input);
  const probe = createProbe(profile, {
    onUpdate: (p) => { if (onReady) onReady(p); },
  });

  // Close the observation window, persist what we learned, and finalize.
  const finalize = async () => {
    probe.refine();
    await remember(input, profile);
    if (onReady) onReady(profile);
    return profile;
  };
  // Host schedules finalize() after probeMs of listening (avoids timers here so
  // the module stays environment-agnostic / testable).
  return { profile, probe, learned: false, finalize, probeMs };
}

// ---- 1) instant classification from the device strings ----------------------
export function identifyMidiInput(input) {
  const name = (input && input.name) || '';
  const manufacturer = (input && input.manufacturer) || '';
  const hay = `${name} ${manufacturer}`;

  for (const p of PATTERNS) {
    const m = hay.match(p.test);
    if (m) {
      const prof = p.base(m);
      prof.portName = name;
      prof.source = /ble|bluetooth/i.test(hay) ? 'ble' : 'midi';
      return prof;
    }
  }
  reportUnknownDevice(name, manufacturer);
  return unknownProfile(name);
}

// ---- 2) live capability probe ----------------------------------------------
// Feed it raw MIDI status/data bytes for a short window after connect. It watches
// which channels/notes/CCs actually arrive and upgrades the profile in place.
//
// Heuristics:
//   • any note on ch.10 (0-indexed 9)            → drum pads
//   • note range spanning > 1 octave outside ch.10 → keyboard, sized to the span
//   • only CC (0xB0) traffic, no notes           → control surface
//   • pitch-bend (0xE0) / mod-wheel (CC1)        → wheels present
export function createProbe(profile, { onUpdate } = {}) {
  const seen = {
    padNotes: new Set(),
    keyNotes: new Set(),
    ccs: new Set(),
    pitchBend: false,
    modWheel: false,
    aftertouch: false,
    programChange: false,
  };
  let dirty = false;

  // A pad-only controller (JamJum JP-1 / JP mini, Korg nanoPAD, a launch grid)
  // has no keybed, so EVERY note it sends is a pad — regardless of channel.
  // These units are user-configurable and frequently ship set to channel 1, not
  // 10, which is exactly why a channel-10-only rule left their pads dead.
  const padOnly = () => !!(profile.pads && !(profile.keys && profile.keys.count));

  function feed(status, d1 /* data1 */, _d2) {
    const type = status & 0xf0;
    const chan = status & 0x0f;

    if (type === 0x90 /* note on */ && _d2 > 0) {
      if (chan === 9 || padOnly()) seen.padNotes.add(d1);
      else seen.keyNotes.add(d1);
      dirty = true;
    } else if (type === 0xb0 /* CC */) {
      seen.ccs.add(d1);
      if (d1 === 1) seen.modWheel = true;
      dirty = true;
    } else if (type === 0xe0 /* pitch bend */) {
      seen.pitchBend = true;
      dirty = true;
    } else if (type === 0xa0 /* poly key pressure */ || type === 0xd0 /* channel pressure */) {
      seen.aftertouch = true;
      dirty = true;
    } else if (type === 0xc0 /* program change */) {
      seen.programChange = true;
      dirty = true;
    }
  }

  // Call once the observation window closes (or on demand) to fold observations
  // into the profile. Returns the (possibly upgraded) profile.
  function refine() {
    if (!dirty) return profile;

    // pads
    if (seen.padNotes.size > 0 && !profile.pads) {
      const count = nextPadCount(seen.padNotes.size);
      profile.pads = { count, layout: padLayout(count), channel: 10, learn: true };
    }
    if (profile.pads) learnPadGrid(profile.pads, seen.padNotes);
    if (seen.aftertouch && !profile.features.includes('aftertouch')) profile.features.push('aftertouch');
    if (seen.programChange && !profile.features.includes('programChange')) profile.features.push('programChange');
    // keys
    if (seen.keyNotes.size > 1) {
      const lo = Math.min(...seen.keyNotes);
      const hi = Math.max(...seen.keyNotes);
      const span = hi - lo + 1;
      if (span > 12 && !profile.keys) {
        const count = nextKeyCount(span);
        profile.keys = { count, firstNote: lo };
      }
    }
    // wheels
    if (seen.pitchBend && !profile.wheels.includes('pitch')) profile.wheels.push('pitch');
    if (seen.modWheel && !profile.wheels.includes('mod')) profile.wheels.push('mod');
    // knobs (unique non-mod CCs observed)
    const knobCCs = [...seen.ccs].filter((c) => c !== 1).length;
    if (knobCCs > profile.knobs) profile.knobs = knobCCs;

    // (re)classify a previously-unknown device from what it actually did
    if (profile.class === CLASSES.CONTROL) {
      if (profile.keys && profile.pads) profile.class = CLASSES.HYBRID;
      else if (profile.keys) profile.class = CLASSES.KEYBOARD;
      else if (profile.pads) profile.class = profile.pads.count >= 32 ? CLASSES.GRID : CLASSES.PADS;
    }
    // probe-derived confidence floor
    if (profile.confidence < 0.5) profile.confidence = 0.5;

    if (onUpdate) onUpdate(profile);
    return profile;
  }

  return { feed, refine, seen };
}

// ---- pad numbering ----------------------------------------------------------
// Pads on these grids are numbered from the BOTTOM-LEFT, running left→right and
// upward: pad 1 bottom-left, pad 4 bottom-right, pad 16 top-right (confirmed on
// the JamJum JP mini in hand; it is also the MPC convention these units follow).
// We DRAW top-down, so the two orders are not the same and must be converted —
// getting this backwards mirrors the whole grid vertically, which is the sort of
// thing that only shows up once you're actually playing it.
//
//   padNumberAt(drawIndex) → the number printed on that pad, 1-based
//   drawIndexOfPad(padNo)  → where pad N lands in draw order, 0-based
export function padNumberAt(drawIndex, rows, cols) {
  const r = Math.floor(drawIndex / cols), c = drawIndex % cols;
  return (rows - 1 - r) * cols + c + 1;
}
export function drawIndexOfPad(padNo /* 0-based */, rows, cols) {
  const r = Math.floor(padNo / cols), c = padNo % cols;
  return (rows - 1 - r) * cols + c;
}

// Lock the grid to an EXPLICIT press order: pressed[k] is the note hardware pad
// k+1 sends, as taught by the user pressing pad 1, 2, 3 … in turn. This is the
// one mapping that cannot be wrong, because nothing is inferred — in particular
// it drops the assumption that a unit numbers its pads in ascending note order,
// which is only a convention and not something any of these units promises.
export function setPadMapFromPresses(pads, pressed) {
  if (!pads || !pressed || !pressed.length) return pads;
  const count = pads.count || nextPadCount(pressed.length);
  if (!pads.layout || !pads.layout[0]) pads.layout = padLayout(count);
  const [rows, cols] = pads.layout;
  const map = {};
  const drawn = new Array(count);
  pressed.forEach((n, i) => {
    const di = drawIndexOfPad(i % count, rows, cols);
    map[n] = di;
    if (i < count) drawn[di] = n;
  });
  pads.count = count;
  pads.notes = drawn;
  pads.noteMap = map;
  pads.learned = true;
  pads.taught = true;      // a taught map is final — never re-infer over it
  pads.learn = false;
  return pads;
}

// ---- pad-grid auto-learn ----------------------------------------------------
// The JamJum JP-1, JP mini and M-Vave SMK-25 all let you reassign every pad's
// note in their vendor software, and none of them publish a default note table.
// Hard-coding GM drum notes therefore mis-maps any unit the owner has touched.
// Instead we learn the grid from what the hardware actually plays:
//
//   notes sorted ascending → pad 1..N in HARDWARE order (bottom-left, going
//   right then up), then converted into draw order, overflowing into the next
//   bank past N.
//
// Writes two things onto the pads block:
//   notes[]  — the bank-A note per DRAWN pad, used for the drawn `data-note`
//   noteMap  — { note: drawIndex } across ALL banks, so a pad still lights and
//              fires after a bank switch changes the notes it sends.
// STABILITY IS THE WHOLE POINT HERE. Re-sorting the full set on every new note
// looks harmless but is not: a real JP-Mini ships a GM drum map whose notes are
// NOT contiguous (36 37 38 40 42 43 44 45 46 47 49 … 82), so as you discover
// pads in any order, every newly-found LOWER note pushed all the previously
// assigned pads up a slot. One pad measured walking 5→6→7→8→9 while its
// neighbours were being pressed — which is exactly "pad 9 fires pad 13".
//
// So an assignment, once made, is never moved. A new note takes the free slot
// nearest its ascending rank; already-placed pads stay put.
export function learnPadGrid(pads, padNotes) {
  if (!pads || pads.learn === false || !padNotes || !padNotes.size) return pads;
  const notes = [...padNotes].sort((a, b) => a - b);
  const count = pads.count || nextPadCount(notes.length);
  if (!pads.layout || !pads.layout[0]) pads.layout = padLayout(count);
  const [rows, cols] = pads.layout;
  const cap = count * (pads.banks || 1);

  const map = Object.assign({}, pads.noteMap || {});   // keep every prior placement
  // Work in HARDWARE pad numbers throughout; convert to draw order only at the
  // end. Prior placements are stored as draw indices, so map them back first.
  const takenPads = new Set();
  for (const k in map) takenPads.add(padNumberAt(map[k], rows, cols) - 1);
  const freeNear = (want) => {
    if (!takenPads.has(want)) return want;
    for (let d = 1; d < count; d++) {
      const up = want + d, dn = want - d;
      if (up < count && !takenPads.has(up)) return up;
      if (dn >= 0 && !takenPads.has(dn)) return dn;
    }
    return want;
  };

  let rank = 0;
  for (const n of notes) {
    if (rank >= cap) break;
    const padNo = rank % count;                                  // ascending rank
    rank++;
    if (map[n] != null) continue;                                // already placed — never move it
    const slot = freeNear(padNo);
    map[n] = drawIndexOfPad(slot, rows, cols);
    takenPads.add(slot);
  }

  const drawn = new Array(count);
  for (const k in map) { const di = map[k]; if (di < count && drawn[di] == null) drawn[di] = +k; }

  pads.count = count;
  pads.notes = drawn;
  pads.noteMap = map;
  pads.learned = true;
  // Until every pad has been played the map is a best guess in progress; the
  // face says so, and MAP PADS settles it exactly at any time.
  pads.provisional = notes.length < count;
  pads.seen = notes.length;
  return pads;
}

// snap an observed pad count up to the nearest common bank size
function nextPadCount(n) {
  for (const b of [4, 8, 12, 16, 25, 32, 64]) if (n <= b) return b;
  return 64;
}
function padLayout(count) {
  const map = { 4: [1, 4], 8: [2, 4], 12: [3, 4], 16: [4, 4], 25: [5, 5], 32: [4, 8], 64: [8, 8] };
  return map[count] || [Math.ceil(Math.sqrt(count)), Math.ceil(Math.sqrt(count))];
}
// snap an observed key span up to the nearest real keyboard size
function nextKeyCount(span) {
  for (const k of [25, 32, 37, 49, 61, 76, 88]) if (span <= k) return k;
  return 88;
}

// ---- gamepad → profile ------------------------------------------------------
export function identifyGamepad(gp) {
  return makeProfile({
    id: 'gamepad',
    class: CLASSES.GAMEPAD,
    source: 'gamepad',
    portName: (gp && gp.id) || 'Gamepad',
    pads: { count: (gp && gp.buttons && gp.buttons.length) || 16, layout: [0, 0], channel: 10 },
    confidence: gp && gp.mapping === 'standard' ? 0.9 : 0.6,
  });
}
