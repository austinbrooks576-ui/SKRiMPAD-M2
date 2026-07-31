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

  async function store(id, name, arrayBuffer, dur) {
    await tx(db, 'readwrite', (s) => s.put({ id, name, data: arrayBuffer, dur, added: Date.now() }));
  }

  // Decode + register. `keep` is the pristine copy that goes to disk —
  // decodeAudioData DETACHES what it is given, so it must have its own copy.
  async function decode(arrayBuffer, name) {
    initAudio();
    const keep = arrayBuffer.slice(0);
    try {
      const buf = await context().decodeAudioData(arrayBuffer);
      const it = { id: nextId++, name: name || ('sample-' + (items.length + 1)), dur: buf.duration, size: keep.byteLength };
      remember(it.id, buf);
      items.push(it);
      await store(it.id, it.name, keep, it.dur);
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
    try { assigns = JSON.parse(localStorage.getItem(ASSIGN_KEY) || '{}'); } catch (e) { assigns = {}; }
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
      items.push({ id: rec.id, name: rec.name, dur: rec.dur, size: (rec.data && rec.data.byteLength) || 0 });
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
    const rec = { id: nextId++, name: it.name, dur: it.buffer ? it.buffer.duration : 0, size: 0 };
    remember(rec.id, it.buffer);
    items.push(rec);
    onChange && onChange(items);
    return rec;
  }

  return {
    importFiles, assign, preview, stopPreview, touch: () => onChange && onChange(items),
    items: () => items, remove, clearAll, bufferFor, stats, ready, add,
  };
}
