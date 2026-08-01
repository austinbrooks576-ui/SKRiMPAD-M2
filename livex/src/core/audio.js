// audio.js — WebAudio sound engine. Synth voices for keys, synthesized drums for
// pads, and playback of library samples. The voice factory is parameterized by an
// AudioContext + output node so the SAME synthesis drives live playback AND the
// OfflineAudioContext render used by Export. WAV encoder ported from SKRiMPAD M2.

export const freqFromMidi = (m) => 440 * Math.pow(2, (m - 69) / 12);

let ctx = null, master = null, toneBus = null, drumBus = null, ready = false;
const samples = Object.create(null); // 'pad:3' / 'key:60' -> AudioBuffer

export function isReady() { return ready; }
export function context() { return ctx; }

// Build the mix bus. THE RULE: drums and keys never share a compressor.
// Everything used to run through one 3:1 compressor, so holding keys — which are
// sustained, unlike short drum hits — kept it clamped down and audibly sucked the
// whole kit quiet for as long as you held a chord. Now the synth has its own
// compressor to tame its own sustain, the drums run clean, and the only shared
// stage is a fast brick-wall limiter that just catches peaks instead of pumping.
function buildBuses(c, dest) {
  const out = c.createGain(); out.gain.value = 0.85;

  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20;
  limiter.attack.value = 0.002; limiter.release.value = 0.05;

  const tone = c.createGain(); tone.gain.value = 0.9;
  const toneComp = c.createDynamicsCompressor();
  toneComp.threshold.value = -14; toneComp.knee.value = 8; toneComp.ratio.value = 3;
  toneComp.attack.value = 0.005; toneComp.release.value = 0.18;

  const drum = c.createGain(); drum.gain.value = 1.0;   // straight through, no ducking

  // PERFORMANCE STAGE — the parameters the hardware knobs actually move.
  // Without these a controller's knobs emit CC into nothing: only volume and
  // brightness were wired, so six of the eight knobs on a JP-1 did nothing at
  // all. Every knob now lands on a real node in this chain.
  const filter = c.createBiquadFilter();      // sweepable master lowpass
  filter.type = 'lowpass'; filter.frequency.value = 20000; filter.Q.value = 0.7;
  const panner = c.createStereoPanner ? c.createStereoPanner() : null;

  // SPACE — a cheap stereo echo used as a send, so "reverb" costs almost
  // nothing on a phone but still opens the mix up.
  const spaceSend = c.createGain(); spaceSend.gain.value = 0;
  const dl = c.createDelay(1.0); dl.delayTime.value = 0.19;
  const fb = c.createGain(); fb.gain.value = 0.34;
  const damp = c.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 3200;
  spaceSend.connect(dl); dl.connect(damp); damp.connect(fb); fb.connect(dl);
  damp.connect(out);

  tone.connect(toneComp); toneComp.connect(filter);
  drum.connect(filter);
  filter.connect(out);
  tone.connect(spaceSend); drum.connect(spaceSend);
  if (panner) { out.connect(panner); panner.connect(limiter); } else { out.connect(limiter); }
  limiter.connect(dest);
  return { out, tone, drum, filter, panner, spaceSend };
}

export function initAudio() {
  if (ready) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
  if (ctx.state === 'suspended') ctx.resume();
  const b = buildBuses(ctx, ctx.destination);
  master = b.out; toneBus = b.tone; drumBus = b.drum;
  perf.filter = b.filter; perf.panner = b.panner; perf.spaceSend = b.spaceSend;
  ready = true;
  return ctx;
}

// ---- PERFORMANCE PARAMETERS -------------------------------------------------
// One named function per knob, so a controller's knobs all DO something. Values
// are 0..1 as they arrive from a CC; the mapping to musical range lives here so
// every caller (hardware knob, on-screen knob, mouse drag) behaves identically.
const perf = { filter: null, panner: null, spaceSend: null };
export const PARAMS = ['volume', 'tone', 'cutoff', 'resonance', 'attack', 'release', 'space', 'drums'];
export const PARAM_LABEL = {
  volume: 'VOL', tone: 'TONE', cutoff: 'CUTOFF', resonance: 'RES',
  attack: 'ATTACK', release: 'RELEASE', space: 'SPACE', drums: 'DRUMS',
};
const paramVals = { volume: 0.85, tone: 0.5, cutoff: 1, resonance: 0, attack: 0, release: 0.35, space: 0, drums: 1 };
export function getParam(name) { return paramVals[name]; }
export function getParams() { return Object.assign({}, paramVals); }

export function setParam(name, v01) {
  if (!(name in paramVals)) return false;
  const v = clamp01(v01);
  paramVals[name] = v;
  if (!ready) initAudio();
  switch (name) {
    case 'volume': setMasterVolume(v); break;
    case 'tone': setBrightness(v); break;
    // exponential sweep — a linear cutoff knob is unusable, all the action
    // would sit in the last few degrees of travel
    case 'cutoff': if (perf.filter) perf.filter.frequency.value = 80 * Math.pow(250, v); break;
    case 'resonance': if (perf.filter) perf.filter.Q.value = 0.7 + v * 18; break;
    case 'attack': envAttack = v * v * 1.2; break;          // 0 … 1.2s, fine at the low end
    case 'release': envRelease = 0.05 + v * 2.5; break;
    case 'space': if (perf.spaceSend) perf.spaceSend.gain.value = v * 0.55; break;
    case 'drums': if (drumBus) drumBus.gain.value = v * 1.4; break;
    default: return false;
  }
  return true;
}
// envelope shape used by noteOn — the ATTACK and RELEASE knobs move these
let envAttack = 0.01, envRelease = 0.35;
export function getEnv() { return { attack: envAttack, release: envRelease }; }
export function setPan(v01) {
  if (!ready) initAudio();
  if (perf.panner) perf.panner.pan.value = (clamp01(v01) - 0.5) * 2;
}
export function output() { return master; }
export function toneOut() { return toneBus; }
export function drumOut() { return drumBus; }
// Math.max(0, Math.min(1, NaN)) is NaN — the usual clamp does NOT stop a bad
// value, and Web Audio THROWS on a non-finite AudioParam rather than ignoring
// it, taking the caller's whole handler down. Everything that reaches a param
// goes through this.
export function clamp01(v) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
export function setMasterVolume(v) { if (master) master.gain.value = clamp01(v); }

// CC1 (mod wheel) → synth brightness: scales every voice's lowpass cutoff.
// 0.35 (dark) … 1.6 (bright); default 1.
let brightness = 1;
export function setBrightness(v01) { brightness = 0.35 + clamp01(v01) * 1.25; }
export function getBrightness() { return brightness; }

// assign a decoded sample to a pad index / key note (from the library / drop)
export function setSample(role, id, buffer) { samples[role + ':' + id] = buffer; }
export function clearSample(role, id) { delete samples[role + ':' + id]; }

// SPLASH — lay one sample across the WHOLE keyboard, repitched per key from a
// root note. It is a FALLBACK layer, never an overwrite: any key you have
// programmed individually still wins, so you can splash a pad across the board
// and then replace single keys without losing either.
let splash = null; // { buffer, root }
export function setSplash(buffer, rootNote = 60) { splash = buffer ? { buffer, root: rootNote } : null; }
export function getSplash() { return splash; }
export function clearSplash() { splash = null; }
// resolve what a key should play: explicit assignment first, then the splash layer
function keyVoiceFor(midi) {
  const own = samples['key:' + midi];
  if (own) return { buffer: own, rate: 1 };
  if (splash) return { buffer: splash.buffer, rate: Math.pow(2, (midi - splash.root) / 12) };
  return null;
}

// ---- one noise buffer per context (snare / hat / clap) ----
const noiseCache = new WeakMap();
function noise(c) {
  let b = noiseCache.get(c);
  if (b) return b;
  b = c.createBuffer(1, c.sampleRate * 0.5, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseCache.set(c, b); return b;
}

// ---- voice factory bound to a context + destination ----
// `outTone` carries pitched/synth material, `outDrum` the kit. Keeping them on
// separate destinations is what stops a held chord from ducking the drums.
export function createVoices(c, out, outDrum) {
  const drumOutNode = outDrum || out;
  const env = (g, t, a, d, peak) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  function kick(t, o, v) {
    const osc = c.createOscillator(), g = c.createGain();
    osc.frequency.setValueAtTime(150, t); osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    env(g, t, 0.004, 0.4, 0.9 * v); osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.5);
  }
  function snare(t, o, v) {
    const n = c.createBufferSource(), ng = c.createGain(), hp = c.createBiquadFilter();
    n.buffer = noise(c); hp.type = 'highpass'; hp.frequency.value = 1400;
    env(ng, t, 0.002, 0.18, 0.7 * v); n.connect(hp); hp.connect(ng); ng.connect(o); n.start(t); n.stop(t + 0.25);
    const osc = c.createOscillator(), og = c.createGain(); osc.type = 'triangle'; osc.frequency.value = 190;
    env(og, t, 0.002, 0.12, 0.4 * v); osc.connect(og); og.connect(o); osc.start(t); osc.stop(t + 0.2);
  }
  function hat(t, o, v, open) {
    const n = c.createBufferSource(), g = c.createGain(), hp = c.createBiquadFilter();
    n.buffer = noise(c); hp.type = 'highpass'; hp.frequency.value = 7000;
    env(g, t, 0.001, open ? 0.3 : 0.05, 0.35 * v); n.connect(hp); hp.connect(g); g.connect(o);
    n.start(t); n.stop(t + (open ? 0.35 : 0.08));
  }
  function clap(t, o, v) {
    const n = c.createBufferSource(), g = c.createGain(), bp = c.createBiquadFilter();
    n.buffer = noise(c); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 1.2;
    env(g, t, 0.002, 0.15, 0.5 * v); n.connect(bp); bp.connect(g); g.connect(o); n.start(t); n.stop(t + 0.2);
  }
  function tom(t, o, v, f) {
    const osc = c.createOscillator(), g = c.createGain();
    osc.frequency.setValueAtTime(f, t); osc.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.2);
    env(g, t, 0.004, 0.3, 0.7 * v); osc.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.4);
  }
  const DRUMS = [kick, snare, (t, o, v) => hat(t, o, v, false), (t, o, v) => hat(t, o, v, true),
    clap, (t, o, v) => tom(t, o, v, 180), (t, o, v) => tom(t, o, v, 110), (t, o, v) => hat(t, o, v, true)];

  function sampleVoice(buf, t, o, v, rate) {
    const s = c.createBufferSource(), g = c.createGain();
    s.buffer = buf; s.playbackRate.value = rate || 1; g.gain.value = v;
    s.connect(g); g.connect(o); s.start(t); return { s, g };
  }

  // scheduled (fixed-length) — used by the looper + offline export
  function scheduleTone(midi, vel, t, dur) {
    const v = Math.max(0.06, (vel || 100) / 127) * 0.34;
    const kv = keyVoiceFor(midi);
    if (kv) { sampleVoice(kv.buffer, t, out, v * 2, kv.rate); return; }
    const g = c.createGain(), o1 = c.createOscillator(), o2 = c.createOscillator(), lp = c.createBiquadFilter();
    o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = -9;
    const f = freqFromMidi(midi); o1.frequency.value = f; o2.frequency.value = f;
    lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 7 * brightness);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.008);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * 0.6), t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, dur));
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(out);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
  }
  function scheduleDrum(index, vel, t) {
    const v = Math.max(0.15, (vel || 110) / 127);
    const smp = samples['pad:' + index];
    if (smp) { sampleVoice(smp, t, drumOutNode, v, 1); return; }
    (DRUMS[index % DRUMS.length] || kick)(t, drumOutNode, v);
  }
  return { scheduleTone, scheduleDrum, sampleVoice };
}

// ---- LIVE playback ----
let liveVoices = null;
function voices() { if (!ready) initAudio(); if (!liveVoices) liveVoices = createVoices(ctx, toneBus, drumBus); return liveVoices; }

// sustaining key voice (held until release); returns {release(), bend(cents)}.
// bend() retunes the live oscillators — wired to the pitch wheel (±200 cents).
export function noteOn(midi, vel = 100, bendCents = 0) {
  if (!ready) initAudio();
  // Clamp before anything becomes a frequency. A stray note number — a fuzzing
  // controller, a bad learned map, a transpose off the end of the board —
  // otherwise reaches an AudioParam as NaN and throws.
  midi = Math.max(0, Math.min(127, Math.round(Number(midi)) || 0));
  vel = Number.isFinite(Number(vel)) ? Math.max(1, Math.min(127, Number(vel))) : 100;
  bendCents = Number.isFinite(Number(bendCents)) ? Number(bendCents) : 0;
  const kv = keyVoiceFor(midi);
  const t = ctx.currentTime, v = Math.max(0.06, vel / 127) * 0.34;
  if (kv) {
    const h = voices().sampleVoice(kv.buffer, t, toneBus, v * 2, kv.rate * Math.pow(2, bendCents / 1200));
    return {
      release() { try { h.s.stop(ctx.currentTime + 0.3); } catch (e) {} },
      bend(c) { try { h.s.playbackRate.value = Math.pow(2, c / 1200); } catch (e) {} },
    };
  }
  const g = ctx.createGain(), o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter();
  o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = -9 + bendCents;
  const f = freqFromMidi(midi); o1.frequency.value = f; o2.frequency.value = f;
  o1.detune.value = bendCents;
  lp.type = 'lowpass'; lp.frequency.value = Math.min(9000, f * 7 * brightness);
  // ATTACK and RELEASE knobs shape the voice here — a slow attack swells the
  // note in, a long release lets it ring after the key is lifted.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + Math.max(0.006, envAttack));
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(toneBus);
  o1.start(t); o2.start(t);
  return {
    release() {
      const rt = ctx.currentTime; g.gain.cancelScheduledValues(rt);
      const rel = Math.max(0.05, envRelease);
      g.gain.setTargetAtTime(0.0001, rt, rel / 4);
      o1.stop(rt + rel + 0.2); o2.stop(rt + rel + 0.2);
    },
    bend(c) { o1.detune.value = c; o2.detune.value = -9 + c; },
  };
}
export function playPad(index, vel = 110) {
  if (!ready) initAudio();
  const i = Math.max(0, Math.round(Number(index)) || 0);
  const v = Number.isFinite(Number(vel)) ? Math.max(1, Math.min(127, Number(vel))) : 110;
  voices().scheduleDrum(i, v, ctx.currentTime);
}
export function playNoteShot(midi, vel = 100, dur = 0.3) { if (!ready) initAudio(); voices().scheduleTone(midi, vel, ctx.currentTime, dur); }

// ---- WAV export (ported from SKRiMPAD M2) ----
export function bufferToWav(buf) {
  const nCh = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
  const bytes = 44 + n * nCh * 2, ab = new ArrayBuffer(bytes), v = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * nCh * 2, true);
  let o = 44; const ch = []; for (let c = 0; c < nCh; c++) ch.push(buf.getChannelData(c));
  for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) { const x = Math.max(-1, Math.min(1, ch[c][i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
  return new Blob([ab], { type: 'audio/wav' });
}

// Render a list of loop events to a WAV Blob via OfflineAudioContext.
// events: [{ pos (s), type:'note'|'pad', note|index, vel, dur }]
export async function renderLoopToWav(events, lengthSec, sampleRate = 44100) {
  const oc = new OfflineAudioContext(2, Math.max(1, Math.ceil(lengthSec * sampleRate)), sampleRate);
  const b = buildBuses(oc, oc.destination);      // identical bus split offline
  const vx = createVoices(oc, b.tone, b.drum);
  for (const e of events) {
    if (e.type === 'pad') vx.scheduleDrum(e.index, e.vel, e.pos);
    else vx.scheduleTone(e.note, e.vel, e.pos, e.dur || 0.35);
  }
  const buf = await oc.startRendering();
  return bufferToWav(buf);
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
