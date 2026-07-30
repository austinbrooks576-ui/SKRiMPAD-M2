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
  };
  let dirty = false;

  function feed(status, d1 /* data1 */, _d2) {
    const type = status & 0xf0;
    const chan = status & 0x0f;

    if (type === 0x90 /* note on */ && _d2 > 0) {
      if (chan === 9) seen.padNotes.add(d1);
      else seen.keyNotes.add(d1);
      dirty = true;
    } else if (type === 0xb0 /* CC */) {
      seen.ccs.add(d1);
      if (d1 === 1) seen.modWheel = true;
      dirty = true;
    } else if (type === 0xe0 /* pitch bend */) {
      seen.pitchBend = true;
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
      profile.pads = { count, layout: padLayout(count), channel: 10 };
    }
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
