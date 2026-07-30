// audio.js — WebAudio sound engine. Synth voices for keys, synthesized drums for
// pads, and playback of library samples. The voice factory is parameterized by an
// AudioContext + output node so the SAME synthesis drives live playback AND the
// OfflineAudioContext render used by Export. WAV encoder ported from SKRiMPAD M2.

export const freqFromMidi = (m) => 440 * Math.pow(2, (m - 69) / 12);

let ctx = null, master = null, ready = false;
const samples = Object.create(null); // 'pad:3' / 'key:60' -> AudioBuffer

export function isReady() { return ready; }
export function context() { return ctx; }

export function initAudio() {
  if (ready) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
  if (ctx.state === 'suspended') ctx.resume();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 3;
  comp.attack.value = 0.003; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = 0.8;
  master.connect(comp); comp.connect(ctx.destination);
  ready = true;
  return ctx;
}
export function output() { return master; }
export function setMasterVolume(v) { if (master) master.gain.value = Math.max(0, Math.min(1, v)); }

// CC1 (mod wheel) → synth brightness: scales every voice's lowpass cutoff.
// 0.35 (dark) … 1.6 (bright); default 1.
let brightness = 1;
export function setBrightness(v01) { brightness = 0.35 + Math.max(0, Math.min(1, v01)) * 1.25; }
export function getBrightness() { return brightness; }

// assign a decoded sample to a pad index / key note (from the library / drop)
export function setSample(role, id, buffer) { samples[role + ':' + id] = buffer; }
export function clearSample(role, id) { delete samples[role + ':' + id]; }

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
export function createVoices(c, out) {
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
    const smp = samples['key:' + midi];
    if (smp) { sampleVoice(smp, t, out, v * 2, 1); return; }
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
    if (smp) { sampleVoice(smp, t, out, v, 1); return; }
    (DRUMS[index % DRUMS.length] || kick)(t, out, v);
  }
  return { scheduleTone, scheduleDrum, sampleVoice };
}

// ---- LIVE playback ----
let liveVoices = null;
function voices() { if (!ready) initAudio(); if (!liveVoices) liveVoices = createVoices(ctx, master); return liveVoices; }

// sustaining key voice (held until release); returns {release(), bend(cents)}.
// bend() retunes the live oscillators — wired to the pitch wheel (±200 cents).
export function noteOn(midi, vel = 100, bendCents = 0) {
  if (!ready) initAudio();
  const smp = samples['key:' + midi];
  const t = ctx.currentTime, v = Math.max(0.06, vel / 127) * 0.34;
  if (smp) {
    const h = voices().sampleVoice(smp, t, master, v * 2, Math.pow(2, bendCents / 1200));
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
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01);
  o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(master);
  o1.start(t); o2.start(t);
  return {
    release() {
      const rt = ctx.currentTime; g.gain.cancelScheduledValues(rt);
      g.gain.setTargetAtTime(0.0001, rt, 0.08); o1.stop(rt + 0.6); o2.stop(rt + 0.6);
    },
    bend(c) { o1.detune.value = c; o2.detune.value = -9 + c; },
  };
}
export function playPad(index, vel = 110) { if (!ready) initAudio(); voices().scheduleDrum(index, vel, ctx.currentTime); }
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
  const g = oc.createGain(); g.gain.value = 0.8; g.connect(oc.destination);
  const vx = createVoices(oc, g);
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
