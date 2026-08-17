// pitch.js — change the note without changing the length.
//
// THE PROBLEM, exactly as asked for: "an octave count that changes tone and
// octave without speeding it up or slowing it down."
//
// Every edition so far pitches a sample by playbackRate, which is honest, free,
// and wrong for this. playbackRate is a tape speed control: up an octave is
// twice as fast and HALF AS LONG. A one-bar loop pitched up an octave is half a
// bar, a vocal becomes a chipmunk, and a kick becomes a tick. For a keyboard —
// where the whole point is that the same sample plays across seven octaves and
// still lands on the beat — that is unusable.
//
// WHAT THIS DOES INSTEAD: granular resynthesis. The sample is cut into short
// overlapping grains. Each grain is PLAYED at the shifted rate, so its pitch
// moves; but the grains are LAID DOWN at the original rate, so the sample takes
// exactly as long as it always did. Pitch and time are decoupled because they
// are now two different clocks.
//
//   read position   advances at 1x  → duration is preserved
//   grain playback  runs at 2^(n/12) → pitch moves by n semitones
//
// THE WINDOW MATTERS. Grains butted together click at every seam, because each
// one starts and ends at an arbitrary point in the waveform. Each grain is
// therefore faded in and out, and consecutive grains overlap by half — a
// triangular window at 50% overlap sums to exactly 1, so the level is flat and
// the seams disappear. That is the whole trick, and getting the overlap wrong
// is what makes most naive pitch shifters sound like they are underwater.
//
// GRAIN SIZE IS A TRADE, not a tuning preference:
//   long grains  → better pitch accuracy, smeared transients (a kick loses its
//                  click and turns into a thud)
//   short grains → sharp transients, audible warble on sustained tones
// 90ms is the usual compromise and is what this uses, EXCEPT on material short
// enough to be a drum hit, where transient accuracy wins outright.
//
// THERE ARE TWO PLAYERS HERE, because a pad and a key are not the same problem:
//   playPitched()      fires a whole sample once and is finished thinking about
//                      it — a pad, a step, an audition.
//   createGrainStream() keeps producing grains for as long as a finger is down,
//                      wrapping round a loop region — a held key.
// A one-shot can commit every grain up front. A held note cannot, because
// nobody knows how long it will last, so it tops itself up the same way the
// sequencer does: scheduled ahead against the audio clock, never at "now".

const GRAIN = 0.090;                 // seconds of output per grain
const SHORT_GRAIN = 0.035;           // for one-shots, where the attack is the sound
const SHORT_ENOUGH = 0.45;           // a sample this short is a hit, not a phrase
// Past two octaves the grain count and the artefacts both stop being worth it,
// and no keyboard asks for more than this from one sample.
const MAX_SEMIS = 24;
// A hard cap on how many grains one note may spawn. A four-minute stem at a
// 45ms hop would be five thousand buffer sources — enough to stall the audio
// thread on its own, which is a worse outcome than a slightly shortened tail.
const MAX_GRAINS = 400;

// Is a shift worth doing the expensive way? Under a cent nobody can hear it,
// and the plain path has no artefacts at all.
export const needsShift = (semis) => Math.abs(semis || 0) > 0.01;

const clampSemis = (n) => Math.max(-MAX_SEMIS, Math.min(MAX_SEMIS, n || 0));
const grainFor = (dur) => (dur <= SHORT_ENOUGH ? SHORT_GRAIN : GRAIN);

// Play `buffer` at `when`, shifted by `semis`, WITHOUT changing its duration.
// Returns { stop, duration } so the caller can schedule an envelope over it the
// same way it would over a plain source.
//
// dest is where the audio goes; everything downstream — filter, drive, pan,
// reverb send — is the caller's business and unchanged.
export function playPitched(ctx, buffer, when, semis, dest, opts = {}) {
  const n = clampSemis(semis);
  const dur = buffer.duration;

  // NO SHIFT: one source, no windowing, no cost. Worth branching for — most
  // notes on most kits are unshifted, and a grain engine running at unity is
  // pure artefact for no benefit.
  if (!needsShift(n)) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    src.start(when);
    return { stop: when + dur, duration: dur, grains: 1, srcs: [src] };
  }

  const rate = Math.pow(2, n / 12);
  const g = opts.grain || grainFor(dur);
  const hop = g / 2;                             // 50% overlap
  const count = Math.min(MAX_GRAINS, Math.max(1, Math.ceil(dur / hop)));
  const srcs = [];

  for (let i = 0; i < count; i++) {
    // WHERE IN THE SOURCE this grain reads from. Advancing by `hop` — the
    // OUTPUT hop — is what preserves duration: output time and read position
    // move together at 1x no matter what the playback rate is.
    const readAt = i * hop;
    if (readAt >= dur) break;

    // THE LAST GRAIN IS TRIMMED. A grain is `g` of OUTPUT whatever the rate, so
    // the final one — which starts within one hop of the end — would run up to
    // 45ms past where the sample finishes. Measured, that made a one-second
    // sample 1.030s long at -12: right pitch, right speed, wrong length, which
    // is the exact thing this module exists to get right. The grain before it
    // already covers the sample to its end, so trimming this one costs nothing.
    const room = Math.max(0, dur - i * hop);
    // How much source this grain will consume. A grain shifted UP eats more
    // source than it produces, so near the end there may not be that much left
    // — take what is there rather than asking for a negative length, which
    // throws.
    const take = Math.min(Math.min(g, room) * rate, Math.max(0, dur - readAt));
    if (take <= 0.001) break;
    // ...and the output length that actually corresponds to what we took.
    const out = take / rate;

    const t0 = when + i * hop;
    const win = ctx.createGain();
    // The triangular window. Two ramps, meeting in the middle, and the value at
    // the seam is what makes consecutive grains sum to unity.
    //
    // THE FIRST GRAIN IS THE EXCEPTION. Every grain fades in from silence, but
    // there is no earlier grain overlapping the first one to make up the
    // difference — so the sample's own attack gets a 45ms fade laid over it,
    // and the one part of a drum nobody will forgive losing is exactly the
    // part that goes missing. The first grain therefore starts at full level
    // and only fades out.
    if (i === 0) win.gain.setValueAtTime(1, t0);
    else {
      win.gain.setValueAtTime(0.0001, t0);
      win.gain.linearRampToValueAtTime(1, t0 + out / 2);
    }
    win.gain.linearRampToValueAtTime(0.0001, t0 + out);
    win.connect(dest);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(win);
    // start(when, offset, duration) — duration is in SOURCE seconds, which is
    // why it is `take` and not `out`. Getting that pair the wrong way round is
    // the classic way to build a shifter that only works when shifting down.
    src.start(t0, readAt, take);
    src.stop(t0 + out + 0.01);
    srcs.push(src);
  }

  return { stop: when + dur, duration: dur, grains: srcs.length, srcs };
}

// ---- a held key ------------------------------------------------------------
// The same engine, but open-ended. A key has no length until it is let go, so
// grains cannot all be committed up front; they are topped up ahead of the
// audio clock exactly the way the sequencer tops up notes, and for the same
// reason — a late timer must never be able to leave a hole, because the note
// already has its exact start time.
//
// It also LOOPS, by wrapping the read head inside a loop region instead of
// running off the end. Note what that fixes: looping a plain buffer source up
// an octave makes the loop go round twice as fast, so a one-bar sample held as
// a chord drifts out of time with everything else. Here the read head still
// advances at 1x, so the loop takes the same wall-clock time at every pitch.
export function createGrainStream(ctx, buffer, dest, opts = {}) {
  const dur = buffer.duration;
  const loop = !!opts.loop;
  const loopStart = Math.max(0, Math.min(dur, opts.loopStart || 0));
  const loopEnd = Math.max(loopStart + 0.01, Math.min(dur, opts.loopEnd == null ? dur : opts.loopEnd));
  const g = opts.grain || grainFor(dur);
  const hop = g / 2;
  // How far ahead grains are committed, and how often the queue is topped up.
  // AHEAD must comfortably exceed TICK or a busy main thread leaves a gap in a
  // held note — the same arithmetic as the sequencer, one order of magnitude
  // smaller because a grain is cheap to make.
  const AHEAD = 0.25, TICK = 60;
  // An OfflineAudioContext renders as fast as it can and no timer will ever
  // fire during it, so there is nothing to top the queue up. Offline gets its
  // whole horizon committed in one go instead.
  const offline = typeof ctx.startRendering === 'function';
  const horizon = opts.horizon || 8;

  let semis = clampSemis(opts.semis);
  let detune = 0;                         // cents, live (bend)
  const mods = [];                        // nodes to sum into every grain's detune
  let read = Math.max(0, Math.min(dur, opts.offset || 0));
  let nextAt = 0;
  let timer = 0, started = false, done = false, endAt = Infinity;
  const live = [];                        // { src, win, until }

  function reap(now) {
    for (let i = live.length - 1; i >= 0; i--) if (live[i].until < now - 0.05) live.splice(i, 1);
  }

  function one() {
    const rate = Math.pow(2, semis / 12);
    const limit = loop ? loopEnd : dur;
    // Same trim as the one-shot: a stream running out must not overrun the end
    // of its own sample. A looping stream never reaches this, because it wraps
    // rather than ending.
    const room = loop ? g : Math.max(0, dur - read);
    const take = Math.min(Math.min(g, room) * rate, Math.max(0, limit - read));
    if (take <= 0.001) { done = true; return false; }
    const out = take / rate;
    const t0 = nextAt;
    if (t0 >= endAt) { done = true; return false; }

    const win = ctx.createGain();
    // Unlike the one-shot, EVERY grain here fades in — including the first.
    // The engine's own attack envelope is doing the job the one-shot exception
    // exists for, and a stream that starts at full level pops when the read
    // head is mid-waveform.
    win.gain.setValueAtTime(0.0001, t0);
    win.gain.linearRampToValueAtTime(1, t0 + out / 2);
    win.gain.linearRampToValueAtTime(0.0001, t0 + out);
    win.connect(dest);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    if (src.detune) {
      src.detune.value = detune;
      mods.forEach((m) => { try { m.connect(src.detune); } catch (e) {} });
    }
    src.connect(win);
    src.start(t0, read, take);
    src.stop(t0 + out + 0.01);
    live.push({ src, win, until: t0 + out });

    // The read head advances by the OUTPUT hop, never the rate — that single
    // line is the whole reason the loop keeps time at any pitch.
    read += hop;
    if (loop && read >= loopEnd - 0.001) read = loopStart + (read - loopEnd);
    nextAt += hop;
    return true;
  }

  function fill() {
    if (done) return;
    const limit = (offline ? horizon : ctx.currentTime + AHEAD);
    let guard = MAX_GRAINS;
    while (!done && nextAt < limit && guard-- > 0) if (!one()) break;
    if (done) clear();
  }

  function clear() { if (timer) { clearInterval(timer); timer = 0; } }

  return {
    get running() { return started && !done; },
    start(when) {
      if (started) return; started = true;
      nextAt = when;
      fill();
      if (!offline && !done) timer = setInterval(fill, TICK);
    },
    // Live pitch change. Grains already scheduled keep the old rate — they are
    // 90ms long, so the stream has fully followed within one grain, which is
    // faster than a hand can move a wheel.
    setSemis(n) { semis = clampSemis(n); },
    // Bend, in cents. Applied to the grains already in flight AND remembered
    // for the ones not yet made, or the pitch would snap back every 45ms.
    setDetune(cents) {
      detune = cents;
      const now = ctx.currentTime;
      reap(now);
      live.forEach((l) => { try { l.src.detune && l.src.detune.setTargetAtTime(cents, now, 0.006); } catch (e) {} });
    },
    // Register an LFO (or any node) to be summed into every grain's detune —
    // this is how vibrato reaches a granular voice, since the "source" it would
    // normally attach to is replaced twenty times a second.
    mod(node) {
      if (!node) return;
      mods.push(node);
      live.forEach((l) => { try { l.src.detune && node.connect(l.src.detune); } catch (e) {} });
    },
    stop(when) {
      endAt = when; clear(); done = true;
      live.forEach((l) => { try { l.src.stop(Math.min(l.until + 0.01, when + 0.02)); } catch (e) {} });
    },
  };
}

// The same decision the engine has to make about a MIDI note: how far is this
// from the sample's own pitch? Kept here so the rule lives with the shifter
// rather than being re-derived at every call site.
export function semitonesFor(note, rootNote) {
  return (note | 0) - (rootNote == null ? 60 : rootNote | 0);
}
