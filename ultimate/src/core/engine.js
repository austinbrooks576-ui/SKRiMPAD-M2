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

export function createEngine() {
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
    if (voice.kind === 'drum') {
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
    src.start(t); src.stop(stop + 0.02);
    if (cellIndex != null) meters[cellIndex] = Math.max(meters[cellIndex], v);
    return { stop };
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
    play,
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
