// mix.js — how loud things are, in one place.
//
// This exists because "the sound is over powering and popping" could not be
// investigated: the numbers that decide it were spread across three voice
// builders inside the app's HTML, mixed in with knob arithmetic, so there was
// nowhere to measure and nowhere to change. Now the defaults live here, the
// app derives its voices from them, and smk/test/mix.cjs renders a passage and
// measures the result — so loudness is a number that can fail a build rather
// than an argument.
//
// TWO SEPARATE PROBLEMS, and conflating them is why this kind of thing does not
// get fixed:
//
//   OVERPOWERING is level. Too many voices summing past the ceiling, so the
//   limiter stops being a safety net and starts being the sound.
//
//   POPPING is discontinuity — a waveform that jumps between one sample and
//   the next. It happens at ANY volume, and turning things down does not fix
//   it. Its causes here are an envelope cut before it reached zero, and notes
//   whose attack is longer than the gap between them.

// HEADROOM. Every voice is scaled by this before the master stage sees it.
//
// The arithmetic nobody does: N equally loud voices sum to roughly √N times one
// voice for uncorrelated material, and to N times for correlated material —
// and an arpeggio playing the same waveform at the same phase is very
// correlated. Eight pads plus a four-note chord plus a sixteenth-note arpeggio
// is comfortably a dozen voices at once, and a dozen voices at unity is 20dB
// over one voice. The limiter then flattens all of it, which is exactly what
// "overpowering" sounds like: loud, and with no dynamics left.
export const HEADROOM = 0.62;

// A gap is what makes a sequence of notes sound like notes rather than a chord.
// An arpeggio at 1/16 and 120bpm is a note every 125ms; an attack of 300ms —
// which is what the app's ATTACK knob produced at its centre position — means
// every note is still rising when the next one starts, so they stack instead of
// articulating. That is not a level problem and no amount of turning down fixes
// it. A plucked voice therefore caps its own attack.
export const PLUCK_ATTACK = 0.006;

// The voice defaults, before any knob touches them. `gain` here is the level
// BEFORE headroom; the app multiplies.
export const voiceLimits = {
  key: {
    gain: 0.55 * HEADROOM, attack: 0.004, decay: 0.4, sustain: 0.7, release: 0.5,
    cutoff: 0.55, res: 0.2, drive: 0, space: 0, spread: 0.3, pan: 0, tune: 0,
  },
  // A pad is a drum: its shape lives inside its own layers, so it is louder per
  // voice and shorter, and it does not stack the way a held note does.
  pad: {
    gain: 0.80 * HEADROOM, attack: 0.001, decay: 0.4, sustain: 0, release: 0.12,
    cutoff: 0.75, res: 0.2, drive: 0.15, space: 0, spread: 0, pan: 0, tune: 0,
  },
  // An arpeggiated note is a pluck. Short attack so it articulates, and quieter
  // than a played note because there are sixteen of them a bar and you did not
  // press sixteen keys.
  arp: {
    gain: 0.42 * HEADROOM, attack: PLUCK_ATTACK, decay: 0.12, sustain: 0, release: 0.09,
    cutoff: 0.6, res: 0.2, drive: 0, space: 0, spread: 0.2, pan: 0, tune: 0,
  },
};

// Turn a played voice into a plucked one of a given length. Used for every note
// the arpeggiator and the sequencer fire, because both produce notes whose
// length is decided by a control rather than by a finger.
//
// The attack is CAPPED, not replaced: a player who has wound the attack knob
// down to nothing should still get nothing, but one who has wound it up should
// not get an arpeggio that never articulates.
export function pluck(v, len) {
  const L = Math.max(0.03, len || 0.12);
  return Object.assign({}, v, {
    attack: Math.min(v.attack, PLUCK_ATTACK),
    decay: Math.max(0.03, L * 0.7),
    sustain: 0,
    release: Math.max(0.03, L * 0.35),
    gain: v.gain * 0.78,
  });
}
