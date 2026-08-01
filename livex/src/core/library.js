// library.js — universal sound-file system. Decodes any browser-supported audio
// (WAV/MP3/FLAC/OGG/AIFF/M4A…), imports .zip sample packs (native DecompressionStream,
// no dependency), and assigns a sample to a pad index or key note so the audio
// engine plays it instead of the built-in synth. Drop a file straight onto a pad/key.
//
// MEMORY MODEL — the reason this file is more than a list.
// A decoded AudioBuffer is raw float PCM: one 30-second stereo 44.1k sample is
// about 10 MB in RAM, and a modest pack of them will bog a phone down or push the
// WebView out of memory. So decoded audio is NOT what we keep.
//
//   • ON DISK (IndexedDB) we store the ORIGINAL COMPRESSED BYTES — 10-100x
//     smaller than the decoded form — plus a little metadata. The library
//     therefore survives a restart.
//   • IN MEMORY we keep decoded buffers in an LRU cache under a byte budget.
//     Anything past the budget is dropped and simply re-decoded on next use.
//   • ASSIGNED sounds are PINNED, never evicted: a pad you programmed has to
//     fire instantly, and it must not go silent because you scrolled a big pack.
//   • AT BOOT only metadata is read, so the list appears immediately and nothing
//     is decoded until it is actually played.

import { context, initAudio, setSample } from './audio.js';

const AUDIO_EXT = /\.(wav|mp3|ogg|oga|opus|flac|aif|aiff|aifc|m4a|mp4|aac|weba|webm|wma|caf|au)$/i;

// ---- SOUND TAXONOMY ---------------------------------------------------------
// A flat list of file names is useless once a pack lands — you cannot find the
// kick among 300 items. Every sound is filed into GROUP > KIND from its name
// and, when the name says nothing, from what the audio itself looks like.
// Order matters: the first pattern that matches wins, so specific rules
// ("kick") sit above general ones ("drum").
export const SOUND_GROUPS = ['DRUMS', 'PERCUSSION', 'BASS', 'SYNTH', 'KEYS', 'GUITAR', 'VOCAL', 'FX', 'LOOPS', 'OTHER'];
const KIND_RULES = [
  // DRUMS — the kit
  [/kick|\bbd\b|bassdrum|bass[\s_-]?drum|\b808\b|thump/i, 'DRUMS', 'KICK'],
  [/snare|\bsd\b|rimshot|side[\s_-]?stick|\brim\b/i, 'DRUMS', 'SNARE'],
  [/clap|hand[\s_-]?clap/i, 'DRUMS', 'CLAP'],
  [/hi[\s_-]?hat|hihat|\bhat\b|\bhh\b|closed|open[\s_-]?h/i, 'DRUMS', 'HAT'],
  [/\btom\b|floor[\s_-]?tom|rack[\s_-]?tom|tom[\s_-]?\d/i, 'DRUMS', 'TOM'],
  [/crash|\bride\b|splash|china|cymbal|\bcym\b/i, 'DRUMS', 'CYMBAL'],
  [/\bsnap\b|finger[\s_-]?snap/i, 'DRUMS', 'SNAP'],
  // PERCUSSION — everything else you hit
  [/conga|bongo|djembe|tabla|cajon|timbale|taiko|darbuka/i, 'PERCUSSION', 'HAND DRUM'],
  [/shaker|tambourine|\btamb\b|maraca|cabasa|guiro|cowbell|clave|wood[\s_-]?block|triangle|agogo/i, 'PERCUSSION', 'SHAKER'],
  [/\bperc\b|percussion/i, 'PERCUSSION', 'PERC'],
  // BASS
  [/sub[\s_-]?bass|\bsub\b/i, 'BASS', 'SUB'],
  [/reese|growl|wobble|neuro/i, 'BASS', 'REESE'],
  [/bass|bassline|\bbs\b/i, 'BASS', 'BASS'],
  // SYNTH
  [/pluck|\bplk\b|stab/i, 'SYNTH', 'PLUCK'],
  [/\bpads?\b|warm[\s_-]?pad|atmos|drone/i, 'SYNTH', 'PAD'],
  [/lead|\barp\b|arpeggio|acid/i, 'SYNTH', 'LEAD'],
  [/bells?|chime|glock|celesta|kalimba|music[\s_-]?box/i, 'SYNTH', 'BELL'],
  [/brass|\bhorn\b|trumpet|\bsax\b|trombone/i, 'SYNTH', 'BRASS'],
  [/strings?|violin|cello|orchestra/i, 'SYNTH', 'STRINGS'],
  [/synth|\bsaw\b|square|\bsine\b|\bosc\b/i, 'SYNTH', 'SYNTH'],
  // KEYS
  [/piano|rhodes|wurli|e[\s_-]?piano|\bclav\b|organ|harpsi/i, 'KEYS', 'KEYS'],
  // GUITAR
  [/guitar|\bgtr\b|acoustic|strum|\briff\b/i, 'GUITAR', 'GUITAR'],
  // VOCAL
  [/\bvox\b|vocal|voice|acap|chant|choir|adlib|spoken/i, 'VOCAL', 'VOCAL'],
  // FX
  [/riser|uplifter|downlifter|sweep|whoosh|impact|\bboom\b|braam|siren|noise|foley|ambien|texture/i, 'FX', 'FX'],
  [/reverse|\brev\b/i, 'FX', 'REVERSE'],
  // LOOPS
  [/\bloop\b|\bbeat\b|groove|break/i, 'LOOPS', 'LOOP'],
  [/melody|melodic|chords?|progression/i, 'LOOPS', 'MELODIC'],
  // last resort for anything that only says "drum"
  [/drums?|\bkit\b/i, 'DRUMS', 'DRUM'],
];

// Classify from the name, falling back to the AUDIO ITSELF when the name says
// nothing ("sample-3.wav", "01.wav") — length and brightness tell you a great
// deal about whether something is a kick, a hat, or a pad.
export function classifySound(name, buffer) {
  const n = String(name || '');
  for (const [re, group, kind] of KIND_RULES) if (re.test(n)) return { group, kind };
  if (buffer) return classifyByAudio(buffer);
  return { group: 'OTHER', kind: 'SAMPLE' };
}

function classifyByAudio(buf) {
  const dur = buf.duration;
  const d = buf.getChannelData(0);
  const n = d.length;
  // Zero-crossing rate separates bright noise (hats, snares) from low tonal
  // content (kicks, bass) without the cost of an FFT.
  let zc = 0, peak = 0, energy = 0, samples = 0;
  const step = Math.max(1, Math.floor(n / 40000));
  for (let i = step; i < n; i += step) {
    const a = d[i - step], b = d[i];
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) zc++;
    const abs = Math.abs(b);
    if (abs > peak) peak = abs;
    energy += abs; samples++;
  }
  const zcr = samples ? zc / samples : 0;
  const avg = samples ? energy / samples : 0;
  const sustained = avg > peak * 0.18;          // stays loud = held, not a hit

  if (dur > 4) return { group: 'LOOPS', kind: 'LOOP' };
  if (dur > 1.2 && sustained) return { group: 'SYNTH', kind: zcr > 0.22 ? 'PAD' : 'BASS' };
  if (dur <= 0.22 && zcr > 0.30) return { group: 'DRUMS', kind: 'HAT' };
  if (dur <= 0.50 && zcr > 0.18) return { group: 'DRUMS', kind: 'SNARE' };
  if (dur <= 0.90 && zcr < 0.08) return { group: 'DRUMS', kind: 'KICK' };
  if (dur <= 1.20) return { group: 'PERCUSSION', kind: 'PERC' };
  return { group: 'OTHER', kind: 'SAMPLE' };
}
const DB_NAME = 'skrimpad-livex-library';
const STORE = 'sounds';
const ASSIGN_KEY = 'skrimpad_livex_assigns';
// Decoded-audio budget. Generous enough that a normal kit never re-decodes,
// small enough that a 500-sample pack cannot exhaust a phone.
const MEM_BUDGET = 96 * 1024 * 1024;

// ---- IndexedDB (tiny promise wrapper; no dependency) -----------------------
function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);      // no storage → stay in-memory, still works
  });
}
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    let t;
    try { t = db.transaction(STORE, mode); } catch (e) { return resolve(null); }
    const store = t.objectStore(STORE);
    let out = null;
    try { out = fn(store); } catch (e) { return resolve(null); }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => resolve(null);
    t.onabort = () => resolve(null);
  });
}

export function createLibrary({ onChange } = {}) {
  const items = [];                 // { id, name, dur, size, buffer? }
  const cache = new Map();          // id -> AudioBuffer   (LRU: Map keeps insertion order)
  const pinned = new Set();         // ids currently assigned to a pad/key
  let cacheBytes = 0;
  let db = null;
  let nextId = 1;

  const bytesOf = (buf) => (buf ? buf.length * buf.numberOfChannels * 4 : 0);

  function evictIfNeeded() {
    if (cacheBytes <= MEM_BUDGET) return;
    for (const [id, buf] of cache) {
      if (cacheBytes <= MEM_BUDGET) break;
      if (pinned.has(id)) continue;             // never drop a programmed sound
      cache.delete(id);
      cacheBytes -= bytesOf(buf);
    }
  }
  function remember(id, buf) {
    if (!buf) return buf;
    if (cache.has(id)) { cache.delete(id); cacheBytes -= bytesOf(cache.get(id)); }
    cache.set(id, buf); cacheBytes += bytesOf(buf);
    evictIfNeeded();
    return buf;
  }

  // Decoded audio for an item, from cache or re-decoded from the stored bytes.
  // Touching an entry moves it to the fresh end of the LRU.
  async function bufferFor(item) {
    if (!item) return null;
    if (cache.has(item.id)) {
      const b = cache.get(item.id);
      cache.delete(item.id); cache.set(item.id, b);   // mark as recently used
      return b;
    }
    const rec = await tx(db, 'readonly', (s) => s.get(item.id));
    const data = rec && rec.data;
    if (!data) return null;
    try {
      initAudio();
      const buf = await context().decodeAudioData(data.slice(0));
      return remember(item.id, buf);
    } catch (e) { return null; }
  }

  async function store(id, name, arrayBuffer, dur, cls) {
    await tx(db, 'readwrite', (s) => s.put({
      id, name, data: arrayBuffer, dur, added: Date.now(),
      group: cls && cls.group, kind: cls && cls.kind,
    }));
  }

  // Decode + register. `keep` is the pristine copy that goes to disk —
  // decodeAudioData DETACHES what it is given, so it must have its own copy.
  async function decode(arrayBuffer, name) {
    initAudio();
    const keep = arrayBuffer.slice(0);
    try {
      const buf = await context().decodeAudioData(arrayBuffer);
      const nm = name || ('sample-' + (items.length + 1));
      // File it on the way in — from the name, or from the audio when the name
      // is uninformative. Classifying once at import keeps browsing instant.
      const cls = classifySound(nm, buf);
      const it = { id: nextId++, name: nm, dur: buf.duration, size: keep.byteLength, group: cls.group, kind: cls.kind };
      remember(it.id, buf);
      items.push(it);
      await store(it.id, it.name, keep, it.dur, cls);
      onChange && onChange(items);
      return it;
    } catch (e) { console.warn('[library] could not decode', name, e && e.message); return null; }
  }

  async function inflateRaw(u8) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function importZip(ab) {
    const dv = new DataView(ab), u8 = new Uint8Array(ab), added = [];
    let eo = -1;
    for (let i = ab.byteLength - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; } }
    if (eo < 0) return added;
    const count = dv.getUint16(eo + 10, true);
    let p = dv.getUint32(eo + 16, true);
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (!AUDIO_EXT.test(name)) continue;
      const lNameLen = dv.getUint16(lho + 26, true), lExtra = dv.getUint16(lho + 28, true);
      const dataStart = lho + 30 + lNameLen + lExtra;
      const comp = u8.subarray(dataStart, dataStart + compSize);
      let raw;
      if (method === 0) raw = comp;
      else if (method === 8) raw = await inflateRaw(comp);
      else continue;
      const copy = raw.slice().buffer; // detached ArrayBuffer for decodeAudioData
      const it = await decode(copy, name.split('/').pop());
      if (it) added.push(it);
    }
    return added;
  }

  async function importFiles(fileList) {
    const added = [];
    for (const f of Array.from(fileList)) {
      const lower = (f.name || '').toLowerCase();
      if (lower.endsWith('.zip')) added.push(...await importZip(await f.arrayBuffer()));
      else if (AUDIO_EXT.test(lower) || (f.type || '').startsWith('audio')) {
        const it = await decode(await f.arrayBuffer(), f.name); if (it) added.push(it);
      }
    }
    return added;
  }

  // ---- assignments ---------------------------------------------------------
  // Which sound sits on which pad/key, remembered across restarts so a kit you
  // programmed is still there next launch.
  let assigns = {};                 // "pad:3" -> item id
  function saveAssigns() {
    try { localStorage.setItem(ASSIGN_KEY, JSON.stringify(assigns)); } catch (e) {}
  }
  async function assign(item, role, id) {
    if (!item) return;
    const buf = await bufferFor(item);
    if (!buf) return;
    pinned.add(item.id);            // a programmed sound must never be evicted
    setSample(role, id, buf);
    assigns[role + ':' + id] = item.id;
    saveAssigns();
    onChange && onChange(items);
  }
  // Re-apply saved assignments after a restart. Only these buffers are decoded
  // at boot — the rest of the library stays on disk until it is played.
  async function restoreAssigns() {
    // The `|| '{}'` only covers a MISSING value. A stored "null" or "[1,2]"
    // parses fine and escapes the catch, leaving `assigns` as something that is
    // not a record — `for..in` then either does nothing or walks array indices.
    // Nothing observed crashes on that today; every write below still assumes a
    // plain object, so pin the shape here rather than depend on luck.
    try {
      const v = JSON.parse(localStorage.getItem(ASSIGN_KEY));
      assigns = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch (e) { assigns = {}; }
    for (const key in assigns) {
      const it = items.find((x) => x.id === assigns[key]);
      if (!it) { delete assigns[key]; continue; }
      const buf = await bufferFor(it);
      if (!buf) continue;
      pinned.add(it.id);
      const [role, id] = key.split(':');
      setSample(role, isNaN(+id) ? id : +id, buf);
    }
    saveAssigns();
    onChange && onChange(items);
  }

  // ---- audition ------------------------------------------------------------
  // Play a sound where it stands, so you can hear what you are about to load.
  let auditionSrc = null;
  async function preview(item) {
    const buf = await bufferFor(item);
    if (!buf) return false;
    initAudio();
    const ctx = context();
    try { if (auditionSrc) auditionSrc.stop(); } catch (e) {}
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = 0.9;
    src.buffer = buf;
    src.connect(g); g.connect(ctx.destination);
    src.start();
    auditionSrc = src;
    src.onended = () => { if (auditionSrc === src) auditionSrc = null; };
    return true;
  }
  function stopPreview() { try { if (auditionSrc) auditionSrc.stop(); } catch (e) {} auditionSrc = null; }

  async function remove(item) {
    const i = items.indexOf(item);
    if (i < 0) return;
    items.splice(i, 1);
    if (cache.has(item.id)) { cacheBytes -= bytesOf(cache.get(item.id)); cache.delete(item.id); }
    pinned.delete(item.id);
    for (const k in assigns) if (assigns[k] === item.id) delete assigns[k];
    saveAssigns();
    await tx(db, 'readwrite', (s) => s.delete(item.id));
    onChange && onChange(items);
  }

  async function clearAll() {
    items.length = 0; cache.clear(); pinned.clear(); cacheBytes = 0; assigns = {};
    saveAssigns();
    await tx(db, 'readwrite', (s) => s.clear());
    onChange && onChange(items);
  }

  // ---- boot ----------------------------------------------------------------
  // Metadata only. The list is on screen immediately and nothing is decoded
  // until it is played, so a large library costs nothing at launch.
  const ready = (async () => {
    db = await openDB();
    const all = await new Promise((resolve) => {
      if (!db) return resolve([]);
      let t;
      try { t = db.transaction(STORE, 'readonly'); } catch (e) { return resolve([]); }
      const req = t.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    all.sort((a, b) => (a.added || 0) - (b.added || 0));
    for (const rec of all) {
      // Older records predate the taxonomy — classify them by name on the way
      // in so an existing library sorts itself the first time this build runs.
      const cls = rec.group ? { group: rec.group, kind: rec.kind } : classifySound(rec.name, null);
      items.push({
        id: rec.id, name: rec.name, dur: rec.dur,
        size: (rec.data && rec.data.byteLength) || 0,
        group: cls.group, kind: cls.kind,
      });
      if (rec.id >= nextId) nextId = rec.id + 1;
    }
    onChange && onChange(items);
    await restoreAssigns();
    return items;
  })();

  const stats = () => ({
    count: items.length,
    decoded: cache.size,
    pinned: pinned.size,
    memMB: +(cacheBytes / 1048576).toFixed(1),
    budgetMB: MEM_BUDGET / 1048576,
  });

  // `add` accepts an already-decoded { name, buffer } — used by tests and by any
  // caller that has audio in hand rather than a file.
  async function add(it) {
    const cls = classifySound(it.name, it.buffer);
    const rec = { id: nextId++, name: it.name, dur: it.buffer ? it.buffer.duration : 0, size: 0, group: cls.group, kind: cls.kind };
    remember(rec.id, it.buffer);
    items.push(rec);
    onChange && onChange(items);
    return rec;
  }

  return {
    importFiles, assign, preview, stopPreview, touch: () => onChange && onChange(items),
    items: () => items, remove, clearAll, bufferFor, stats, ready, add,
    classify: classifySound, groups: SOUND_GROUPS,
    // items filed under GROUP > KIND, groups in a fixed musical order and only
    // those that actually contain something
    grouped() {
      const by = new Map();
      for (const it of items) {
        const g = it.group || 'OTHER';
        if (!by.has(g)) by.set(g, new Map());
        const k = it.kind || 'SAMPLE';
        const kg = by.get(g);
        if (!kg.has(k)) kg.set(k, []);
        kg.get(k).push(it);
      }
      return SOUND_GROUPS.filter((g) => by.has(g)).map((g) => ({ group: g, kinds: by.get(g) }));
    },
  };
}
