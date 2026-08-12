// velocity.js — how hard you hit it.
//
// VEL is the shifted function on PAD-B, and what it governs is the whole
// reason a velocity-sensitive pad costs more than a switch: the force of the
// hit should reach the sound, not just its volume.
//
// TWO THINGS VELOCITY MUST DO, and the app was only doing one:
//
//   LEVEL      harder is louder. This has always worked.
//   BRIGHTNESS harder is brighter. A real instrument struck harder produces
//              more high harmonics, and the ear reads brightness as EFFORT far
//              more readily than it reads level — which is why a sample that
//              only changes volume sounds like a volume knob rather than like
//              somebody playing. engine.hold() did this for held keys; play()
//              did not, so every pad, every sequenced note and every
//              arpeggiated note was flat.
//
// THE CURVE IS THE OTHER HALF. Pads and keybeds differ enormously in how hard
// you have to hit them to send 127, and a player's hands differ more. A curve
// is the one control that makes an instrument fit the person: without it the
// answer to "my pads are too quiet" is "hit them harder", which is not an
// answer.

export const CURVES = [
  { id: 'soft',   l: 'SOFT',   d: 'A light touch reaches full volume. For quiet playing, or a stiff pad — the fix for "I have to hammer it".' },
  { id: 'linear', l: 'LINEAR', d: 'What the keyboard sends is what you get. Honest, and the right place to start.' },
  { id: 'hard',   l: 'HARD',   d: 'Full volume takes a real hit. Widens the quiet end, so soft playing has somewhere to go.' },
  { id: 'fixed',  l: 'FIXED',  d: 'Every hit at the same strength. For programming drums when consistency matters more than feel.' },
];

export const DEFAULT_CURVE = 'linear';
// What FIXED plays everything at. Not 127: a fixed velocity at maximum leaves
// the mix no headroom and makes the FIXED setting quietly the loudest one.
export const FIXED_VEL = 100;

// A MIDI velocity in, a MIDI velocity out. 1..127 both ends, because
// everything downstream — the engine, the looper, the sequencer, the exported
// MIDI file — speaks that and a 0..1 float here would mean four conversions
// instead of none.
//
// The exponents are gentle on purpose. A curve steep enough to be obvious on a
// test tone is unplayable: 0.6 and 1.7 change the FEEL across the middle of
// the range, which is where hands actually live, without making either end
// unreachable.
export function applyCurve(vel, curve) {
  const v = Math.max(1, Math.min(127, Math.round(vel == null ? 100 : vel)));
  if (curve === 'fixed') return FIXED_VEL;
  if (curve === 'soft') return Math.max(1, Math.round(127 * Math.pow(v / 127, 0.6)));
  if (curve === 'hard') return Math.max(1, Math.round(127 * Math.pow(v / 127, 1.7)));
  return v;
}

// How much brighter a hit at this velocity should be, as a multiplier on the
// voice's own cutoff. Kept here rather than in the engine so the pad path and
// the key path cannot drift apart — they were already apart, which is the bug
// this file exists to close.
//
// 0.55 at silence to 1.30 at full: enough that a hard hit is audibly open and
// a soft one audibly closed, not so much that a quiet note disappears.
export const brightnessFor = (vel) => 0.55 + (Math.max(1, Math.min(127, vel || 100)) / 127) * 0.75;
