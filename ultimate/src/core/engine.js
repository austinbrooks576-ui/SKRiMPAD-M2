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

// `context` lets a caller supply the AudioContext instead of having one made.
// The app never uses it; an OfflineAudioContext does, which is how a voice can
// be rendered and measured without playing it, and how a song will be bounced
// to a file later. Everything below is written against ctx, so neither path
// needs a special case.
// How far ahead of "now" a live hit is scheduled. Three render quanta at
// 44.1kHz. See play() for why zero is the wrong answer.
const NUDGE = 128 * 3 / 44100;

export function createEngine({ sampleFor, context, onFail } = {}) {
  let ctx = null, master = null, comp = null, spaceIn = null, analyser = null;
  const meters = new Float32Array(64);
  let ready = false;

  // Audio can simply fail to start: no output device, a locked-down embedded
  // WebView, an ancient browser with no AudioContext at all. Every one of those
  // used to throw straight out of init() and take the app with it — and the
  // app is still worth having without sound, because programming a pattern,
  // arranging a song and importing a library all work fine. Silence is a
  // degraded mode, not a crash.
  let dead = false;

  function init() {
    if (ready || dead) return ctx;
    try {
      if (context) ctx = typeof context === 'function' ? context() : context;
      else {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error('no AudioContext');
        ctx = new AC({ latencyHint: 'interactive' });
      }
    } catch (e) {
      dead = true; ctx = null;
      onFail && onFail(e);
      return null;
    }
    // 0.55, not 0.85. With a full arrangement running, 0.85 pushed the sum so
    // far past the compressor's threshold that the compressor stopped being a
    // safety net and became the sound: a rendered eight-bar loop came out at
    // -3.6 dBFS RMS — squashed flat, no dynamics left, and exhausting after
    // about twenty seconds. Headroom is not wasted volume; it is the room the
    // kick needs to hit.
    master = ctx.createGain(); master.gain.value = 0.55;

    // A limiter on the master is the difference between "16 pads at once" and
    // "16 pads at once and the phone speaker gives up". It should CATCH PEAKS,
    // not ride the whole mix — hence a gentler ratio and a threshold the music
    // spends most of its time below. Slow release so what it does catch sounds
    // like glue rather than pumping.
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.knee.value = 8;
    comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.20;

    // One shared reverb-ish send. A convolver would be nicer and costs an
    // impulse file; a feedback delay network gets 90% of the feel for free and
    // ships offline, which matters in an APK with no network.
    // 1, not 0. This is a SEND BUS: every voice already scales its own send by
    // its space amount before it gets here, so a gain of 0 on the bus did not
    // mean "no reverb by default", it meant NO REVERB AT ALL, ever, for any
    // voice, at any setting. The whole space parameter has been wired to
    // nothing — which is why the ambient voices sounded dry and small.
    spaceIn = ctx.createGain(); spaceIn.gain.value = 1;
    const dl = ctx.createDelay(1.0); dl.delayTime.value = 0.13;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
    spaceIn.connect(dl); dl.connect(tone); tone.connect(fb); fb.connect(dl); tone.connect(master);

    // A CEILING, after the compressor. A DynamicsCompressor is not a brickwall
    // limiter — with ratio 4 a hot enough input still comes out above 0 dBFS,
    // and a rendered arrangement with a dozen overlapping pad voices peaked at
    // 1.054, which is digital clipping: the harshest sound a computer can make.
    // A tanh curve cannot exceed 1 no matter what is fed into it, so this
    // guarantees the ceiling instead of hoping for it, and it rounds peaks over
    // rather than squaring them off the way hard clipping does.
    // tanh(x*k)/k, not tanh(x*k)/tanh(k). The normalised form maps 1 to 1 and
    // therefore BOOSTS everything below it — the first attempt at this raised
    // the rendered mix from -3.9 to -1.6 dBFS RMS, the exact opposite of the
    // job. Dividing by k instead gives unity slope at zero, so quiet material
    // passes through untouched, and a hard ceiling of 1/k that no input can
    // exceed however loud it gets. k = 1.25 puts that ceiling at -1.9 dBFS.
    // Built through makeCurve for the same reason as the drive curves: an even
    // length has no sample at zero, and a master stage that turns silence into
    // DC is the last place you want that.
    const ceiling = ctx.createWaveShaper();
    const K = 1.25;
    ceiling.curve = makeCurve((x) => Math.tanh(x * K) / K);
    ceiling.oversample = '4x';

    analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.7;
    master.connect(comp); comp.connect(ceiling); ceiling.connect(analyser);
    analyser.connect(ctx.destination);
    ready = true;
    return ctx;
  }
  // An OfflineAudioContext has no resume() and is never 'suspended' in the way
  // this cares about, so guard rather than assume a live context.
  const resume = () => { init(); if (ctx && ctx.state !== 'running' && ctx.resume) ctx.resume().catch(() => {}); };

  const clamp = (v, lo, hi) => { const n = +v; return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };

  // ---- waveshaper curves, and the DC bug that hid in them ------------------
  // A WaveShaper maps input -1..1 across its curve and INTERPOLATES between
  // samples. With an even-length curve there is no sample at the centre, so an
  // input of exactly 0 lands halfway between curve[n/2 - 1] and curve[n/2] and
  // comes out NON-ZERO. For the drive curve that offset was about -0.018.
  //
  // That is silence producing signal, and it compounds: every voice that has
  // finished is still connected until the graph is collected, so each dead
  // waveshaper kept pushing its own DC into the master. After twenty seconds of
  // playing there were enough of them to drive the compressor into permanent
  // gain reduction — a rendered loop of one identical kick every half second
  // measured 4 dB quieter at the end than at the start, and a real session
  // would just feel like the app was slowly going flat.
  //
  // An ODD length puts a real sample exactly at the centre, so zero in is zero
  // out by construction rather than by luck.
  const CURVE_N = 1025, CURVE_MID = (CURVE_N - 1) / 2;
  function makeCurve(fn) {
    const c = new Float32Array(CURVE_N);
    for (let i = 0; i < CURVE_N; i++) c[i] = fn((i / CURVE_MID) - 1);
    c[CURVE_MID] = 0;                 // exact, not merely very close
    return c;
  }
  // Drive curves are shaped only by their amount, so they are worth caching —
  // this used to build a fresh 1024-point Float32Array on every single hit.
  const driveCache = new Map();
  function driveCurve(amount) {
    const q = Math.round(clamp(amount, 0, 1) * 40) / 40;      // quantise to 41 curves
    let c = driveCache.get(q);
    if (!c) {
      const k = q * 60;
      c = makeCurve((x) => ((1 + k) * x) / (1 + k * Math.abs(x)));
      driveCache.set(q, c);
    }
    return c;
  }
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

  // ---- the drum kit -------------------------------------------------------
  // A drum used to be "note below 45 gets a falling sine, everything else gets
  // noise". That is two sounds pretending to be eight, which is why the pads
  // never matched their own names — SNARE and HAT came out of the same branch
  // and differed only by filter.
  //
  // Each drum is now built the way the real thing is built, which for most of a
  // kit means MORE THAN ONE LAYER. A snare is a tuned shell plus a rattle of
  // wires; a clap is not one burst but several a few milliseconds apart, and
  // that stagger is the entire reason a clap sounds like hands rather than a
  // click. You cannot get either from one oscillator and a filter.
  //
  // Everything is scheduled against `t`, never against currentTime, so a hit
  // the sequencer placed 100ms in the future stays exactly where it was put.

  // Short helpers, because every recipe below is some arrangement of these two.
  function burst(t, dest, { freq, type = 'bandpass', q = 1, dur = 0.05, level = 1, at = 0.001 }) {
    const s = ctx.createBufferSource(); s.buffer = noise();
    // Start at a random offset so repeated hits are not bit-identical — the
    // giveaway of a machine, and free to avoid with one shared buffer.
    const off = Math.random() * 1.5;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, off); s.stop(t + at + dur + 0.02);
    return t + at + dur;
  }
  function body(t, dest, { from, to, type = 'sine', dur = 0.2, level = 1, bend = 0.06 }) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + bend);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
    return t + dur;
  }

  function playDrum(voice, t, dest) {
    const d = voice.drum || 'perc';
    const n = hz(clamp(voice.note, 0, 127));
    const dec = clamp(voice.decay, 0.01, 3);
    let end = t;
    switch (d) {
      case 'kick':
        // The trance kick: a steep pitch drop, and a click on top. Without the
        // click it disappears the moment anything else is playing, because the
        // body lives under 80Hz where a phone speaker reproduces almost nothing
        // — the attack is what you actually hear on small speakers.
        end = Math.max(end, body(t, dest, { from: n * 3.4, to: n * 0.55, dur: dec, level: 1, bend: 0.045 }));
        end = Math.max(end, burst(t, dest, { freq: 2600, type: 'highpass', dur: 0.012, level: 0.32 }));
        break;
      case 'snare':
        // Shell plus wires. The shell is what gives it a pitch, the wires are
        // what make it a snare; either alone sounds like something else.
        end = Math.max(end, body(t, dest, { from: 210, to: 155, type: 'triangle', dur: dec * 0.45, level: 0.5, bend: 0.05 }));
        end = Math.max(end, burst(t, dest, { freq: 1900, q: 0.8, dur: dec, level: 0.7 }));
        break;
      case 'hat':
        end = Math.max(end, burst(t, dest, { freq: 8600, type: 'highpass', dur: dec, level: 0.55 }));
        break;
      case 'clap': {
        // Three fast bursts and a tail. The stagger IS the clap — a single
        // burst of the same noise is just a snare with no shell.
        const sp = [0, 0.011, 0.021];
        sp.forEach((o) => { end = Math.max(end, burst(t + o, dest, { freq: 1250, q: 1.5, dur: 0.022, level: 0.55 })); });
        end = Math.max(end, burst(t + 0.030, dest, { freq: 1150, q: 1.1, dur: dec, level: 0.42 }));
        break;
      }
      case 'tom':
        end = Math.max(end, body(t, dest, { from: n * 1.5, to: n * 0.85, dur: dec, level: 0.9, bend: 0.10 }));
        end = Math.max(end, burst(t, dest, { freq: 3000, type: 'highpass', dur: 0.02, level: 0.12 }));
        break;
      case 'rim':
        end = Math.max(end, burst(t, dest, { freq: 2400, q: 7, dur: 0.028, level: 0.7 }));
        end = Math.max(end, body(t, dest, { from: 1700, to: 1500, type: 'square', dur: 0.018, level: 0.16, bend: 0.01 }));
        break;
      case 'cym':
        // A ride wants to ring, so it gets two bands rather than one: a bright
        // edge that decays fast over a duller wash that hangs on.
        end = Math.max(end, burst(t, dest, { freq: 7200, type: 'highpass', dur: dec, level: 0.34 }));
        end = Math.max(end, burst(t, dest, { freq: 4200, q: 0.6, dur: dec * 0.55, level: 0.2 }));
        break;
      default:
        end = Math.max(end, burst(t, dest, { freq: Math.max(400, n * 6), q: 3, dur: dec, level: 0.6 }));
        end = Math.max(end, body(t, dest, { from: n * 4, to: n * 3.2, dur: Math.min(dec, 0.06), level: 0.22, bend: 0.03 }));
        break;
    }
    return end;
  }

  // ---- unison -------------------------------------------------------------
  // One sawtooth is a sawtooth. Several, detuned and spread across the stereo
  // field, is a supersaw — and a supersaw is most of what makes trance sound
  // like trance. It is also what a pad needs to feel wide rather than thin.
  //
  // Three voices, not the seven a hardware supersaw uses: the third and fourth
  // pair add very little the ear can pick out, and this has to survive sixteen
  // cells firing at once on a phone.
  function makeUnison(voice, t, freq, dest) {
    const spread = clamp(voice.spread, 0, 1);
    const cents = spread * 26;
    const wave = voice.wave || 'sawtooth';
    const parts = spread > 0.02 ? [-1, 0, 1] : [0];
    const oscs = [];
    for (const k of parts) {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.setValueAtTime(freq, t);
      o.detune.setValueAtTime(k * cents + clamp(voice.tune, -24, 24) * 100, t);
      // A tiny random phase offset per hit stops the unison from cancelling
      // itself the same way every time, which is what makes a static detune
      // sound like a comb filter instead of a chorus.
      let node = o;
      if (k !== 0 && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = k * (0.25 + spread * 0.55);
        o.connect(p); node = p;
      }
      const trim = ctx.createGain();
      trim.gain.value = parts.length > 1 ? (k === 0 ? 0.62 : 0.44) : 1;
      node.connect(trim); trim.connect(dest);
      oscs.push(o);
    }
    return oscs;
  }

  // ---- one hit ------------------------------------------------------------
  // `when` is an absolute AudioContext time. Passing 0 means "now" — the live
  // path — and the sequencer always passes a real future time.
  // `semis` is the step's own pitch, in semitones from the voice's note. It is
  // a separate argument rather than a field on the voice because it changes on
  // every step while the voice does not, and mutating a shared voice record per
  // step would be a race with whatever the UI is doing to the same object.
  function play(voice, when, vel, cellIndex, semis) {
    // Silence is a mode, not an error: everything upstream still runs, the
    // meters still light, and the pattern is still being edited.
    if (!init()) { if (cellIndex != null) meters[cellIndex] = 1; return { stop: 0 }; }
    // A LIVE hit (when == 0) used to be scheduled at exactly ctx.currentTime.
    // That time has already been passed by the audio thread — the graph renders
    // in blocks of 128 samples, so "now" is always somewhere inside a block that
    // is already being computed. Every ramp starting at a past time is applied
    // from partway along, so the attack begins at whatever value it should have
    // reached by then instead of at zero, and a jump from silence to partway up
    // is a click. On every pad hit, every key, every audition.
    //
    // NUDGE is three render quanta at 44.1k. Far enough ahead that the whole
    // envelope is in the future, far below anything a player can feel — this is
    // three milliseconds against a speaker and room that add twenty.
    const t = when || (ctx.currentTime + NUDGE);
    const v = clamp(vel == null ? 100 : vel, 1, 127) / 127;
    const g = ctx.createGain();
    // A panner set to dead centre is a node that does nothing but cost
    // something. Every hit builds its own graph, so at a busy tempo this is
    // hundreds of nodes a second created, connected and collected for no
    // audible effect — and most pads in most kits are centred.
    const pan = (ctx.createStereoPanner && Math.abs(clamp(voice.pan, -1, 1)) > 0.02)
      ? ctx.createStereoPanner() : null;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    // Musical taper: linear cutoff spends its whole travel where the ear hears
    // nothing. 60Hz..14kHz over an exponential curve is what a knob should do.
    flt.frequency.setValueAtTime(60 * Math.pow(233, clamp(voice.cutoff, 0, 1)), t);
    flt.Q.value = 0.6 + clamp(voice.res, 0, 1) * 14;

    const a = clamp(voice.attack, 0.001, 2), d = clamp(voice.decay, 0.01, 3);
    const s = clamp(voice.sustain, 0, 1), r = clamp(voice.release, 0.01, 4);
    const peak = v * clamp(voice.gain, 0, 1.4);

    // Everything routes through the same tail: filter, optional drive, level,
    // pan, reverb send. Only the SOURCE differs between a sample, a drum and a
    // synth, so that is the only thing branched on.
    let chain = flt;
    if (voice.drive > 0.02) {
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(voice.drive); ws.oversample = '2x';
      flt.connect(ws); chain = ws;
    }
    chain.connect(g);
    if (pan) { pan.pan.value = clamp(voice.pan, -1, 1); g.connect(pan); pan.connect(master); }
    else g.connect(master);
    if (voice.space > 0.02) {
      const sd = ctx.createGain(); sd.gain.value = clamp(voice.space, 0, 1) * 0.5;
      g.connect(sd); sd.connect(spaceIn);
    }

    // A sample, if one is assigned AND already decoded. Never await here: this
    // function is called from the scheduler with an exact future start time, and
    // an await would hand that time back to the event loop and land the note
    // late. The library warms the buffer when the sample is assigned instead.
    let sample = null;
    if (voice.sampleId && sampleFor) {
      const buf = sampleFor(voice.sampleId);
      if (buf) {
        sample = ctx.createBufferSource();
        sample.buffer = buf;
        // Tune a sample by playback rate — the honest, zero-cost way. tune is in
        // semitones so it reads the same as it does on a synth voice.
        sample.playbackRate.value = Math.pow(2, (clamp(voice.tune, -24, 24) + (semis || 0)) / 12);
        sample.connect(flt);
      }
    }

    let stop;
    if (sample) {
      stop = t + a + d + r;
      envelope(g, t, a, d, s, r, peak, stop);
      sample.start(t);
      // A one-shot sample should be allowed to finish. Stopping it at the
      // envelope release would chop the tail off every crash and every vocal.
      const natural = sample.buffer.duration / (sample.playbackRate.value || 1);
      sample.stop(Math.max(stop, t + natural) + 0.02);
    } else if (voice.kind === 'drum') {
      // A drum's shape lives inside its own layers — each one already carries
      // the envelope that makes it that drum. So the voice gain here is a level
      // trim held flat, NOT a second envelope; laying an ADSR over a kick that
      // already decayed just re-shapes it into something that is not a kick.
      g.gain.setValueAtTime(Math.max(0.0002, peak), t);
      const end = playDrum(voice, t, flt);
      stop = end + 0.05;
      g.gain.setValueAtTime(Math.max(0.0002, peak), stop - 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, stop);
    } else {
      stop = t + a + d + r;
      envelope(g, t, a, d, s, r, peak, stop);
      const oscs = makeUnison(voice, t, hz(voice.note + (semis || 0)), flt);
      oscs.forEach((o) => { o.start(t); o.stop(stop + 0.02); });
    }

    if (cellIndex != null) meters[cellIndex] = Math.max(meters[cellIndex], v);
    return { stop };
  }

  function envelope(g, t, a, d, s, r, peak, stop) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * Math.max(0.0005, s)), t + a + d);
    g.gain.exponentialRampToValueAtTime(0.0001, stop);
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

  // The same shape as a real voice handle, doing nothing. The key system tracks
  // and releases it exactly as it would a sounding note, so polyphony, the
  // sustain pedal and panic all keep working with no audio at all — and none of
  // that code needs to know.
  function silentVoice() {
    let gone = false;
    const noop = () => {};
    return { note: 0, isSample: false, get dead() { return gone; },
             bend: noop, vib: noop, press: noop, timbre: noop, level: noop,
             off() { gone = true; }, steal() { gone = true; } };
  }

  function hold(voice, note, vel, when) {
    if (!init()) return silentVoice();
    // Same nudge as play(), for the same reason: a key held down is still a
    // note starting, and starting it in the past clips its attack to a click.
    // A keyboard is the place that would be noticed first — every note.
    const t = when || (ctx.currentTime + NUDGE);
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
    // A held key gets the same unison as a triggered one, or the LEAD would be
    // a fat supersaw from the pad and a single thin saw from the keyboard —
    // the same cell sounding like two different instruments depending on what
    // you touched.
    let unison = null;
    if (!src) {
      unison = makeUnison(voice, t, hz(note), flt);
      src = unison[0];
    }

    // Both AudioBufferSourceNode and OscillatorNode expose .detune in cents, so
    // bend and vibrato reach a sample and a synth down the same wire. With a
    // unison every voice has to be bent TOGETHER, or the chord detunes itself
    // as you move the wheel.
    const bendable = unison ? unison.map((o) => o.detune) : (src.detune ? [src.detune] : []);
    const baseDetune = unison ? unison.map((o) => o.detune.value) : [0];
    let vibDepth = null;
    if (bendable.length) {
      vibDepth = ctx.createGain(); vibDepth.gain.value = 0;
      vibrato().connect(vibDepth);
      bendable.forEach((p) => vibDepth.connect(p));
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

    // makeUnison already wired its oscillators into the filter, so only a
    // sample still needs connecting — doing both would route the unison through
    // the filter twice and double its level.
    if (!unison) src.connect(flt);
    let chain = flt;
    if (voice.drive > 0.02) {
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(voice.drive); ws.oversample = '2x';
      flt.connect(ws); chain = ws;
    }
    chain.connect(env); env.connect(exp);
    if (pan) { pan.pan.value = clamp(voice.pan, -1, 1); exp.connect(pan); pan.connect(master); }
    else exp.connect(master);
    if (voice.space > 0.02) {
      const sd = ctx.createGain(); sd.gain.value = clamp(voice.space, 0, 1) * 0.5;
      exp.connect(sd); sd.connect(spaceIn);
    }
    const sources = unison || [src];
    sources.forEach((o) => o.start(t));

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
      sources.forEach((o) => { try { o.stop(now + secs + 0.03); } catch (e) {} });
    }
    return {
      note, isSample,
      get dead() { return dead; },
      // Bend arrives in SEMITONES, because that is the unit a player thinks in.
      // Cents are an implementation detail of the audio graph.
      // Each voice keeps its own unison offset and the bend is added ON TOP of
      // it, so a chord bends as a chord instead of collapsing to one pitch.
      bend(semis) {
        if (dead) return;
        const c = clamp(semis, -48, 48) * 100;
        bendable.forEach((p, i) => { try { p.setTargetAtTime(baseDetune[i] + c, ctx.currentTime, 0.006); } catch (e) {} });
      },
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
  // AHEAD is how far into the future notes are committed; TICK is how often the
  // queue is topped up. AHEAD must comfortably exceed TICK, or a late timer
  // leaves a hole in the music.
  //
  // IT ADAPTS, because a fixed value cannot be right. This scheduler runs on
  // the main thread, so a heavy frame does not merely slow the picture down —
  // it stops the queue being topped up at all. Measured on a CPU four times
  // slower than a laptop, with the nebula running, the main thread was blocked
  // for over 160ms at a stretch and TWENTY-FIVE of forty-six notes were handed
  // to the audio clock after it had already gone past them. That is not a
  // subtle timing wobble; that is the crackle.
  //
  // A bigger look-ahead absorbs it completely, and costs nothing that matters:
  // notes are placed on the audio clock by TIME, so a note committed 400ms
  // early sounds at exactly the same instant as one committed 120ms early. The
  // only price is that an edit to the pattern takes slightly longer to be
  // heard, so the window grows only when it has to and shrinks back when the
  // machine recovers.
  const AHEAD_MIN = 0.12, AHEAD_MAX = 0.6, TICK = 25;
  let ahead = AHEAD_MIN;
  let playing = false, step = 0, nextTime = 0, timer = 0, onStep = null;

  // HOW HEALTHY THE CLOCK IS.
  // Every note is handed to the audio clock with some LEAD — the gap between
  // now and the moment it is due. Positive lead means it will sound exactly on
  // time. Lead at or below zero means the clock has already gone past it, and
  // the audio thread does the only thing it can: plays it immediately, late,
  // usually with its attack cut off. That is what "crackling" actually is, and
  // it is a number rather than a feeling.
  //
  // Two subtractions per step buys the difference between "the audio sounds
  // bad on my phone" and "the scheduler missed eleven times in four seconds".
  // `worst` is over a ROLLING window, not since the beginning. One bad moment
  // half an hour ago is not what anyone means by "is the audio struggling", and
  // a lifetime minimum can only ever get worse, so it stops carrying
  // information almost immediately.
  // About three seconds of steps at a normal tempo. Long enough to be a
  // trend, short enough that "lately" still means lately — a 64-step ring
  // reported a bad lead from seven seconds ago as if it were current.
  const RECENT = 24;
  const recent = new Float32Array(RECENT).fill(1);
  let rp = 0;
  const health = { late: 0, steps: 0 };
  function worstRecent() {
    let m = Infinity;
    for (let i = 0; i < RECENT; i++) if (recent[i] < m) m = recent[i];
    return m;
  }

  function schedule(song) {
    const spb = 60 / clamp(song.bpm, 20, 300) / 4;      // sixteenths

    // RESYNC. If the queue has fallen a long way behind — the tab was hidden,
    // the phone slept, a long task blocked everything — then nextTime can be
    // seconds in the past, and the loop below would faithfully fire every step
    // it missed, all at once, as a burst of noise. Catching up is not what
    // anyone wants from a loop: pick up from the beat that is due now.
    const behind = ctx.currentTime - nextTime;
    if (behind > 0.5) {
      const missed = Math.ceil(behind / spb);
      step = (step + missed) % 16;
      nextTime += missed * spb;
      health.late++;
    }

    while (nextTime < ctx.currentTime + ahead) {
      const lead = nextTime - ctx.currentTime;
      health.steps++;
      recent[rp] = lead; rp = (rp + 1) % RECENT;
      if (lead <= 0) {
        health.late++;
        // Open the window. One late note means the main thread just stalled for
        // longer than the window, and the only defence is a wider one.
        ahead = Math.min(AHEAD_MAX, ahead + 0.12);
      } else if (lead > ahead * 0.55 && ahead > AHEAD_MIN) {
        // Comfortably ahead: close it again, slowly. Snapping straight back
        // would just re-enter the stall on the next heavy frame.
        ahead = Math.max(AHEAD_MIN, ahead - 0.004);
      }
      const cells = song.scenes[song.scene].cells;
      const anySolo = cells.some((c) => c.solo);
      // Swing delays the off-beats only. Applying it to every step just slows
      // the tempo, which is the classic way to get this wrong.
      const swung = (step % 2) ? clamp(song.swing, 0, 0.6) * spb * 0.6 : 0;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c.mute || (anySolo && !c.solo)) continue;
        const vel = c.steps[step % c.steps.length];
        if (vel > 0) {
          // Drums are left alone. A kick that changes pitch with the chord is
          // not a feature anyone asked for, and the pitch lane is written by
          // the genre engine only for the roles that carry harmony.
          const semis = (c.notes && c.voice.kind !== 'drum') ? (c.notes[step % c.notes.length] | 0) : 0;
          play(c.voice, nextTime + swung, vel, i, semis);
        }
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
    get silent() { return dead; },
    start(song, cb) {
      resume(); if (playing || !ctx) return;
      playing = true; step = 0; onStep = cb || null;
      health.late = 0; health.steps = 0; recent.fill(1); ahead = AHEAD_MIN;
      nextTime = ctx.currentTime + 0.06;
      schedule(song);
    },
    // What the clock has been doing lately. `worst` is the smallest lead any of
    // the last 64 notes got, in seconds; `late` counts every note that was
    // already overdue when it was handed over; `ahead` is how wide the
    // look-ahead window has had to open to keep up.
    get health() {
      return { late: health.late, steps: health.steps, ahead,
               worst: health.steps ? worstRecent() : 0 };
    },
    // How long a frame is currently taking, in milliseconds, from whoever is
    // running the render loop.
    //
    // The scheduler cannot see this for itself, and it is the single best
    // predictor of the thing that hurts it: a frame that takes 60ms is a main
    // thread that will be unavailable for 60ms at a time, and a look-ahead
    // window narrower than that is a hole in the music waiting to happen.
    // Reacting to lateness alone is always one stall too late — the first one
    // has already been heard. This lets the window open BEFORE anything is
    // missed, which is the difference between recovering and not crackling.
    pace(ms) {
      if (!(ms > 0)) return;
      const floor = Math.max(AHEAD_MIN, Math.min(AHEAD_MAX, ms * 4 / 1000));
      if (floor > ahead) ahead = floor;
    },
    stop() { playing = false; clearTimeout(timer); step = 0; },
    get step() { return step; },
    // Jump to a step. The queue is scheduled up to about 120ms ahead, so the
    // steps already handed to the audio clock still sound — this changes where
    // the loop goes NEXT, not what is already on its way out. Trying to unpick
    // the queue would mean cancelling sources mid-note, which is a click.
    seek(s) {
      step = ((s | 0) % 16 + 16) % 16;
      return step;
    },
  };
}
