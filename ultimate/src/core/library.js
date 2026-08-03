// library.js — sounds you brought, kept without bogging the app down.
//
// THE MEMORY PROBLEM, AND WHY THIS FILE IS NOT JUST AN ARRAY.
// A decoded AudioBuffer is raw float PCM. One 30-second stereo 44.1k sample is
// about 10 MB in RAM. A modest pack of 40 is 400 MB, which does not merely make
// a phone slow — the WebView is killed outright. So decoded audio is NOT what
// we keep.
//
//   ON DISK  we store the ORIGINAL COMPRESSED BYTES (10-100x smaller) plus a
//            little metadata, in IndexedDB. The library survives a restart.
//   IN RAM   decoded buffers live in an LRU under a hard byte budget. Anything
//            past the budget is dropped and simply re-decoded when next played.
//   PINNED   a sample assigned to a cell is never evicted. A pad you programmed
//            has to fire instantly, and it must not go silent because you
//            scrolled a big pack.
//   AT BOOT  only metadata is read, so the list appears at once and nothing is
//            decoded until it is actually needed.
//
// The whole point: importing 300 sounds should cost the same at rest as
// importing three.

const DB = 'skrimpad_ultimate_lib';
const STORE = 'sounds';
const BUDGET = 96 * 1024 * 1024;

const AUDIO_RE = /\.(wav|mp3|ogg|oga|opus|flac|aif|aiff|aifc|m4a|mp4|aac|weba|webm|caf|au)$/i;

// A name is the only clue most packs give you. These are ordered: the first
// match wins, so specific rules ("kick") must sit above general ones ("drum").
const KINDS = [
  [/kick|\bbd\b|bassdrum|\b808\b|boom/i, 'KICK'],
  [/snare|\bsd\b|rim(shot)?/i, 'SNARE'],
  [/clap|hand ?clap/i, 'CLAP'],
  [/hi.?hat|hihat|\bhh\b|\bhat\b/i, 'HAT'],
  [/\btom\b|floor.?tom/i, 'TOM'],
  [/crash|ride|splash|china|cymbal|\bcym\b/i, 'CYMBAL'],
  [/shaker|tamb|conga|bongo|perc|cowbell|clave|block/i, 'PERC'],
  [/sub|\b808 ?bass\b/i, 'SUB'],
  [/bass|reese|wobble/i, 'BASS'],
  [/pad|atmos|drone|choir/i, 'PAD'],
  [/pluck|stab|chord/i, 'PLUCK'],
  [/lead|arp|acid|saw/i, 'LEAD'],
  [/bell|chime|glock|kalimba/i, 'BELL'],
  [/key|piano|rhodes|organ|wurli/i, 'KEYS'],
  [/vox|vocal|voice|acap|chant/i, 'VOCAL'],
  [/riser|sweep|whoosh|impact|fx|noise|foley/i, 'FX'],
  [/loop|beat|groove|break/i, 'LOOP'],
];

export function classify(name, buffer) {
  const n = String(name || '');
  for (const [re, kind] of KINDS) if (re.test(n)) return kind;
  // The name said nothing ("sample-3.wav", "01.wav"). Length and brightness say
  // a great deal on their own, and a zero-crossing count gets there without the
  // cost of an FFT.
  if (!buffer) return 'SAMPLE';
  const d = buffer.getChannelData(0), n2 = d.length;
  const step = Math.max(1, Math.floor(n2 / 30000));
  let zc = 0, peak = 0, energy = 0, count = 0;
  for (let i = step; i < n2; i += step) {
    if ((d[i - step] < 0) !== (d[i] < 0)) zc++;
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    energy += a; count++;
  }
  const zcr = count ? zc / count : 0;
  const sustained = count && (energy / count) > peak * 0.18;
  const dur = buffer.duration;
  if (dur > 4) return 'LOOP';
  if (dur > 1.2 && sustained) return zcr > 0.22 ? 'PAD' : 'BASS';
  if (dur <= 0.22 && zcr > 0.30) return 'HAT';
  if (dur <= 0.50 && zcr > 0.18) return 'SNARE';
  if (dur <= 0.90 && zcr < 0.08) return 'KICK';
  return 'PERC';
}

function openDB() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    // No storage is not a failure — the library just becomes session-only and
    // everything else still works.
    req.onerror = () => resolve(null);
  });
}
function tx(db, mode, fn) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    let t;
    try { t = db.transaction(STORE, mode); } catch (e) { return resolve(null); }
    let out = null;
    try { out = fn(t.objectStore(STORE)); } catch (e) { return resolve(null); }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = t.onabort = () => resolve(null);
  });
}

export function createLibrary({ ctx, onChange } = {}) {
  const items = [];                 // { id, name, kind, dur, size }
  const cache = new Map();          // id -> AudioBuffer   (Map keeps insertion order = LRU)
  const pinned = new Set();
  let bytes = 0, db = null, nextId = 1;

  const sizeOf = (b) => (b ? b.length * b.numberOfChannels * 4 : 0);

  function evict() {
    if (bytes <= BUDGET) return;
    for (const [id, buf] of cache) {
      if (pinned.has(id)) continue;      // an assigned pad must never go silent
      cache.delete(id); bytes -= sizeOf(buf);
      if (bytes <= BUDGET * 0.8) break;
    }
  }

  async function boot() {
    db = await openDB();
    const rows = await tx(db, 'readonly', (s) => s.getAll());
    (rows || []).forEach((r) => {
      items.push({ id: r.id, name: r.name, kind: r.kind, dur: r.dur, size: r.size });
      const n = +String(r.id).replace(/\D/g, '');
      if (n >= nextId) nextId = n + 1;
    });
    items.sort((a, b) => a.name.localeCompare(b.name));
    onChange && onChange(items);
    return items;
  }

  // Decode on demand, cache the result, and keep the ORIGINAL bytes on disk so
  // a cache miss costs a decode rather than a re-import.
  async function bufferFor(id) {
    if (cache.has(id)) {
      const b = cache.get(id);           // touch = move to the end of the LRU
      cache.delete(id); cache.set(id, b);
      return b;
    }
    const row = await tx(db, 'readonly', (s) => s.get(id));
    if (!row || !row.bytes) return null;
    try {
      // decodeAudioData detaches the buffer it is given, so hand it a copy or
      // the stored bytes become unusable for every future decode.
      const buf = await ctx().decodeAudioData(row.bytes.slice(0));
      cache.set(id, buf); bytes += sizeOf(buf); evict();
      return buf;
    } catch (e) { return null; }
  }

  async function add(file) {
    if (!file) return null;
    const name = file.name || ('sound ' + nextId);
    if (!AUDIO_RE.test(name) && !/^audio\//.test(file.type || '')) return null;
    const raw = await file.arrayBuffer();
    let buf = null;
    try { buf = await ctx().decodeAudioData(raw.slice(0)); } catch (e) { return null; }
    const id = 'sx' + (nextId++);
    const rec = {
      id, name: name.replace(/\.[^.]+$/, ''), kind: classify(name, buf),
      dur: +buf.duration.toFixed(3), size: raw.byteLength, bytes: raw,
    };
    await tx(db, 'readwrite', (s) => s.put(rec));
    const meta = { id: rec.id, name: rec.name, kind: rec.kind, dur: rec.dur, size: rec.size };
    items.push(meta);
    cache.set(id, buf); bytes += sizeOf(buf); evict();
    if (!batching) settle();
    return meta;
  }

  // Sort the array and redraw the list ONCE per batch, not once per file.
  // Importing 120 sounds used to re-sort the whole array and rebuild the whole
  // DOM list 120 times — quadratic work for intermediate states nobody sees,
  // since each is replaced within milliseconds. A 500-sound pack is a normal
  // thing to own, and that is where quadratic stops being merely wasteful.
  let batching = false;
  function settle() {
    items.sort((a, b) => a.name.localeCompare(b.name));
    onChange && onChange(items);
  }

  async function addFiles(list) {
    const out = [];
    const files = Array.from(list || []);
    batching = true;
    try {
      for (const f of files) {
        const m = await add(f);
        if (m) out.push(m);
      }
    } finally {
      // finally, not after the loop: one file throwing must not leave the
      // library permanently in batch mode with a list that never redraws again.
      batching = false;
      settle();
    }
    return out;
  }

  async function remove(id) {
    await tx(db, 'readwrite', (s) => s.delete(id));
    const i = items.findIndex((x) => x.id === id);
    if (i >= 0) items.splice(i, 1);
    if (cache.has(id)) { bytes -= sizeOf(cache.get(id)); cache.delete(id); }
    pinned.delete(id);
    onChange && onChange(items);
  }

  return {
    boot, add, addFiles, remove, bufferFor,
    get items() { return items.slice(); },
    find: (id) => items.find((x) => x.id === id) || null,
    pin(id) { if (id) pinned.add(id); },
    unpin(id) { pinned.delete(id); },
    // Re-pin from scratch after any assignment change, so a sample that is no
    // longer on any cell becomes evictable again instead of leaking.
    repin(ids) { pinned.clear(); (ids || []).forEach((i) => i && pinned.add(i)); },
    stats() { return { count: items.length, ram: Math.round(bytes / 1048576) + 'MB', cached: cache.size }; },
  };
}
