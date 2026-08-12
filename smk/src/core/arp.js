// arp.js — the arpeggiator, and the twelve rhythms.
//
// THE ONE IDEA THAT MAKES THIS SIMPLE: an arpeggiator answers WHICH note, and a
// rhythm answers WHEN. They are two separate questions and this file keeps them
// separate, which is why a rhythm works under any mode and a mode works under
// any rhythm without a table of special cases.
//
//     mode   →  the ORDER the held notes are visited in     (UP, DOWN, RAND…)
//     rate   →  how often a step happens                    (1/8, 1/16T…)
//     rhythm →  whether that step SOUNDS, and how hard      (16 weights, 0=rest)
//     gate   →  how much of the step the note holds for
//     swing  →  how late the off-steps land
//
// Every one of those is independent. A step arrives; the rhythm decides whether
// it is a rest; if it is not, the mode says which note; gate says how long.
//
// ORDER IS COMPUTED, NOT REMEMBERED. The sequence is derived from the held
// notes and a step counter every time, so adding a note to a running arpeggio
// changes the pattern immediately and correctly, and there is no cursor to get
// out of step with reality when a note is released mid-cycle. That is the bug
// every hand-rolled arpeggiator has, and it is caused entirely by keeping a
// pointer instead of a function.

// The order the held notes are visited in. `i` counts steps and never wraps —
// the modulo lives in here, so the caller has nothing to keep in sync.
//
//   UP      lowest to highest
//   DOWN    highest to lowest
//   INCL    up then down, REPEATING the ends — the classic "inclusive" shape
//   EXCL    up then down, NOT repeating the ends, so it turns cleanly
//   RAND    a different note each step
//   ORDER   the order you actually pressed them, which is the only mode that
//           can play a shape you fingered rather than a shape sorted for you
//   REPEAT  the whole chord on every step
//
// `notes` arrives as { note, vel, at } — `at` is when it was pressed, and is
// what ORDER sorts on.
export function arpStep(notes, mode, i, rnd) {
  const n = notes.length;
  if (!n) return [];
  if (mode === 'REPEAT') return notes.slice();
  if (mode === 'ORDER') {
    const byPress = notes.slice().sort((a, b) => a.at - b.at);
    return [byPress[((i % n) + n) % n]];
  }
  if (mode === 'RAND') {
    const r = typeof rnd === 'function' ? rnd() : Math.random();
    return [notes[Math.min(n - 1, Math.floor(r * n))]];
  }
  const up = notes.slice().sort((a, b) => a.note - b.note);
  if (mode === 'UP') return [up[((i % n) + n) % n]];
  if (mode === 'DOWN') return [up[n - 1 - (((i % n) + n) % n)]];

  // The two up-and-down modes, and the difference between them is the whole
  // reason both exist. With three notes C E G:
  //   INCL  C E G G E C | C E G G E C   — the top and bottom are played twice,
  //                                       so the turn has weight
  //   EXCL  C E G E | C E G E            — played once, so the turn is smooth
  // Getting this wrong gives an arpeggio that limps at one end.
  if (n === 1) return [up[0]];
  if (mode === 'INCL') {
    const period = n * 2;
    const k = ((i % period) + period) % period;
    return [up[k < n ? k : period - 1 - k]];
  }
  // EXCL
  const period = n * 2 - 2;
  const k = ((i % period) + period) % period;
  return [up[k < n ? k : period - k]];
}

// Does this step sound, and how hard? The rhythm is sixteen weights over one
// bar of sixteenths — but a step is not always a sixteenth, so the step index
// is mapped onto the bar by TIME rather than by counting. A 1/8 arpeggio under
// a sixteen-step rhythm must read every OTHER weight, not the first eight.
//
// `q` is the step length in sixteenths (see ARP_RATES). Returns 0 for a rest,
// or a velocity multiplier.
export function rhythmAt(rhythm, i, q) {
  if (!rhythm || !rhythm.length) return 1;
  // Where in the bar this step falls, in sixteenths.
  const pos = i * (q == null ? 1 : q);
  // Triplet rates do not land on sixteenths at all, so the weight is read from
  // the nearest one. The alternative — refusing to combine them — would mean
  // eleven of the twelve rhythms silently doing nothing at 1/8T, which is worse
  // than an approximation nobody can hear.
  const k = Math.round(pos) % rhythm.length;
  const w = rhythm[((k % rhythm.length) + rhythm.length) % rhythm.length];
  return w > 0 ? w / 9 : 0;
}

// When a step happens, in seconds from the start of the run.
// Swing delays every ODD step — that is the definition, and applying it to
// every step would just be playing slower.
export function stepTime(i, secsPerStep, swing) {
  const base = i * secsPerStep;
  const odd = (((i % 2) + 2) % 2) === 1;
  return base + (odd ? secsPerStep * Math.max(0, Math.min(0.6, swing || 0)) : 0);
}

// ---------------------------------------------------------------------------
// The running arpeggiator. Look-ahead scheduled against the audio clock for the
// same reason the sequencer is: a timer that is 10ms late must not be able to
// make a note 10ms late, and it cannot, because the note already has its exact
// time before the timer fires.
export function createArp({ now, onNote, onStep } = {}) {
  const AHEAD = 0.18, TICK = 25;
  let notes = [];          // [{ note, vel, at }]
  let latched = [];        // notes kept after release, when latch is on
  let running = false, timer = 0, step = 0, nextAt = 0, startedAt = 0;
  let cfg = { mode: 'UP', q: 1, bpm: 100, gate: 0.5, swing: 0, rhythm: null, octaves: 1 };
  let rnd = Math.random;

  const active = () => (latched.length ? latched : notes);
  const secsPerStep = () => (60 / Math.max(20, cfg.bpm)) * (cfg.q || 1) / 4;

  // Octave range. A one-octave arpeggio over a three-note chord is nine notes
  // of nothing new; spreading it is what makes an arpeggiator sound like more
  // than a chord played sideways.
  function spread(list) {
    const oct = Math.max(1, Math.min(4, cfg.octaves | 0 || 1));
    if (oct === 1) return list;
    const out = [];
    for (let o = 0; o < oct; o++) list.forEach((x) => out.push({ note: x.note + 12 * o, vel: x.vel, at: x.at + o * 0.001 }));
    return out;
  }

  function fill() {
    if (!running) return;
    const t = now();
    const sps = secsPerStep();
    let guard = 64;
    while (nextAt < t + AHEAD && guard-- > 0) {
      const when = startedAt + stepTime(step, sps, cfg.swing);
      // A step whose swung time has already gone past is dropped rather than
      // played late — a late note is worse than a missing one, and this only
      // happens after the machine has stalled.
      if (when >= t - 0.002) {
        const list = spread(active());
        const w = rhythmAt(cfg.rhythm, step, cfg.q);
        if (list.length && w > 0) {
          const picked = arpStep(list, cfg.mode, step, rnd);
          const len = Math.max(0.02, sps * Math.max(0.05, Math.min(1, cfg.gate)));
          picked.forEach((p) => onNote && onNote(p.note, Math.max(1, Math.round(p.vel * w)), when, len));
        }
        onStep && onStep(step, when, w > 0 && list.length > 0);
      }
      step++;
      nextAt = startedAt + stepTime(step, sps, cfg.swing);
    }
  }

  function begin() {
    if (running) return;
    running = true; step = 0;
    startedAt = now() + 0.03;
    nextAt = startedAt;
    fill();
    timer = setInterval(fill, TICK);
  }
  function end() {
    running = false;
    if (timer) { clearInterval(timer); timer = 0; }
  }

  return {
    get running() { return running; },
    get notes() { return active().map((x) => x.note); },
    set(c) { Object.assign(cfg, c || {}); },
    // For tests: a seeded generator makes RAND reproducible without making it
    // any less random in the app.
    seed(fn) { rnd = fn || Math.random; },
    hold(note, vel) {
      // Pressing a key while LATCHED and nothing physically held starts a new
      // chord rather than adding to the old one — otherwise a latched
      // arpeggiator only ever grows and there is no way to change chord.
      if (latched.length && !notes.length) latched = [];
      if (!notes.some((x) => x.note === note)) notes.push({ note, vel: vel || 100, at: now() });
      if (!running) begin();
    },
    release(note) {
      notes = notes.filter((x) => x.note !== note);
      if (cfg.latch) { if (notes.length === 0 && latched.length === 0) latched = []; }
      if (!cfg.latch && !notes.length) { end(); }
    },
    // Called when the last physical key goes up and latch is ON: whatever was
    // held becomes the latched chord.
    latchNow() { if (notes.length) latched = notes.slice(); },
    clear() { notes = []; latched = []; end(); },
    stop() { end(); },
  };
}
