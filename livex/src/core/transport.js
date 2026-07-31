// transport.js — the loop machine. A lookahead scheduler drives a beat clock at
// BPM; events (notes/pads) are recorded in BEAT positions so tempo changes stay
// musical. Record / overdub / play / stop / clear, a metronome, one-shot quantize
// (wired to SYNC), and Export → WAV via the offline renderer in audio.js.

import { initAudio, context, output, createVoices, renderLoopToWav, download } from './audio.js';

export const LOOP_CHANNELS = 5;

export function createTransport({ onState, onBeat } = {}) {
  let bpm = 100, beatsPerBar = 4, bars = 2;
  let playing = false, recording = false, metronome = false;
  // FIVE independent loop channels. Recording always lands on the ARMED channel,
  // playback sums every channel that is not muted, and each one clears on its own
  // so you can rebuild a single layer without losing the rest.
  const chans = Array.from({ length: LOOP_CHANNELS }, () => ({ events: [], mute: false }));
  let armed = 0;
  const allEvents = () => chans.reduce((a, c) => a.concat(c.events), []);
  let vx = null, anchor = 0, schedIter = 0, timer = null;
  const openNotes = new Map(); // note -> {event, startBeat} for dur capture

  const totalBeats = () => bars * beatsPerBar;
  const beatDur = () => 60 / bpm;
  const loopLenSec = () => totalBeats() * beatDur();
  const now = () => (context() ? context().currentTime : 0);
  const posBeats = () => { const T = totalBeats(); return (((now() - anchor) / beatDur()) % T + T) % T; };

  function emit() {
    onState && onState({
      playing, recording, metronome, bpm, bars, beatsPerBar,
      events: allEvents().length, armed,
      channels: chans.map((c, i) => ({ i, count: c.events.length, mute: c.mute, armed: i === armed })),
    });
  }

  function click(t, accent) {
    const c = context(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = accent ? 1600 : 1000;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.28, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(output()); o.start(t); o.stop(t + 0.06);
  }

  function scheduler() {
    if (!playing) return;
    const c = context(); if (!c) return;
    const bd = beatDur(), L = loopLenSec(), t0 = c.currentTime, AHEAD = 0.25;
    while (anchor + schedIter * L < t0 + AHEAD) {
      const base = anchor + schedIter * L;
      if (metronome) for (let b = 0; b < totalBeats(); b++) click(base + b * bd, b % beatsPerBar === 0);
      for (const ch of chans) {
      if (ch.mute) continue;
      for (const e of ch.events) {
        const t = base + e.pos * bd;
        if (t >= t0 - 0.02) {
          if (e.type === 'pad') vx.scheduleDrum(e.index, e.vel, t);
          else vx.scheduleTone(e.note, e.vel, t, e.dur || 0.4);
        }
      }
      }
      schedIter++;
    }
    const T = totalBeats(), p = posBeats();
    onBeat && onBeat(Math.floor(p), T, p / T);
  }

  function startClock() {
    initAudio();
    vx = createVoices(context(), output());
    anchor = context().currentTime + 0.08;
    schedIter = 0;
    playing = true;
    if (timer) clearInterval(timer);
    timer = setInterval(scheduler, 25);
    emit();
  }

  // ---- public transport ----
  function play() { if (!playing) startClock(); }
  function stop() { playing = false; recording = false; openNotes.clear(); if (timer) { clearInterval(timer); timer = null; } emit(); }
  function toggleRecord() {
    if (!playing) { startClock(); recording = true; }
    else recording = !recording;
    if (!recording) openNotes.clear();
    emit();
  }
  // clear the armed channel, a specific one, or every channel at once
  function clear(i) {
    const idx = (i == null) ? armed : i;
    if (chans[idx]) chans[idx].events = [];
    openNotes.clear(); emit();
  }
  function clearAll() { chans.forEach((c) => { c.events = []; }); openNotes.clear(); emit(); }
  function setArmed(i) { if (chans[i]) { armed = i; openNotes.clear(); emit(); } return armed; }
  function nextChannel(dir = 1) { return setArmed((armed + dir + LOOP_CHANNELS) % LOOP_CHANNELS); }
  function toggleMute(i) { if (chans[i]) { chans[i].mute = !chans[i].mute; emit(); return chans[i].mute; } }
  function channels() { return chans.map((c, i) => ({ i, count: c.events.length, mute: c.mute, armed: i === armed })); }
  function toggleMetronome() { metronome = !metronome; emit(); return metronome; }
  function setBpm(v) { bpm = Math.max(40, Math.min(300, v | 0)); emit(); }
  function setBars(n) { bars = Math.max(1, Math.min(8, n | 0)); emit(); }

  // record a live trigger at the current loop position (beats)
  function recordNoteOn(note, vel) {
    if (!recording || !playing) return;
    const ev = { type: 'note', note, vel: vel || 100, pos: posBeats(), dur: 0.4 };
    chans[armed].events.push(ev); openNotes.set(note, ev);
  }
  function recordNoteOff(note) {
    const ev = openNotes.get(note); if (!ev) return;
    const held = (posBeats() - ev.pos) * beatDur();
    ev.dur = Math.max(0.08, ((held % loopLenSec()) + loopLenSec()) % loopLenSec());
    openNotes.delete(note);
  }
  function recordPad(index, vel) {
    if (!recording || !playing) return;
    chans[armed].events.push({ type: 'pad', index, vel: vel || 110, pos: posBeats() });
  }

  // one-shot SYNC: quantize every event to the 1/16 grid, then hands off
  function quantize(grid = 0.25) {
    const T = totalBeats();
    for (const e of allEvents()) e.pos = (Math.round(e.pos / grid) * grid) % T;
    emit();
  }

  async function exportWav() {
    const src = chans.filter((c) => !c.mute).reduce((a, c) => a.concat(c.events), []);
    if (!src.length) return null;
    const bd = beatDur();
    const evs = src.map((e) => ({ ...e, pos: e.pos * bd }));
    const blob = await renderLoopToWav(evs, loopLenSec());
    download(blob, 'skrimpad-livex-loop-' + Math.round(bpm) + 'bpm.wav');
    return blob;
  }

  return {
    play, stop, toggleRecord, clear, clearAll, toggleMetronome, setBpm, setBars,
    setArmed, nextChannel, toggleMute, channels,
    recordNoteOn, recordNoteOff, recordPad, quantize, exportWav,
    state: () => ({ playing, recording, metronome, bpm, bars, events: allEvents().length, armed }),
    events: () => allEvents(),
  };
}
