// repeat.js — note repeat, the arpeggiator, and latch.
//
// These are three names for one machine. Note repeat retriggers ONE pad at a
// steady division for as long as you hold it. An arpeggiator retriggers SEVERAL
// held pads in turn at a steady division. Latch means "keep going after I let
// go". Written as three separate features they share nothing and drift apart —
// note repeat ends up with swing and the arpeggiator does not, latch works on
// one and not the other. Written as one, every property belongs to all of them
// because it is the same clock, the same gate and the same held set.
//
// EVERYTHING IS SCHEDULED AGAINST THE AUDIO CLOCK, never setInterval. A repeat
// driven by a timer drifts against the sequencer within a bar or two and there
// is no way to hear it as anything but bad timing. Each tick is handed a future
// audio time, the same way the step sequencer is, so a 1/32 triplet roll lands
// exactly where the maths says and stays there.

export const ARP_MODES = {
  off:    { l: 'Off' },
  up:     { l: 'Up' },
  down:   { l: 'Down' },
  updown: { l: 'Up-down' },
  played: { l: 'As played' },
  random: { l: 'Random' },
  chord:  { l: 'All at once' },
};
export const ARP_IDS = Object.keys(ARP_MODES);

export function createRepeat({ now, onHit, bpmFor } = {}) {
  // Held pads, in the order they went down. Order is what "as played" means,
  // and it is also what makes up-down deterministic rather than a shuffle.
  const held = [];
  const vel = new Map();          // pad -> the velocity it was struck at
  let latched = [];               // pads still sounding after release

  const st = {
    on: false,                    // note repeat / arp engaged
    q: 1,                         // division, in sixteenths
    swing: 0,                     // 0..0.6, applied to odd ticks
    gate: 0.5,                    // note length as a fraction of the division
    mode: 'off',                  // arp mode; 'off' means plain note repeat
    octaves: 1,
    latch: false,
    accentFirst: true,            // the downbeat of each cycle is hit harder
  };

  let timer = 0, nextAt = 0, tick = 0, dir = 1, idx = 0;

  const active = () => (latched.length ? latched : held);

  // The pad this tick should strike.
  //
  // Plain note repeat is deliberately NOT a special case with its own code
  // path: it is the arp with one pad in the set. That is why holding a second
  // pad during a repeat turns it into an arpeggio with no mode change and no
  // click — the set grew, and the machine was already reading the set.
  function pick() {
    const a = active();
    if (!a.length) return null;
    if (a.length === 1 || st.mode === 'off') return [a[a.length - 1]];
    if (st.mode === 'chord') return a.slice();
    if (st.mode === 'random') return [a[Math.floor(Math.random() * a.length)]];
    const sorted = st.mode === 'played' ? a.slice() : a.slice().sort((x, y) => x - y);
    if (st.mode === 'down') sorted.reverse();
    if (st.mode === 'updown') {
      // Turn at the ends WITHOUT repeating them. An up-down that plays the top
      // note twice has a limp in it that you hear immediately at any speed.
      if (idx >= sorted.length - 1) { idx = Math.max(0, sorted.length - 1); dir = -1; }
      else if (idx <= 0) { idx = 0; dir = 1; }
      const n = sorted[idx];
      idx += dir;
      return [n];
    }
    const n = sorted[idx % sorted.length];
    idx = (idx + 1) % sorted.length;
    return [n];
  }

  function schedule() {
    if (!st.on) return;
    const t = now();
    const spb = 60 / Math.max(20, Math.min(300, bpmFor())) / 4;   // one sixteenth
    const step = spb * st.q;
    if (!nextAt || nextAt < t - 0.5) { nextAt = t + 0.03; tick = 0; idx = 0; dir = 1; }
    // Look ahead far enough that a busy frame cannot make a roll stutter, but
    // not so far that letting go leaves a tail of notes already committed.
    while (nextAt < t + 0.14) {
      const pads = pick();
      if (pads) {
        // Swing on the odd ticks only. A repeat with swing applied to every
        // tick is just a slower repeat, which is the classic way to get this
        // wrong and the same rule the step sequencer uses.
        const sw = (tick % 2) ? st.swing * step * 0.6 : 0;
        for (const pad of pads) {
          const base = vel.get(pad) || 100;
          // The first tick of each cycle is the one a hand would lean on.
          const v = st.accentFirst && (tick % 4 === 0) ? Math.min(127, base * 1.12) : base * 0.86;
          const oct = st.octaves > 1 ? Math.floor(tick / Math.max(1, active().length)) % st.octaves : 0;
          onHit && onHit(pad, Math.round(v), nextAt + sw, step * st.gate, oct);
        }
      }
      nextAt += step;
      tick++;
    }
    timer = setTimeout(schedule, 20);
  }

  function start() {
    if (timer) return;
    nextAt = 0; tick = 0; idx = 0; dir = 1;
    schedule();
  }
  function stop() { clearTimeout(timer); timer = 0; nextAt = 0; }

  return {
    get state() { return Object.assign({}, st, { held: held.slice(), latched: latched.slice() }); },
    set(patch) {
      Object.assign(st, patch || {});
      if (st.on && (held.length || latched.length)) start();
      if (!st.on) { stop(); latched = []; }
      // Turning latch OFF has to drop what latch was holding, or the notes it
      // captured keep sounding with nothing on screen explaining why.
      if (patch && patch.latch === false) latched = [];
    },
    down(pad, velocity) {
      vel.set(pad, velocity || 100);
      if (held.indexOf(pad) < 0) held.push(pad);
      if (st.latch) {
        // Latch is a TOGGLE per pad, not an accumulator. Hitting a latched pad
        // again takes it out — otherwise the only way to remove one note from a
        // latched chord is to clear the lot, which in practice means people
        // stop using latch.
        const at = latched.indexOf(pad);
        if (at >= 0) latched.splice(at, 1); else latched.push(pad);
      }
      if (st.on) start();
      return st.on;
    },
    up(pad) {
      const i = held.indexOf(pad);
      if (i >= 0) held.splice(i, 1);
      if (!held.length && !latched.length) stop();
      return st.on;
    },
    clear() { held.length = 0; latched = []; vel.clear(); stop(); },
    // What is sounding right now, for the display. Latched pads are reported
    // separately so the grid can show a held pad and a latched pad differently
    // — they behave differently and a player has to be able to tell.
    lit() { return { held: held.slice(), latched: latched.slice() }; },
  };
}
