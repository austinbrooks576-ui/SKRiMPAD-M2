// model.js — the song, and nothing but the song.
//
// One rule the whole app obeys: THE MODEL IS THE ONLY TRUTH. No renderer keeps
// its own copy of anything, no altitude caches state, and no DOM node is ever
// asked what a value is. Every altitude is a pure function of this object.
//
// That is what makes semantic zoom possible at all. CONSTELLATION and GRAIN are
// drawings of the same 16 cells at different distances; if either one owned
// state, they would drift the instant you edited at one altitude and looked at
// another. It is also why undo is four lines and persistence is one.

const KEY = 'skrimpad_ultimate_song';
export const STEPS = 16;
export const CELLS = 16;
export const SCENES = 4;

// A voice is a small, honest synth description. Deliberately not a patch format
// with 200 fields: everything here is something you can HEAR change, which is
// what makes the VOICE altitude worth flying down to.
export function makeVoice(seed = 0) {
  return {
    kind: ['drum', 'synth', 'sample'][seed % 3 === 0 ? 0 : 1],
    wave: ['sine', 'square', 'sawtooth', 'triangle'][seed % 4],
    note: 36 + (seed % 12),
    cutoff: 0.62, res: 0.18, attack: 0.01, decay: 0.28, sustain: 0.25, release: 0.22,
    drive: 0.12, space: 0.18, pan: 0, gain: 0.8, tune: 0,
    sampleId: null,
  };
}

export function makeCell(i) {
  return {
    id: 'c' + i,
    name: ['KICK', 'SNARE', 'HAT', 'CLAP', 'TOM', 'RIM', 'PERC', 'CYM',
           'BASS', 'SUB', 'LEAD', 'PLUCK', 'PAD', 'BELL', 'STAB', 'FX'][i] || ('CELL ' + (i + 1)),
    hue: Math.round((i * 360) / CELLS),
    steps: new Array(STEPS).fill(0),      // 0 = off, 1..127 = velocity
    voice: makeVoice(i),
    mute: false, solo: false,
    level: 0,                             // live meter, written by the engine
  };
}

export function makeSong() {
  return {
    v: 1,
    name: 'UNTITLED',
    bpm: 100,
    swing: 0,
    scene: 0,
    scenes: Array.from({ length: SCENES }, (_, s) => ({
      name: 'SCENE ' + (s + 1),
      cells: Array.from({ length: CELLS }, (_, i) => makeCell(i)),
    })),
  };
}

// Shape-checked load. A stored "null" or "[1,2]" parses cleanly and then throws
// at the first property read — the same class of bug that stopped the Consumer
// app booting. Anything that is not the record we expect is discarded whole.
export function loadSong() {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return makeSong();
    if (!Array.isArray(v.scenes) || !v.scenes.length) return makeSong();
    // fill any gap a future version might leave rather than trusting the file
    const fresh = makeSong();
    fresh.name = typeof v.name === 'string' ? v.name : fresh.name;
    fresh.bpm = Number.isFinite(+v.bpm) ? Math.max(20, Math.min(300, +v.bpm)) : fresh.bpm;
    fresh.swing = Number.isFinite(+v.swing) ? Math.max(0, Math.min(0.6, +v.swing)) : 0;
    fresh.scene = Math.max(0, Math.min(SCENES - 1, +v.scene || 0));
    v.scenes.slice(0, SCENES).forEach((sc, s) => {
      if (!sc || !Array.isArray(sc.cells)) return;
      if (typeof sc.name === 'string') fresh.scenes[s].name = sc.name;
      sc.cells.slice(0, CELLS).forEach((c, i) => {
        const dst = fresh.scenes[s].cells[i];
        if (!c || typeof c !== 'object') return;
        if (typeof c.name === 'string') dst.name = c.name;
        if (Number.isFinite(+c.hue)) dst.hue = +c.hue;
        if (Array.isArray(c.steps)) for (let k = 0; k < STEPS; k++) dst.steps[k] = +c.steps[k] || 0;
        if (c.voice && typeof c.voice === 'object') Object.assign(dst.voice, c.voice);
        dst.mute = !!c.mute;
      });
    });
    return fresh;
  } catch (e) { return makeSong(); }
}

let saveTimer = 0;
export function saveSong(song) {
  // Coalesced: dragging a knob writes 60 times a second and localStorage is
  // synchronous. One write per idle moment instead of one per pixel.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(song, (k, v) => (k === 'level' ? undefined : v))); }
    catch (e) {}
  }, 400);
}

// ---- UNDO -------------------------------------------------------------------
// Cheap because the model is one plain object: a ring of snapshots. 40 deep is
// far more than anyone reaches for and costs a few hundred KB at most.
export function createHistory(limit = 40) {
  const past = [], future = [];
  let last = '';
  return {
    push(song) {
      const s = JSON.stringify(song);
      if (s === last) return;
      last = s; past.push(s); future.length = 0;
      if (past.length > limit) past.shift();
    },
    undo(song) {
      if (past.length < 2) return null;
      future.push(past.pop());
      const s = past[past.length - 1];
      last = s; return JSON.parse(s);
    },
    redo() {
      const s = future.pop(); if (!s) return null;
      past.push(s); last = s; return JSON.parse(s);
    },
    get depth() { return past.length; },
  };
}

export const scenes = (song) => song.scenes;
export const liveScene = (song) => song.scenes[song.scene];
export const liveCells = (song) => liveScene(song).cells;
export const cellAt = (song, i) => liveCells(song)[i];
