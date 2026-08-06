// harmony.js — one decision, and nothing can be out of key afterwards.
//
// THE IDEA THIS COMES FROM, AND HOW IT DIFFERS. GarageBand lowers its floor by
// handing you an instrument that has no wrong notes on it: Smart Strings shows
// you chord strips, so voice leading and fingering are simply not questions you
// can get wrong. You make the decision anyone can make — which chord — and the
// app supplies the skill almost nobody has.
//
// That is the right idea and the wrong mechanism for this app, because
// ULTIMATE has no on-screen instrument to constrain. It is MIDI-first: the
// keys are on your desk, and they are real keys, all twelve of them per octave.
//
// So it does the same job from the other end. Instead of drawing an instrument
// with only good notes on it, it FIXES THE NOTES COMING OFF YOUR REAL ONE —
// every incoming note folds to the nearest note in the song's scale before it
// reaches a voice. You keep your keyboard, your velocity, your pitch bend and
// your pedal; you just cannot land on a note that is not in the key. That
// option is only open to an app built this way, and it is not something a
// touchscreen instrument can do at all.
//
// The second half is that a genre now writes PITCH as well as rhythm, and it
// voices a chord ACROSS THE PADS rather than inside one. Each cell is one voice
// — it cannot play a triad — but sixteen cells can: the sub takes the root, the
// stab takes the fifth, the bell takes the third, and the chord is a property of
// the kit rather than of any pad in it. Sixteen monophonic voices being better
// at chords than one polyphonic one is a fact about THIS app's shape, which is
// why it is worth doing this way.

export const ROOTS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// Intervals from the root, in semitones. Minor first because most of the
// thirty-four genres live there.
export const MODES = {
  minor:      { l: 'minor',      iv: [0, 2, 3, 5, 7, 8, 10] },
  major:      { l: 'major',      iv: [0, 2, 4, 5, 7, 9, 11] },
  dorian:     { l: 'dorian',     iv: [0, 2, 3, 5, 7, 9, 10] },
  phrygian:   { l: 'phrygian',   iv: [0, 1, 3, 5, 7, 8, 10] },
  mixolydian: { l: 'mixolydian', iv: [0, 2, 4, 5, 7, 9, 10] },
  lydian:     { l: 'lydian',     iv: [0, 2, 4, 6, 7, 9, 11] },
  harmonic:   { l: 'harmonic',   iv: [0, 2, 3, 5, 7, 8, 11] },
  pentatonic: { l: 'pentatonic', iv: [0, 3, 5, 7, 10] },
};
export const MODE_IDS = Object.keys(MODES);

export const DEFAULT_KEY = { root: 9, mode: 'minor', fold: true };   // A minor

// ---------------------------------------------------------------------------
// FOLDING — the part that makes a real keyboard beginner-proof.
// ---------------------------------------------------------------------------

// The nearest note in the key, keeping the octave. A tie goes DOWN: the note
// between two scale tones is usually a raised degree leaning upward, and
// flattening it lands on the more consonant of the two more often than
// sharpening does. It also means a chromatic run down a keyboard steps evenly
// rather than sticking.
//
// This is deliberately NOT "quantise to scale" hidden in a settings page. It is
// on by default, it applies to everything the controller sends, and there is one
// switch to turn it off for someone who knows what they are playing.
export function foldNote(note, key) {
  if (!key || key.fold === false) return note;
  const iv = (MODES[key.mode] || MODES.minor).iv;
  const root = ((key.root | 0) % 12 + 12) % 12;
  const pc = ((note - root) % 12 + 12) % 12;
  let best = iv[0], bestD = 99;
  for (let i = 0; i < iv.length; i++) {
    const d = Math.abs(iv[i] - pc);
    // < rather than <=, walking upward, means the FIRST (lower) of two equally
    // distant scale tones wins. That is the tie-goes-down rule.
    if (d < bestD) { bestD = d; best = iv[i]; }
  }
  return note + (best - pc);
}

// How far a note had to move. The MIDI window shows this so the fold is visible
// rather than mysterious — a key that silently changes what you played is worse
// than one that plays a wrong note, because you cannot tell it is happening.
export function foldShift(note, key) { return foldNote(note, key) - note; }

export function keyName(key) {
  const k = key || DEFAULT_KEY;
  return ROOTS[((k.root | 0) % 12 + 12) % 12] + ' ' + (MODES[k.mode] || MODES.minor).l;
}
// The short form for the transport button, where there is room for two or three
// characters and not one more.
export function keyShort(key) {
  const k = key || DEFAULT_KEY;
  const r = ROOTS[((k.root | 0) % 12 + 12) % 12];
  return r + (k.mode === 'major' || k.mode === 'lydian' ? '' : 'm');
}

// ---------------------------------------------------------------------------
// PROGRESSIONS
//
// Four chords, one per beat of the sixteen-step bar.
//
// A progression normally spans four BARS, not four beats. But a scene here is
// one bar, and scenes are alternatives you switch between rather than bars that
// follow one another — so a progression written across scenes would only ever be
// heard by someone who happened to switch in order. Putting it across the beats
// of the one bar means every scene contains the whole progression and every
// scene is in the same key, so switching never lurches.
//
// Numbers are SCALE DEGREES, zero-based: 0 is the tonic, 5 is the sixth degree.
// Which chord that produces depends on the mode, which is the point — the same
// [0,5,3,4] is a different progression in minor and in dorian, and both are
// correct for their genre.
// ---------------------------------------------------------------------------
const FAMILY = {
  hiphop:  { mode: 'minor',      prog: [0, 5, 2, 6] },   // i · VI · III · VII
  house:   { mode: 'minor',      prog: [0, 6, 5, 6] },
  bass:    { mode: 'minor',      prog: [0, 0, 5, 5] },
  groove:  { mode: 'dorian',     prog: [0, 3, 0, 4] },   // the modal vamp
  air:     { mode: 'major',      prog: [0, 5, 3, 4] },
};

// Per genre, where a genre has a signature of its own. Everything not named
// here takes its family's. A table, so adding one is adding a row.
const GENRE_KEY = {
  lofi:       { mode: 'dorian',     prog: [1, 4, 0, 0] },   // the ii-V-I everybody borrows
  boombap:    { mode: 'minor',      prog: [0, 5, 0, 4] },
  oldschool:  { mode: 'minor',      prog: [0, 5, 0, 4] },
  westcoast:  { mode: 'minor',      prog: [0, 4, 0, 4] },
  memphis:    { mode: 'phrygian',   prog: [0, 0, 1, 0] },   // the flat second is the whole sound
  drill:      { mode: 'phrygian',   prog: [0, 0, 5, 0] },
  grime:      { mode: 'phrygian',   prog: [0, 1, 0, 6] },
  trap:       { mode: 'minor',      prog: [0, 0, 5, 4] },
  dirtysouth: { mode: 'minor',      prog: [0, 5, 3, 5] },

  techno:     { mode: 'minor',      prog: [0, 0, 0, 0] },   // static on purpose
  industrial: { mode: 'phrygian',   prog: [0, 0, 0, 1] },
  psytrance:  { mode: 'phrygian',   prog: [0, 0, 0, 0] },
  trance:     { mode: 'minor',      prog: [0, 5, 2, 6] },   // the euphoric one
  house:      { mode: 'minor',      prog: [0, 3, 5, 4] },
  disco:      { mode: 'major',      prog: [0, 5, 1, 4] },
  hardcore:   { mode: 'minor',      prog: [0, 0, 6, 6] },

  jungle:     { mode: 'minor',      prog: [0, 0, 6, 0] },
  hardstep:   { mode: 'minor',      prog: [0, 0, 0, 6] },
  dubstep:    { mode: 'minor',      prog: [0, 0, 5, 5] },
  tripstep:   { mode: 'minor',      prog: [0, 5, 0, 5] },
  breakcore:  { mode: 'harmonic',   prog: [0, 6, 5, 4] },
  garage:     { mode: 'dorian',     prog: [1, 4, 0, 5] },
  dub:        { mode: 'minor',      prog: [0, 0, 3, 3] },

  afrobeats:  { mode: 'major',      prog: [0, 4, 5, 3] },
  amapiano:   { mode: 'minor',      prog: [0, 3, 5, 4] },
  dancehall:  { mode: 'minor',      prog: [0, 5, 3, 4] },
  reggaeton:  { mode: 'minor',      prog: [0, 5, 3, 4] },
  funk:       { mode: 'dorian',     prog: [0, 0, 3, 3] },   // one-chord vamp with a lift
  tribal:     { mode: 'pentatonic', prog: [0, 0, 0, 0] },

  ambient:    { mode: 'lydian',     prog: [0, 0, 3, 3] },
  cinematic:  { mode: 'minor',      prog: [0, 5, 0, 4] },
  synthwave:  { mode: 'minor',      prog: [0, 5, 2, 6] },
  vaporwave:  { mode: 'major',      prog: [3, 4, 2, 5] },   // the woozy one
  viking:     { mode: 'harmonic',   prog: [0, 0, 6, 0] },
};

export function keyForGenre(id, root) {
  const g = GENRE_KEY[id] || FAMILY.hiphop;
  return { root: root == null ? DEFAULT_KEY.root : root, mode: g.mode, prog: g.prog };
}

// The triad on a scale degree, as SEMITONES ABOVE THE KEY ROOT. Built by
// stacking scale thirds rather than by looking chords up, which is what makes
// one table of degrees work in eight different modes: in minor the second
// degree comes out diminished and in dorian it comes out minor, because the
// scale says so and nothing here had to know that.
export function triad(degree, mode) {
  const iv = (MODES[mode] || MODES.minor).iv;
  const n = iv.length;
  const at = (k) => iv[k % n] + 12 * Math.floor(k / n);
  const d = ((degree | 0) % n + n) % n;
  return [at(d), at(d + 2), at(d + 4)];
}

// ---------------------------------------------------------------------------
// VOICING ACROSS THE KIT
// ---------------------------------------------------------------------------

// Which chord tone each role takes, and roughly where it sits. `t` indexes the
// triad: 0 root, 1 third, 2 fifth. `oct` nudges the register so the parts do
// not all pile into the same octave and cancel each other's definition.
//
// A pad is one voice and cannot play a triad. Sixteen pads can — so the chord
// is spread over the kit, and every pad plays one note, which is the only thing
// any of them could do anyway. This is the shape of the app being used rather
// than worked around.
const VOICING = {
  SUB:   { t: 0, oct: 0 },
  BASS:  { t: 0, oct: 0, alt: 2 },   // root, with the fifth on the offbeats
  PAD:   { t: 0, oct: 0 },
  ATMOS: { t: 2, oct: 0 },
  STAB:  { t: 2, oct: 0 },
  BELL:  { t: 1, oct: 1 },
  PLUCK: { t: 1, oct: 0, alt: 2 },
  LEAD:  { t: 0, oct: 0, walk: 1 },  // walks the chord tones instead of holding one
};
export const PITCHED = Object.keys(VOICING);

// Put a pitch class in the octave nearest a reference note, so a part keeps the
// register its voice was designed for. BASS was tuned to sit at note 38 and SUB
// at 26; writing them both an absolute pitch would collapse that separation and
// turn the low end to mud.
function place(semi, around) {
  return semi + 12 * Math.round((around - semi) / 12);
}

// The note a role should play on a given step, as an offset from that pad's own
// note — because that is what survives the user retuning the pad. Retuning then
// transposes the whole part, which is what anyone would expect it to do.
export function noteFor(role, step, key, baseNote, hitIndex) {
  const v = VOICING[role];
  if (!v) return 0;
  const prog = (key && key.prog) || FAMILY.hiphop.prog;
  const deg = prog[Math.floor((step & 15) / 4) % prog.length];
  const tones = triad(deg, key && key.mode);
  let t = v.t;
  // The fifth on offbeats, for the roles that alternate — this is what makes a
  // bass line a bass LINE rather than a repeated root.
  if (v.alt != null && (step & 1)) t = v.alt;
  // A lead that holds one note is not a lead. Walking by which hit this is,
  // rather than by step, keeps the movement musical on a sparse pattern.
  if (v.walk) t = (hitIndex || 0) % 3;
  const root = ((key && key.root) | 0);
  const abs = root + tones[t % 3] + (v.oct || 0) * 12;
  const target = place(abs, baseNote);
  // The engine clamps tune to two octaves; going further would silently do
  // nothing, so it is clamped here where it can be reasoned about.
  return Math.max(-24, Math.min(24, target - baseNote));
}
