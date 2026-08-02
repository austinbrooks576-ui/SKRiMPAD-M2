// engine.js — sound, and the clock that drives it.
//
// Two decisions shape everything here.
//
// 1. THE CLOCK IS NOT setInterval. Timer callbacks in a browser drift, and they
//    stop entirely when a phone locks. So the sequencer SCHEDULES AHEAD against
//    AudioContext.currentTime — the only clock in the browser that is actually
//    sample-accurate — and a lazy 25ms timer merely tops the queue up. The
//    timer being late by 10ms cannot make a note late, because the note already
//    has its exact start time.
//
// 2. EVERY VOICE IS DISPOSABLE. Nodes are created per hit and left to die. That
//    sounds wasteful and is in fact the cheapest correct option: Web Audio
//    reclaims a stopped node automatically, whereas a pool has to track state
//    and gets it wrong under a 128-note flood. No pool means no stuck voice.

export function createEngine({ sampleFor } = {}) {
  let ctx = null, master = null, comp = null, spaceIn = null, analyser = null;
  const meters = new Float32Array(64);
  let ready = false;

  function init() {
    if (ready) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain(); master.gain.value = 0.85;

    // A limiter on the master is the difference between "16 pads at once" and
    // "16 pads at once and the phone speaker gives up". Slow release so it
    // sounds like glue rather than pumping.
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 6;
    comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.18;

    // One shared reverb-ish send. A convolver would be nicer and costs an
    // impulse file; a feedback delay network gets 90% of the feel for free and
    // ships offline, which matters in an APK with no network.
    spaceIn = ctx.createGain(); spaceIn.gain.value = 0;
    const dl = ctx.createDelay(1.0); dl.delayTime.value = 0.13;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
    spaceIn.connect(dl); dl.connect(tone); tone.connect(fb); fb.connect(dl); tone.connect(master);

    analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.7;
    master.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination);
    ready = true;
    return ctx;
  }
  const resume = () => { init(); if (ctx.state !== 'running') ctx.resume().catch(() => {}); };

  const clamp = (v, lo, hi) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };
  const hz = (n) => 440 * Math.pow(2, (clamp(n, 0, 127) - 69) / 12);

  // A shared noise buffer. Regenerating noise per hit is pure waste, and at
  // 2 seconds it is long enough that no ear hears the loop.
  let noiseBuf = null;
  function noise() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  // ---- one hit ------------------------------------------------------------
  // `when` is an absolute AudioContext time. Passing 0 means "now" — the live
  // path — and the sequencer always passes a real future time.
  function play(voice, when, vel, cellIndex) {
    init();
    const t = when || ctx.currentTime;
    const v = clamp(vel == null ? 100 : vel, 1, 127) / 127;
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    // Musical taper: linear cutoff spends its whole travel where the ear hears
    // nothing. 60Hz..14kHz over an exponential curve is what a knob should do.
    flt.frequency.setValueAtTime(60 * Math.pow(233, clamp(voice.cutoff, 0, 1)), t);
    flt.Q.value = 0.6 + clamp(voice.res, 0, 1) * 14;

    let src;
    // A sample, if one is assigned AND already decoded. Never await here: this
    // function is called from the scheduler with an exact future start time, and
    // an await would hand that time back to the event loop and land the note
    // late. The library warms the buffer when the sample is assigned instead.
    if (voice.sampleId && sampleFor) {
      const buf = sampleFor(voice.sampleId);
      if (buf) {
        src = ctx.createBufferSource();
        src.buffer = buf;
        // Tune a sample by playback rate — the honest, zero-cost way. tune is in
        // semitones so it reads the same as it does on a synth voice.
        src.playbackRate.value = Math.pow(2, clamp(voice.tune, -24, 24) / 12);
      }
    }
    if (src) { /* sample wins */ }
    else if (voice.kind === 'drum') {
      // Drums are two ingredients: a pitched body that falls, and noise. Which
      // one dominates is the whole difference between a kick and a hat, so it
      // is derived from the voice's own note rather than a separate switch.
      const low = voice.note < 45;
      if (low) {
        src = ctx.createOscillator(); src.type = 'sine';
        src.frequency.setValueAtTime(hz(voice.note) * 2.6, t);
        src.frequency.exponentialRampToValueAtTime(Math.max(28, hz(voice.note) * 0.6), t + 0.09);
      } else {
        src = ctx.createBufferSource(); src.buffer = noise();
        flt.type = voice.note > 60 ? 'highpass' : 'bandpass';
        flt.frequency.setValueAtTime(voice.note > 60 ? 5200 : 1400, t);
      }
    } else {
      src = ctx.createOscillator();
      src.type = voice.wave || 'sawtooth';
      src.frequency.setValueAtTime(hz(voice.note + (voice.tune || 0)), t);
    }

    const a = clamp(voice.attack, 0.001, 2), d = clamp(voice.decay, 0.01, 3);
    const s = clamp(voice.sustain, 0, 1), r = clamp(voice.release, 0.01, 4);
    const peak = v * clamp(voice.gain, 0, 1.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * (voice.kind === 'drum' ? 0.02 : s)), t + a + d);
    const stop = t + a + d + r;
    g.gain.exponentialRampToValueAtTime(0.0001, stop);

    let chain = src;
    chain.connect(flt); chain = flt;
    if (voice.drive > 0.02) {
      const ws = ctx.createWaveShaper();
      const k = clamp(voice.drive, 0, 1) * 60, curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
      ws.curve = curve; ws.oversample = '2x';
      chain.connect(ws); chain = ws;
    }
    chain.connect(g);
    if (pan) { pan.pan.value = clamp(voice.pan, -1, 1); g.connect(pan); pan.connect(master); }
    else g.connect(master);
    if (voice.space > 0.02) {
      const sd = ctx.createGain(); sd.gain.value = clamp(voice.space, 0, 1) * 0.5;
      g.connect(sd); sd.connect(spaceIn);
    }
    src.start(t);
    // A one-shot sample should be allowed to finish. Stopping it at the envelope
    // release would chop the tail off every crash and every vocal.
    const natural = src.buffer ? src.buffer.duration / (src.playbackRate ? src.playbackRate.value : 1) : 0;
    src.stop(Math.max(stop, t + natural) + 0.02);
    if (cellIndex != null) meters[cellIndex] = Math.max(meters[cellIndex], v);
    return { stop };
  }

  // ---- a note that is still being played -----------------------------------
  // play() above is fire-and-forget: it commits an entire envelope at trigger
  // time and never looks at the note again. That is exactly right for a pad and
  // exactly wrong for a key, where the whole point is that the sound keeps
  // answering to your hands after it starts.
  //
  // hold() therefore returns a LIVE HANDLE. Nothing in here decides how a note
  // should move — it only exposes the places a note can be moved FROM, and the
  // hardware drives every one of them.
  //
  // The gain stage is deliberately split in two:
  //   env   scheduled ramps, owned by the envelope
  //   exp   a live multiplier, owned by the hands (expression, breath, pressure)
  // One node cannot serve both. Writing a live value onto a param that already
  // has scheduled ramps on it fights the automation and clicks — the most
  // common way live modulation gets built wrong.
  let lfo = null, lfoOut = null;
  function vibrato() {
    // ONE shared LFO for every voice, not one per voice. Cheaper, but the real
    // reason is musical: vibrato across a held chord should move as a single
    // gesture, because it came from a single wheel. Giving each note its own
    // free-running LFO sounds like a chorus, not a hand.
    if (lfoOut) return lfoOut;
    lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.2;
    lfoOut = ctx.createGain(); lfoOut.gain.value = 1;
    lfo.connect(lfoOut); lfo.start();
    return lfoOut;
  }

  function hold(voice, note, vel, when) {
    init();
    const t = when || ctx.currentTime;
    const v = clamp(vel == null ? 100 : vel, 1, 127) / 127;

    const env = ctx.createGain(), exp = ctx.createGain();
    const flt = ctx.createBiquadFilter(); flt.type = 'lowpass';
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

    // Velocity opens the filter as well as the amplitude. Mapping velocity to
    // loudness alone is why so many soft synths feel like a volume pedal: on a
    // real instrument, playing harder makes a sound BRIGHTER, and the ear reads
    // brightness as effort far more readily than it reads level.
    const base = Math.min(18000, 60 * Math.pow(233, clamp(voice.cutoff, 0, 1)) * (0.55 + v * 0.75));
    flt.frequency.setValueAtTime(base, t);
    flt.Q.value = 0.6 + clamp(voice.res, 0, 1) * 14;

    let src, isSample = false;
    if (voice.sampleId && sampleFor) {
      const buf = sampleFor(voice.sampleId);
      if (buf) {
        src = ctx.createBufferSource(); src.buffer = buf; isSample = true;
        // A held key wants the sample to keep sounding, so anything long enough
        // to be a tone gets looped. Short samples are one-shots, and looping one
        // turns a hit into a machine gun.
        if (buf.duration > 0.55) {
          src.loop = true; src.loopStart = buf.duration * 0.2; src.loopEnd = buf.duration;
        }
        // Treat the sample's recorded pitch as middle C, so a key plays the
        // interval you expect rather than an arbitrary transposition.
        src.playbackRate.value = Math.pow(2, (clamp(note, 0, 127) - 60 + clamp(voice.tune, -24, 24)) / 12);
      }
    }
    if (!src) {
      src = ctx.createOscillator();
      src.type = voice.wave || 'sawtooth';
      src.frequency.setValueAtTime(hz(note), t);
      if (voice.tune) src.detune.setValueAtTime(clamp(voice.tune, -24, 24) * 100, t);
    }

    // Both AudioBufferSourceNode and OscillatorNode expose .detune in cents, so
    // bend and vibrato reach a sample and a synth down the same wire.
    const bendable = src.detune || null;
    let vibDepth = null;
    if (bendable) {
      vibDepth = ctx.createGain(); vibDepth.gain.value = 0;
      vibrato().connect(vibDepth); vibDepth.connect(bendable);
    }

    const a = clamp(voice.attack, 0.001, 2), d = clamp(voice.decay, 0.01, 3);
    const s = clamp(voice.sustain, 0, 1), peak = v * clamp(voice.gain, 0, 1.4);
    // A key holds at its sustain level indefinitely — the note ends when the
    // finger says so, not when a timer says so.
    const held = Math.max(0.0002, peak * Math.max(0.08, s));
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    env.gain.exponentialRampToValueAtTime(held, t + a + d);
    exp.gain.setValueAtTime(1, t);

    let chain = src;
    chain.connect(flt); chain = flt;
    if (voice.drive > 0.02) {
      const ws = ctx.createWaveShaper();
      const k = clamp(voice.drive, 0, 1) * 60, curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
      ws.curve = curve; ws.oversample = '2x';
      chain.connect(ws); chain = ws;
    }
    chain.connect(env); env.connect(exp);
    if (pan) { pan.pan.value = clamp(voice.pan, -1, 1); exp.connect(pan); pan.connect(master); }
    else exp.connect(master);
    if (voice.space > 0.02) {
      const sd = ctx.createGain(); sd.gain.value = clamp(voice.space, 0, 1) * 0.5;
      exp.connect(sd); sd.connect(spaceIn);
    }
    src.start(t);

    let dead = false, pressure = 0, timbre = 0, lev = 1;
    // Brightness has two independent sources — pressure and a timbre controller
    // — and neither may clobber the other, so the filter is recomputed from both
    // whenever either one moves.
    function reflt() {
      if (dead) return;
      const open = Math.min(1, pressure * 0.75 + timbre);
      try { flt.frequency.setTargetAtTime(Math.min(18000, base * (1 + open * 5.5)), ctx.currentTime, 0.02); } catch (e) {}
    }
    function relev() {
      if (dead) return;
      try { exp.gain.setTargetAtTime(Math.max(0.0001, lev * (1 + pressure * 0.35)), ctx.currentTime, 0.025); } catch (e) {}
    }
    function fade(secs) {
      if (dead) return; dead = true;
      const now = ctx.currentTime;
      try {
        // cancelScheduledValues first, or an attack still in flight ramps
        // straight through the release and the note never actually stops.
        env.gain.cancelScheduledValues(now);
        env.gain.setValueAtTime(Math.max(0.0002, env.gain.value), now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + secs);
      } catch (e) { /* param already past its schedule; the stop below frees it */ }
      try { src.stop(now + secs + 0.03); } catch (e) {}
    }
    return {
      note, isSample,
      get dead() { return dead; },
      // Bend arrives in SEMITONES, because that is the unit a player thinks in.
      // Cents are an implementation detail of the audio graph.
      bend(semis) { if (bendable && !dead) try { bendable.setTargetAtTime(clamp(semis, -48, 48) * 100, ctx.currentTime, 0.006); } catch (e) {} },
      vib(cents) { if (vibDepth && !dead) try { vibDepth.gain.setTargetAtTime(clamp(cents, 0, 200), ctx.currentTime, 0.05); } catch (e) {} },
      press(p) { pressure = clamp(p, 0, 1); reflt(); relev(); },
      timbre(b) { timbre = clamp(b, 0, 1); reflt(); },
      level(l) { lev = clamp(l, 0, 2); relev(); },
      off() { fade(clamp(voice.release, 0.01, 4)); },
      // A stolen voice still gets a release, just a very short one. 12ms is
      // under the ear's time resolution and above the point where a hard stop
      // becomes an audible tick.
      steal() { fade(0.012); },
    };
  }

  // ---- transport ----------------------------------------------------------
  // Look-ahead scheduling. AHEAD is how far into the future we commit notes;
  // TICK is how often we top up. AHEAD must comfortably exceed TICK or a late
  // timer leaves a hole in the music.
  const AHEAD = 0.12, TICK = 25;
  let playing = false, step = 0, nextTime = 0, timer = 0, onStep = null;

  function schedule(song) {
    const spb = 60 / clamp(song.bpm, 20, 300) / 4;      // sixteenths
    while (nextTime < ctx.currentTime + AHEAD) {
      const cells = song.scenes[song.scene].cells;
      const anySolo = cells.some((c) => c.solo);
      // Swing delays the off-beats only. Applying it to every step just slows
      // the tempo, which is the classic way to get this wrong.
      const swung = (step % 2) ? clamp(song.swing, 0, 0.6) * spb * 0.6 : 0;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c.mute || (anySolo && !c.solo)) continue;
        const vel = c.steps[step % c.steps.length];
        if (vel > 0) play(c.voice, nextTime + swung, vel, i);
      }
      const at = nextTime, s = step;
      // Hand the UI the exact audio time this step lands, so the playhead can be
      // drawn where the sound WILL be rather than where the timer happened to fire.
      if (onStep) onStep(s, at);
      nextTime += spb; step = (step + 1) % 16;
    }
    if (playing) timer = setTimeout(() => schedule(song), TICK);
  }

  return {
    init, resume,
    get ctx() { return ctx; },
    get analyser() { return analyser; },
    get meters() { return meters; },
    get playing() { return playing; },
    play, hold,
    decayMeters() { for (let i = 0; i < meters.length; i++) meters[i] *= 0.86; },
    setMaster(v) { init(); master.gain.value = clamp(v, 0, 1.2); },
    start(song, cb) {
      resume(); if (playing) return;
      playing = true; step = 0; onStep = cb || null;
      nextTime = ctx.currentTime + 0.06;
      schedule(song);
    },
    stop() { playing = false; clearTimeout(timer); step = 0; },
    get step() { return step; },
  };
}
