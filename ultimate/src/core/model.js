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
const VOICE_DEFAULTS = {
  kind: 'synth',
  drum: null,          // which drum, when kind is 'drum' — see engine playDrum
  wave: 'sawtooth',
  note: 48,
  cutoff: 0.62, res: 0.18, attack: 0.01, decay: 0.28, sustain: 0.25, release: 0.22,
  drive: 0.12, space: 0.18, pan: 0, gain: 0.8, tune: 0,
  spread: 0,           // unison width — 0 is one oscillator, 1 is a supersaw
  sampleId: null,
};

// THE DEFAULT KIT.
//
// The old defaults were generated from the cell index — kind alternated every
// third pad, the waveform cycled through four, the note was 36 + i. So SNARE
// was a square-wave tone at note 37 and PAD was a sawtooth blip. The names were
// labels on nothing, which is worse than no names at all, because a pad that
// says SNARE and clicks like a coin teaches you to distrust the whole grid.
//
// These are real starting points, tuned for TRANCE AND DEEP AMBIENT — long
// reverb tails, a supersaw lead, offbeat bass, and drums that stay out of the
// low end so the kick owns it. Every one is an ordinary voice record with no
// special casing: you can fly down to VOICE and take any of them apart.
const KIT = [
  // ---- rhythm. Short, dry, and deliberately clear of each other's range ----
  { name: 'KICK',  kind: 'drum', drum: 'kick',  note: 36, gain: 1.00, decay: 0.34, cutoff: 0.52, res: 0.05, drive: 0.30, space: 0.00 },
  { name: 'SNARE', kind: 'drum', drum: 'snare', note: 38, gain: 0.70, decay: 0.19, cutoff: 0.80, res: 0.08, drive: 0.10, space: 0.16 },
  { name: 'HAT',   kind: 'drum', drum: 'hat',   note: 42, gain: 0.40, decay: 0.045, cutoff: 0.97, res: 0.04, drive: 0.00, space: 0.06 },
  { name: 'CLAP',  kind: 'drum', drum: 'clap',  note: 39, gain: 0.60, decay: 0.20, cutoff: 0.86, res: 0.06, drive: 0.00, space: 0.30 },
  { name: 'TOM',   kind: 'drum', drum: 'tom',   note: 45, gain: 0.62, decay: 0.30, cutoff: 0.64, res: 0.10, drive: 0.05, space: 0.22 },
  { name: 'RIM',   kind: 'drum', drum: 'rim',   note: 44, gain: 0.46, decay: 0.03, cutoff: 0.90, res: 0.06, drive: 0.00, space: 0.14 },
  { name: 'PERC',  kind: 'drum', drum: 'perc',  note: 53, gain: 0.48, decay: 0.11, cutoff: 0.88, res: 0.10, drive: 0.00, space: 0.34 },
  { name: 'RIDE',  kind: 'drum', drum: 'cym',   note: 51, gain: 0.34, decay: 0.85, cutoff: 0.94, res: 0.04, drive: 0.00, space: 0.38 },

  // ---- low end. Two jobs, split, because one voice cannot do both -----------
  // BASS is the offbeat: it has to stop dead before the next kick or the low
  // end turns to soup, hence sustain 0 and a short release.
  { name: 'BASS',  wave: 'sawtooth', note: 38, gain: 0.60, attack: 0.004, decay: 0.17, sustain: 0.00, release: 0.10,
    cutoff: 0.34, res: 0.38, drive: 0.26, space: 0.05, spread: 0.14 },
  // SUB is the sustained root underneath it. A pure sine, no drive, no reverb —
  // anything you add down here just eats headroom you cannot hear.
  { name: 'SUB',   wave: 'sine',     note: 26, gain: 0.82, attack: 0.012, decay: 0.30, sustain: 0.88, release: 0.18,
    cutoff: 0.22, res: 0.02, drive: 0.00, space: 0.00, spread: 0 },

  // ---- the front. Wide, bright, drenched --------------------------------
  { name: 'LEAD',  wave: 'sawtooth', note: 62, gain: 0.44, attack: 0.02, decay: 0.55, sustain: 0.75, release: 0.60,
    cutoff: 0.80, res: 0.20, drive: 0.18, space: 0.52, spread: 0.80 },
  { name: 'PLUCK', wave: 'sawtooth', note: 57, gain: 0.50, attack: 0.002, decay: 0.20, sustain: 0.00, release: 0.34,
    cutoff: 0.58, res: 0.46, drive: 0.10, space: 0.62, spread: 0.34 },

  // ---- the air. Slow, and allowed to overlap itself ----------------------
  { name: 'PAD',   wave: 'sawtooth', note: 50, gain: 0.32, attack: 0.90, decay: 1.60, sustain: 0.82, release: 3.20,
    cutoff: 0.46, res: 0.10, drive: 0.03, space: 0.85, spread: 0.92 },
  { name: 'BELL',  wave: 'sine',     note: 74, gain: 0.34, attack: 0.002, decay: 1.40, sustain: 0.00, release: 1.60,
    cutoff: 0.90, res: 0.05, drive: 0.00, space: 0.74, spread: 0.10 },
  { name: 'STAB',  wave: 'square',   note: 54, gain: 0.42, attack: 0.004, decay: 0.26, sustain: 0.00, release: 0.36,
    cutoff: 0.64, res: 0.32, drive: 0.16, space: 0.46, spread: 0.30 },
  { name: 'ATMOS', wave: 'triangle', note: 69, gain: 0.28, attack: 1.40, decay: 2.20, sustain: 0.72, release: 4.00,
    cutoff: 0.54, res: 0.16, drive: 0.00, space: 0.95, spread: 0.62 },
];

export function makeVoice(seed = 0) {
  const p = KIT[seed % KIT.length] || {};
  const v = Object.assign({}, VOICE_DEFAULTS, p);
  delete v.name;                     // the name belongs to the cell, not the voice
  return v;
}

export function makeCell(i) {
  const p = KIT[i % KIT.length];
  return {
    id: 'c' + i,
    name: (p && p.name) || ('CELL ' + (i + 1)),
    hue: Math.round((i * 360) / CELLS),
    steps: new Array(STEPS).fill(0),      // 0 = off, 1..127 = velocity
    voice: makeVoice(i),
    mute: false, solo: false,
    level: 0,                             // live meter, written by the engine
  };
}

// Bumped to 2 when the default kit was replaced. loadSong uses it to decide
// whether a stored voice is worth keeping — see the migration there.
export const MODEL_V = 2;

export function makeSong() {
  return {
    v: MODEL_V,
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
    // MIGRATION. A song saved before v2 carries the old generated voices, and
    // merging those over the new kit would hand every returning user the very
    // sounds this version exists to replace — silently, and permanently, since
    // the merged result gets saved straight back. So pre-v2 voices are dropped
    // and the new kit stands. Patterns, names, hues, mutes and tempo are all
    // kept: the notes someone wrote are theirs, the synth presets were ours.
    const keepVoices = (+v.v || 1) >= 2;
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
        // A pre-v2 cell name is one of the old kit's labels, and those labels
        // described nothing — keep the new one so the grid reads true.
        if (typeof c.name === 'string' && keepVoices) dst.name = c.name;
        if (Number.isFinite(+c.hue)) dst.hue = +c.hue;
        if (Array.isArray(c.steps)) for (let k = 0; k < STEPS; k++) dst.steps[k] = +c.steps[k] || 0;
        if (keepVoices && c.voice && typeof c.voice === 'object') Object.assign(dst.voice, c.voice);
        // A sample someone imported and assigned is theirs at any version, so it
        // survives the migration even when the rest of the voice does not.
        else if (c.voice && typeof c.voice.sampleId === 'string') dst.voice.sampleId = c.voice.sampleId;
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
