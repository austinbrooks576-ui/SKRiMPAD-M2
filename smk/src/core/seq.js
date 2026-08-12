// seq.js — eight loop channels, up to thirty-two bars each, and the timing fix.
//
// TIME IS STORED IN BEATS, NEVER IN SECONDS. A part recorded at 90bpm and then
// played at 140 has to still be the same part; storing seconds would bake the
// tempo into the notes and make the tempo control a destructive edit. Seconds
// exist only at the moment a note is handed to the audio clock.
//
// EACH CHANNEL WRAPS ON ITS OWN LENGTH. A two-bar drum part under a
// thirty-two-bar arrangement is not a special case and does not need to be
// copied sixteen times — it simply comes round eight times as often. That falls
// out of giving every channel its own modulo instead of one global one, and it
// is what makes long-form arrangement possible without long-form editing.
//
// A CHANNEL IS TOGGLEABLE AND MUTING IS NOT ERASING. `on` gates the SOUND at
// the moment of scheduling and nothing else, so a muted channel keeps its
// position, keeps its notes, and comes back in time rather than from the top.

export const MAX_CHANNELS = 8;
export const MAX_BARS = 32;
export const BEATS_PER_BAR = 4;

// The grid a note can be pulled onto, in beats. 1/4 down to 1/32, plus the
// triplets, because a triplet part quantised to straight sixteenths is
// destroyed rather than tightened.
export const GRIDS = [
  { id: 'off', l: 'Off', beats: 0 },
  { id: '1/4', l: '1/4', beats: 1 },
  { id: '1/8', l: '1/8', beats: 0.5 },
  { id: '1/8T', l: '1/8T', beats: 1 / 3 },
  { id: '1/16', l: '1/16', beats: 0.25 },
  { id: '1/16T', l: '1/16T', beats: 1 / 6 },
  { id: '1/32', l: '1/32', beats: 0.125 },
];

export const blankChannel = (i) => ({
  id: i, name: 'CH' + (i + 1), on: true, bars: 4, events: [], vel: 1,
});

// ---- the timing fix -------------------------------------------------------
// "no open spaces of me trying to figure out my next key — just a note per
// note, key per key recording."
//
// snapOne pulls one position onto the grid. `strength` is 0..1: at 1 the note
// lands exactly on the grid, at 0.5 it moves half way there. Partial strength
// is not a nicety — hard-quantising a performance removes the thing that made
// it a performance, and 60-80% keeps the feel while removing the mistakes.
//
// THE WRAP IS THE PART THAT GOES WRONG. In a sixteen-beat loop, a note played
// at 15.98 beats is a note struggling to be the DOWNBEAT — it belongs at 0, not
// at 16, and 16 is outside the loop entirely. Rounding without wrapping either
// drops that note or leaves it hanging one tick before the end forever, which
// is exactly the "not quite together" that quantising was meant to fix.
export function snapOne(at, grid, strength, loopBeats) {
  if (!grid || grid <= 0) return at;
  const s = Math.max(0, Math.min(1, strength == null ? 1 : strength));
  if (s === 0) return at;
  const target = Math.round(at / grid) * grid;
  let out = at + (target - at) * s;
  if (loopBeats > 0) {
    // Fold back into the loop. Only a fully-quantised note can land exactly on
    // the end, so this rarely fires — but when it does it is the downbeat.
    out = ((out % loopBeats) + loopBeats) % loopBeats;
    if (Math.abs(out - loopBeats) < 1e-9) out = 0;
  }
  return out;
}

// Quantise a whole channel. Returns a NEW array — the caller decides whether to
// keep it, which is what makes undo possible without a history system.
export function quantize(events, grid, strength, loopBeats) {
  return (events || []).map((e) => Object.assign({}, e, {
    at: snapOne(e.at, grid, strength, loopBeats),
  }));
}

// ---- the machine ----------------------------------------------------------
// `now` returns audio time; `onFire` is handed (event, when) with `when` an
// absolute audio time, exactly like everything else in this app.
export function createSeq({ now, onFire, onTick } = {}) {
  const AHEAD = 0.20, TICK = 25;
  const chans = Array.from({ length: MAX_CHANNELS }, (_, i) => blankChannel(i));

  let bpm = 100;
  let playing = false, timer = 0;
  let originAt = 0;          // audio time of beat 0
  let scannedTo = 0;         // beats already committed
  let recording = -1;        // channel index being recorded into, or -1
  let grid = 0.25, strength = 1;   // live quantise-on-input

  const spb = () => 60 / Math.max(20, bpm);          // seconds per beat
  const loopBeats = (c) => Math.max(1, Math.min(MAX_BARS, c.bars)) * BEATS_PER_BAR;
  // Where the transport is, in beats since it started. Unbounded on purpose:
  // each channel takes its own modulo, so there is no single loop length to be
  // wrong about.
  const beatNow = () => (playing ? (now() - originAt) / spb() : 0);

  function fill() {
    if (!playing) return;
    const t = now();
    const from = scannedTo;
    const to = (t + AHEAD - originAt) / spb();
    if (to <= from) return;

    for (const c of chans) {
      // A muted channel is skipped HERE, at scheduling time, and nowhere else.
      // Its notes, its length and its position are all untouched, so unmuting
      // drops it back in on the beat instead of restarting it.
      if (!c.on || !c.events.length) continue;
      const len = loopBeats(c);
      // Which repeats of this channel overlap the window being filled.
      const firstRep = Math.floor(from / len);
      const lastRep = Math.floor(to / len);
      for (let rep = firstRep; rep <= lastRep; rep++) {
        const base = rep * len;
        for (const e of c.events) {
          const beat = base + e.at;
          // Half-open interval. A note exactly on the boundary belongs to
          // exactly one window — closed on both sides fires it twice, which is
          // the flam nobody can find.
          if (beat < from || beat >= to) continue;
          const when = originAt + beat * spb();
          if (when < t - 0.05) continue;    // the machine stalled; drop it
          onFire && onFire(e, Math.max(when, t + 0.008), c);
        }
      }
    }
    scannedTo = to;
    onTick && onTick(beatNow());
  }

  return {
    channels: chans,
    get playing() { return playing; },
    // Top the queue up now rather than at the next tick. The interval calls
    // exactly this, so a caller driving it by hand — a test with its own clock —
    // exercises the real scheduler instead of a second copy of it.
    pump() { fill(); },
    get bpm() { return bpm; },
    setBpm(v) {
      // Changing tempo while running must not make the music jump. The origin
      // is moved so that the CURRENT beat stays the current beat under the new
      // spacing — without this, doubling the tempo teleports the playhead to
      // twice its position and every channel restarts somewhere random.
      const b = beatNow();
      bpm = Math.max(20, Math.min(300, v || 100));
      if (playing) { originAt = now() - b * spb(); scannedTo = b; }
    },
    setQuantize(g, s) { grid = g; strength = s == null ? strength : s; },
    get quantize() { return { grid, strength }; },
    get beat() { return beatNow(); },
    // Where each channel is inside its own loop, 0..1 — for drawing playheads.
    positions() {
      const b = beatNow();
      return chans.map((c) => (b % loopBeats(c)) / loopBeats(c));
    },
    play() {
      if (playing) return;
      playing = true;
      originAt = now() + 0.03;
      scannedTo = 0;
      fill();
      timer = setInterval(fill, TICK);
    },
    stop() {
      playing = false; recording = -1;
      if (timer) { clearInterval(timer); timer = 0; }
    },
    toggle(i) { const c = chans[i]; if (c) c.on = !c.on; return c && c.on; },
    setBars(i, n) {
      const c = chans[i]; if (!c) return;
      c.bars = Math.max(1, Math.min(MAX_BARS, n | 0));
      // Notes now past the end are FOLDED back rather than deleted. Shortening
      // a channel to audition a tighter loop should not destroy the take —
      // lengthening it again brings the part back.
      const len = loopBeats(c);
      c.events = c.events.map((e) => (e.at < len ? e : Object.assign({}, e, { at: e.at % len })));
    },
    arm(i) { recording = (i >= 0 && i < MAX_CHANNELS) ? i : -1; },
    get armed() { return recording; },
    // Record one event, at the moment it happened. Quantised on the way IN so
    // what you see is what you will hear — quantising only on playback means the
    // grid lies about where the note is.
    capture(ev) {
      if (recording < 0 || !playing) return false;
      const c = chans[recording];
      const len = loopBeats(c);
      const raw = ((beatNow() % len) + len) % len;
      c.events.push(Object.assign({}, ev, {
        at: snapOne(raw, grid, strength, len), raw,
      }));
      return true;
    },
    // Put a note somewhere by hand — the drag-and-drop and grid-editing path.
    add(i, ev) {
      const c = chans[i]; if (!c) return;
      const len = loopBeats(c);
      c.events.push(Object.assign({}, ev, { at: ((ev.at % len) + len) % len }));
    },
    clear(i) { if (i == null) chans.forEach((c) => { c.events = []; }); else if (chans[i]) chans[i].events = []; },
    // Re-quantise what is already recorded, from the ORIGINAL timing every
    // time. Quantising a quantised part again would compound the error and
    // eventually flatten everything onto the grid however gentle each pass was.
    requantize(i, g, s) {
      const c = chans[i]; if (!c) return;
      const len = loopBeats(c);
      c.events = c.events.map((e) => Object.assign({}, e, {
        at: snapOne(e.raw == null ? e.at : e.raw, g, s, len),
      }));
    },
    // Everything, as plain data — for saving, and for export.
    snapshot() {
      return { bpm, channels: chans.map((c) => ({ id: c.id, name: c.name, on: c.on, bars: c.bars, vel: c.vel, events: c.events.map((e) => Object.assign({}, e)) })) };
    },
    restore(s) {
      if (!s || !Array.isArray(s.channels)) return;
      bpm = s.bpm || bpm;
      s.channels.forEach((sc, i) => {
        const c = chans[i]; if (!c || !sc) return;
        c.name = sc.name || c.name;
        c.on = sc.on !== false;
        c.bars = Math.max(1, Math.min(MAX_BARS, sc.bars || 4));
        c.vel = sc.vel == null ? 1 : sc.vel;
        c.events = Array.isArray(sc.events) ? sc.events.map((e) => Object.assign({}, e)) : [];
      });
    },
  };
}

// ---- export ---------------------------------------------------------------
// A Standard MIDI File, type 1: one track per channel, so the arrangement
// arrives in a DAW as eight separate parts rather than one flattened lump that
// has to be split by hand.
//
// Written by hand rather than with a library because the format is small and a
// dependency that has to be inlined into a single self-contained HTML file
// costs more than the forty lines it saves.
export function toMidi(snap, ppq = 480) {
  const bytes = [];
  const push = (...b) => b.forEach((x) => bytes.push(x & 0xff));
  const push16 = (v) => push(v >> 8, v);
  const push32 = (v) => push(v >> 24, v >> 16, v >> 8, v);
  // A variable-length quantity: seven bits per byte, high bit set on all but
  // the last. Every delta time in the file is one of these.
  const vlq = (v) => {
    const out = [v & 0x7f];
    v >>= 7;
    while (v > 0) { out.unshift((v & 0x7f) | 0x80); v >>= 7; }
    return out;
  };

  const live = snap.channels.filter((c) => c.events.length);
  const trackCount = live.length + 1;         // +1 for the tempo map

  push(0x4d, 0x54, 0x68, 0x64); push32(6);
  push16(1); push16(trackCount); push16(ppq);

  const track = (events) => {
    const body = [];
    let last = 0;
    events.forEach((e) => {
      const delta = Math.max(0, Math.round(e.tick - last));
      body.push(...vlq(delta), ...e.data);
      last = e.tick;
    });
    body.push(...vlq(0), 0xff, 0x2f, 0x00);   // end of track
    push(0x4d, 0x54, 0x72, 0x6b); push32(body.length);
    body.forEach((b) => push(b));
  };

  // Tempo map. µs per quarter note, three bytes.
  const us = Math.round(60000000 / Math.max(20, snap.bpm || 100));
  track([{ tick: 0, data: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] }]);

  live.forEach((c, idx) => {
    // The LONGEST channel decides how far every other one is repeated, so the
    // exported file is an arrangement rather than eight loops of different
    // lengths that stop at different times.
    const longest = Math.max(...snap.channels.filter((x) => x.events.length).map((x) => x.bars)) * BEATS_PER_BAR;
    const len = c.bars * BEATS_PER_BAR;
    const reps = Math.max(1, Math.round(longest / len));
    const ch = Math.min(15, idx);
    const list = [];
    for (let r = 0; r < reps; r++) {
      c.events.forEach((e) => {
        const start = (r * len + e.at) * ppq;
        const dur = Math.max(ppq / 16, (e.len || 0.25) * ppq);
        const note = Math.max(0, Math.min(127, e.note | 0));
        const vel = Math.max(1, Math.min(127, e.vel | 0 || 100));
        list.push({ tick: start, data: [0x90 | ch, note, vel] });
        list.push({ tick: start + dur, data: [0x80 | ch, note, 0] });
      });
    }
    // Delta times are differences, so the list has to be in time order — and
    // note-offs interleave with the note-ons that follow them.
    list.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
    track(list);
  });

  return new Uint8Array(bytes);
}
