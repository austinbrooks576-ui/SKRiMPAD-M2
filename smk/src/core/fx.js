// fx.js — the master effects rack, toggleable.
//
// M2 advertised its rack as EQ, comp, reverb, delay, filter, distortion, and
// that is exactly the set here — rebuilt against this engine rather than
// copied, because M2's source is not in this repo and its rack ran per
// channel; this one is a MASTER rack behind one seam (engine.patchFx), which
// is the simple version of the idea.
//
// EVERY UNIT IS A TOGGLE, NOT A PANEL. Six switches, no parameter pages. Each
// unit ships at one musical setting, chosen the way a pedal is voiced: the
// point of a toggle is that flipping it is always safe and always sounds like
// something. The knobs already run the voice; the rack runs the ROOM.
//
// ORDER IS FIXED: EQ → COMP → DRIVE → FILTER → DELAY → VERB. Tone shaping
// before dynamics, dynamics before dirt, dirt before the filter that tames it,
// and time effects last so echoes are echoes OF the finished sound rather than
// raw material for the compressor to chew. Making the order configurable
// would multiply the states to test by 720 and help nobody.
//
// THE CHAIN LIVES BEHIND THE ENGINE'S SEAM, which sits before the master
// compressor and ceiling — so nothing a unit does (delay feedback, drive
// make-up, resonance) can ever be the thing that clips the output.

export const FX_UNITS = [
  { id: 'eq',     l: 'EQ',     d: 'A gloss curve: a little low-shelf warmth, a dip where mud lives, a lift of air at the top.' },
  { id: 'comp',   l: 'COMP',   d: 'A working compressor on top of the safety one — squeezes the mix together so parts sit as one thing.' },
  { id: 'drive',  l: 'DRIVE',  d: 'Master saturation. Harmonics and weight across everything at once, level-compensated.' },
  { id: 'filter', l: 'FILTER', d: 'The performance filter: a resonant low-pass that pulls the whole mix underwater. For builds and drops.' },
  { id: 'delay',  l: 'DELAY',  d: 'A dotted-eighth echo, timed to the tempo, dark enough to sit behind the dry signal.' },
  { id: 'verb',   l: 'VERB',   d: 'A small master room. Glue, not a cathedral — the sends on each voice stay for the big spaces.' },
];

export const defaultFx = () => ({ eq: false, comp: false, drive: false, filter: false, delay: false, verb: false });

// Each builder wires input→output and returns nothing it needs remembered —
// the whole chain is rebuilt on any toggle, which at six nodes deep is
// microseconds and means there is no per-unit enable state to get wrong.
const UNIT = {
  eq(ctx, a, b) {
    const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 130; lo.gain.value = 3;
    const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 380; mud.Q.value = 1.1; mud.gain.value = -2.5;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 7800; air.gain.value = 2.5;
    a.connect(lo); lo.connect(mud); mud.connect(air); air.connect(b);
  },
  comp(ctx, a, b) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -20; c.knee.value = 10; c.ratio.value = 5;
    c.attack.value = 0.004; c.release.value = 0.14;
    // Make-up gain, modest on purpose: a comp toggle that doubles the volume
    // reads as "louder is better" and lies about what it is doing.
    const mk = ctx.createGain(); mk.gain.value = 1.35;
    a.connect(c); c.connect(mk); mk.connect(b);
  },
  drive(ctx, a, b) {
    const pre = ctx.createGain(); pre.gain.value = 1.7;
    const ws = ctx.createWaveShaper();
    // Odd length so zero maps to exactly zero — the same DC lesson the engine's
    // curves already carry.
    const N = 1025, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) { const x = (i / ((N - 1) / 2)) - 1; curve[i] = Math.tanh(x * 2.4); }
    curve[(N - 1) / 2] = 0;
    ws.curve = curve; ws.oversample = '2x';
    // LEVEL COMPENSATION IS A PRODUCT OF THREE NUMBERS, not one. The
    // small-signal gain through this unit is pre × curve-slope × post, and the
    // curve's own slope at zero is its k (2.4) — the first version compensated
    // the pre-gain and forgot the slope, so the toggle came out 2.5× louder
    // and "sounded better" the way louder always does. 0.26 ≈ 1/(1.7·2.4)
    // brings a quiet signal through at unity, so what the switch changes is
    // the TONE.
    const post = ctx.createGain(); post.gain.value = 0.26;
    a.connect(pre); pre.connect(ws); ws.connect(post); post.connect(b);
  },
  filter(ctx, a, b) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.value = 820; f.Q.value = 2.8;
    a.connect(f); f.connect(b);
  },
  delay(ctx, a, b, bpm) {
    // Dry straight through; the echo in parallel. A master delay that replaces
    // the dry signal turns the whole mix to soup on the first repeat.
    a.connect(b);
    const beat = 60 / Math.max(20, Math.min(300, bpm || 100));
    const d = ctx.createDelay(2.0); d.delayTime.value = Math.min(1.99, beat * 0.75);   // dotted eighth
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 2600;
    const wet = ctx.createGain(); wet.gain.value = 0.32;
    a.connect(d); d.connect(tone); tone.connect(fb); fb.connect(d);
    tone.connect(wet); wet.connect(b);
  },
  verb(ctx, a, b) {
    a.connect(b);
    // Two short mutually-fed delays — the same trick as the engine's send bus,
    // sized down to a room. Co-prime-ish times so the repeats do not stack into
    // one flutter.
    const d1 = ctx.createDelay(0.5); d1.delayTime.value = 0.067;
    const d2 = ctx.createDelay(0.5); d2.delayTime.value = 0.093;
    const g1 = ctx.createGain(); g1.gain.value = 0.52;
    const g2 = ctx.createGain(); g2.gain.value = 0.52;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 4200;
    const wet = ctx.createGain(); wet.gain.value = 0.28;
    a.connect(d1); d1.connect(g1); g1.connect(d2); d2.connect(g2); g2.connect(d1);
    g1.connect(tone); g2.connect(tone); tone.connect(wet); wet.connect(b);
  },
};

// The chain builder, in the shape engine.patchFx expects. Returns true when at
// least one unit is in (so the caller knows the straight wire was replaced),
// null when everything is off — patchFx(null-equivalent) keeps the dry wire.
export function buildFxChain(state, bpm) {
  const on = FX_UNITS.filter((u) => state && state[u.id]);
  if (!on.length) return null;
  return (ctx, input, output) => {
    // THE CHAIN NEVER WIRES THE SEAM'S OWN NODES TO EACH OTHER. After a build
    // succeeds, the seam removes its straight input→output wire — with
    // disconnect(output), which removes EVERY connection between those two
    // nodes. A unit like the delay legitimately builds its own dry path from
    // its `a` to its `b`; if those happened to BE the seam's nodes (one unit
    // switched on, nothing else), the cleanup tore the unit's dry path out
    // with the straight wire and the delay lost its dry signal. So the chain
    // brackets itself in two gains of its own, and the seam's nodes only ever
    // touch those.
    const head0 = ctx.createGain(), tailN = ctx.createGain();
    input.connect(head0); tailN.connect(output);
    let head = head0;
    on.forEach((u, i) => {
      const tail = i === on.length - 1 ? tailN : ctx.createGain();
      UNIT[u.id](ctx, head, tail, bpm);
      head = tail;
    });
    return true;
  };
}
