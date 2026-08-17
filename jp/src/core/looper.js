// looper.js — record what you played, and play it back with you.
//
// This records EVENTS, not audio. A pad hit is stored as {pad, at, vel} against
// the loop's own clock, and playback re-fires it through the same voice the pad
// has now. That is the difference between a looper and a tape machine, and it
// is the right one for a pad instrument: swap the sample under a loop and the
// part you played is now that sample, the tempo can change afterwards, and a
// four-bar loop costs a few hundred bytes rather than a few megabytes.
//
// TIMING. Everything is in BEATS, never seconds. Store seconds and the whole
// loop shears the moment the tempo moves. Beats stay put.
//
// THE LENGTH IS DECIDED BY THE FIRST PASS. Press record, play, press again —
// the loop is however long that was, rounded to whole bars, because a loop that
// is 3.8 bars long can never line up with anything and nobody has ever wanted
// one. Rounding UP means a late final hit is kept; rounding down would eat it.

const PPB = 960;                                  // ticks per beat, integer maths

export function createLooper({ now, bpmFor, onFire, onState } = {}) {
  let state = 'empty';        // empty · armed · recording · playing · overdub · paused
  let events = [];            // { pad, beat, vel, len }
  let undoStack = [];
  let lenBeats = 0;
  let startedAt = 0;          // audio time the current pass began
  let posBeat = 0;
  let timer = 0;
  let played = new Set();     // which events have fired this pass
  let bars = 0;

  const spb = () => 60 / Math.max(20, Math.min(300, bpmFor()));
  const say = () => onState && onState(info());

  function info() {
    return { state, bars, lenBeats, events: events.length,
             pos: lenBeats ? (posBeat % lenBeats) / lenBeats : 0,
             canUndo: undoStack.length > 0 };
  }

  function tick() {
    const t = now();
    const beat = (t - startedAt) / spb();

    if (state === 'recording') {
      posBeat = beat;
      timer = setTimeout(tick, 25);
      return;
    }
    if (state !== 'playing' && state !== 'overdub') return;

    const prev = posBeat;
    posBeat = beat % lenBeats;
    // A wrap has happened if the position went backwards. Clearing the fired
    // set on the wrap rather than on a timer is what keeps a loop from either
    // double-firing at the seam or dropping the first hit of the pass.
    if (posBeat < prev) played.clear();

    // Fire everything due in the next look-ahead window, with its exact future
    // audio time — same discipline as the sequencer, for the same reason.
    const ahead = 0.12 / spb();
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const key = i;
      if (played.has(key)) continue;
      let d = e.beat - posBeat;
      if (d < -0.001) d += lenBeats;              // wraps into this window
      if (d > ahead) continue;
      played.add(key);
      onFire && onFire(e.pad, e.vel, t + d * spb(), e.len * spb());
    }
    timer = setTimeout(tick, 20);
    say();
  }

  return {
    get info() { return info(); },
    // ARM, then the first pad hit starts the clock. Recording from the instant
    // the button is pressed puts the gap between "I pressed record" and "I
    // started playing" at the front of the loop, which is a bar of silence
    // nobody asked for and everybody has to edit out.
    arm() {
      if (state === 'recording') return this.stopRecord();
      undoStack.push(events.slice());
      if (state === 'playing' || state === 'overdub') { state = 'overdub'; say(); return info(); }
      state = 'armed'; events = []; lenBeats = 0; say();
      return info();
    },
    // Called by the app on every pad hit. Returns true if it was captured.
    capture(pad, vel, len) {
      if (state === 'armed') {
        state = 'recording'; startedAt = now(); posBeat = 0;
        events.push({ pad, beat: 0, vel, len: len || 0.25 });
        clearTimeout(timer); tick(); say();
        return true;
      }
      if (state === 'recording') {
        events.push({ pad, beat: (now() - startedAt) / spb(), vel, len: len || 0.25 });
        return true;
      }
      if (state === 'overdub') {
        // Quantised to the loop, not to the grid: an overdub records against
        // where the loop actually is, so a hit landing a hair before the wrap
        // belongs at the END of the loop and not at the start of the next one.
        let b = (now() - startedAt) / spb() % lenBeats;
        if (b < 0) b += lenBeats;
        events.push({ pad, beat: b, vel, len: len || 0.25 });
        return true;
      }
      return false;
    },
    stopRecord() {
      if (state !== 'recording' && state !== 'armed') return info();
      if (state === 'armed') { state = 'empty'; say(); return info(); }
      const b = (now() - startedAt) / spb();
      // Whole bars, rounded up, minimum one. A loop that is 3.8 bars long can
      // never line up with anything; rounding down would clip a late last hit.
      bars = Math.max(1, Math.ceil(b / 4 - 0.15));
      lenBeats = bars * 4;
      state = 'playing'; startedAt = now(); posBeat = 0; played.clear();
      clearTimeout(timer); tick(); say();
      return info();
    },
    play() {
      if (!events.length) return info();
      if (state === 'playing' || state === 'overdub') return info();
      // Resuming from PAUSE keeps the position; starting from stopped does not.
      state = 'playing';
      startedAt = now() - posBeat * spb();
      played.clear();
      clearTimeout(timer); tick(); say();
      return info();
    },
    pause() {
      if (state !== 'playing' && state !== 'overdub' && state !== 'recording') return info();
      if (state === 'recording') this.stopRecord();
      state = 'paused'; clearTimeout(timer); timer = 0; say();
      return info();
    },
    stop() {
      if (state === 'recording') { this.stopRecord(); }
      state = events.length ? 'paused' : 'empty';
      posBeat = 0; played.clear();
      clearTimeout(timer); timer = 0; say();
      return info();
    },
    undo() {
      if (!undoStack.length) return info();
      events = undoStack.pop();
      if (!events.length && state !== 'empty') { state = 'empty'; lenBeats = 0; bars = 0; clearTimeout(timer); }
      played.clear(); say();
      return info();
    },
    clear() {
      undoStack.push(events.slice());
      events = []; lenBeats = 0; bars = 0; posBeat = 0; state = 'empty';
      clearTimeout(timer); timer = 0; played.clear(); say();
      return info();
    },
    // Everything recorded for one pad, dropped. Removing one part of a loop
    // without losing the rest is the single most asked-for looper feature and
    // the one most loopers do not have.
    clearPad(pad) {
      undoStack.push(events.slice());
      events = events.filter((e) => e.pad !== pad);
      played.clear(); say();
      return info();
    },
    padsUsed() { return [...new Set(events.map((e) => e.pad))]; },
  };
}
