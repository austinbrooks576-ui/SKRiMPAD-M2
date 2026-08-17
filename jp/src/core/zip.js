// zip.js — sample packs, unpacked in the browser with no library.
//
// A ZIP central directory is about forty lines to read, and DecompressionStream
// does the actual inflating, which every target here has had for years. So this
// costs nothing and pulls in nothing — which matters for an app that ships as
// one self-contained HTML file inside an APK.
//
// PROMOTED FROM M2, where it lived inline in an eight-thousand-line file and
// was the best thing in it. Three fixes came with the move, all of them found
// by the tests in this edition:
//   · ZIP64 is detected and refused with a sentence, rather than reading a
//     0xFFFFFFFF offset as a real one and producing garbage
//   · the end-of-central-directory scan no longer stops at the first 'PK\5\6'
//     it finds, which can appear inside a compressed file
//   · a stored (uncompressed) entry with a data descriptor is handled

const AUDIO_EXT = /\.(wav|mp3|ogg|oga|flac|m4a|aac|aiff?|opus|weba|webm|caf|wv)$/i;
// Anything obviously not audio. The list is deliberately short: the DECODER is
// the final judge, because sample packs are full of files with no extension,
// with the wrong extension, and with extensions nobody has heard of.
const NON_AUDIO = /\.(txt|pdf|jpe?g|png|gif|bmp|webp|svg|doc[x]?|rtf|html?|css|js|json|xml|md|nfo|url|exe|dll|dmg|zip|rar|7z|fxp|fst|adg|nki|sfz|mid|midi)$/i;
const JUNK = /(^|\/)__MACOSX\/|(^|\/)\._|\.DS_Store$|(^|\/)Thumbs\.db$/i;

export function zipParse(ab) {
  const dv = new DataView(ab);
  const n = ab.byteLength;
  if (n < 22) throw new Error('That file is too small to be a ZIP');

  // Scan BACKWARDS for the end-of-central-directory record and keep looking
  // until one whose own fields are self-consistent. The signature can occur by
  // chance inside compressed data, and taking the first hit reads a random
  // offset as the directory — which produced "not a valid ZIP" on perfectly
  // good packs.
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 65558); i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue;
    const cmLen = dv.getUint16(i + 20, true);
    if (i + 22 + cmLen !== n) continue;                 // comment length must fit exactly
    const off = dv.getUint32(i + 16, true);
    if (off < n && dv.getUint32(off, true) === 0x02014b50) { eocd = i; break; }
    if (eocd < 0) eocd = i;                             // remember the first as a fallback
  }
  if (eocd < 0) throw new Error('That is not a ZIP file');

  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  // 0xFFFFFFFF in the offset or 0xFFFF in the count means ZIP64, whose real
  // values live in a different record entirely. Reading these as literal
  // numbers walks off the end of the buffer and produces nonsense entries.
  if (off === 0xffffffff || count === 0xffff) {
    throw new Error('That pack is in ZIP64 format — re-zip it, or drop the audio files in directly');
  }

  const entries = [];
  for (let k = 0; k < count; k++) {
    if (off + 46 > n || dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const usize = dv.getUint32(off + 24, true);
    const fnLen = dv.getUint16(off + 28, true);
    const exLen = dv.getUint16(off + 30, true);
    const cmLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(ab, off + 46, fnLen));
    if (csize > 0 && lho + 30 <= n) {
      const lfn = dv.getUint16(lho + 26, true), lex = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lfn + lex;
      if (start + csize <= n) entries.push({ name, method, csize, usize, dataStart: start });
    }
    off += 46 + fnLen + exLen + cmLen;
  }
  return entries;
}

export async function zipInflate(ab, e) {
  const slice = ab.slice(e.dataStart, e.dataStart + e.csize);
  if (e.method === 0) return slice;                     // stored
  if (e.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('no inflate here');
    return await new Response(
      new Blob([slice]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    ).arrayBuffer();
  }
  throw new Error('unsupported compression');
}

// Which entries are worth trying. Universal acceptance: take anything that is
// not obviously non-audio and not junk, and let the decoder be the judge. Sample
// packs are full of extensionless files and misnamed ones, and refusing them on
// the name is how an import quietly loses half a pack.
export function candidates(entries) {
  return (entries || []).filter((e) =>
    !/\/$/.test(e.name) && !JUNK.test(e.name) &&
    (AUDIO_EXT.test(e.name) || !NON_AUDIO.test(e.name)));
}

// Turn "VENDOR PACK - Drums - Kick Heavy 01 - C - 140bpm.wav" into "Kick Heavy 01".
// A pack's filenames carry the vendor's name, the key and the tempo, and none of
// those help you find a kick at two in the morning.
const KEYISH = /^[A-G](#|b)?(m|min|maj|major|minor)?\d?$/i;
const BPMISH = /^\d{2,3}\s?bpm$/i;
const LAYERISH = /^(v\d+|\d+k|\d+bit)$/i;

// A bare number is only a TEMPO if it looks like one. `\\d{2,3}` used to swallow
// everything, which quietly renamed "Kick Heavy 01", "Kick Heavy 02" and "Kick
// Heavy 03" all to "Kick Heavy" - three identical rows in the library with no
// way to tell which was which. A take number has a leading zero or is small; a
// tempo has neither.
function isMarker(w) {
  const s = String(w || '').trim();
  if (!s) return false;
  if (KEYISH.test(s) || BPMISH.test(s) || LAYERISH.test(s)) return true;
  if (!/^\d{2,3}$/.test(s)) return false;
  if (s[0] === '0') return false;                       // 01, 02 - a take, not a tempo
  const n = +s;
  return n >= 60 && n <= 200;                           // the range music is actually in
}
const MARKER = { test: isMarker };

// The instrument words a sample name is actually FOR. Everything before the
// first of these is the vendor, the pack, and the folder they filed it in —
// none of which help you find a kick at two in the morning.
const INSTR = /\b(kick|bd|bass ?drum|808|snare|sd|rim|clap|snap|hat|hh|hi-?hat|open ?hat|closed ?hat|crash|ride|cym|tom|perc|shaker|tamb|conga|bongo|cowbell|block|bass|sub|reese|lead|pluck|stab|chord|pad|string|brass|horn|key|piano|rhodes|organ|bell|arp|vox|vocal|chant|choir|fx|riser|impact|sweep|noise|drone|atmos|texture|loop|break|fill|roll|snip|one ?shot)\b/i;

export function cleanName(raw) {
  const base = String(raw || '').split('/').pop().replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  let segs = base.split(/\s*[-–]\s*/).map((x) => x.trim()).filter(Boolean);

  // Trailing key and tempo segments: "… - C - 140bpm".
  while (segs.length > 1 && MARKER.test(segs[segs.length - 1])) segs.pop();
  // And the same markers hiding at the end of the last segment: "Kick 140bpm".
  segs = segs.map((s) => {
    const w = s.split(/\s+/);
    while (w.length > 1 && MARKER.test(w[w.length - 1])) w.pop();
    return w.join(' ');
  });

  // Cut at the EARLIEST segment that names an instrument. Scanning from the
  // front rather than the back is what keeps "Kick - Heavy" whole while still
  // reducing "MYVENDOR PACK - Drums - Kick Heavy 01" to its last two words —
  // scanning from the back would take "Heavy" and throw the kick away.
  const at = segs.findIndex((sg) => INSTR.test(sg));
  if (at > 0) segs = segs.slice(at);
  else if (at < 0 && segs.length > 2) segs = segs.slice(-1);   // no keyword: assume folders

  // The vendor's name can also be glued to the front of the segment itself:
  // "MYVENDOR Kick Heavy" — drop everything before the instrument word.
  if (segs.length) {
    const w = segs[0].split(/\s+/);
    const wi = w.findIndex((x) => INSTR.test(x));
    if (wi > 0) segs[0] = w.slice(wi).join(' ');
  }
  return segs.join(' - ').trim() || base;
}

// Unpack a pack into the library, one file at a time.
//
// ONE AT A TIME AND YIELDING, deliberately. A 400-file pack decoded in a tight
// loop holds every decoded buffer alive at once — hundreds of megabytes of PCM
// — and freezes the WebView while it does it. On a phone that is not slow, it
// is a crash. Yielding every few files keeps the app alive and lets the
// collector run, and the budget stops before the tab dies rather than after.
export async function importZip(ab, { addBuffer, onProgress, packName } = {}) {
  const entries = zipParse(ab);
  const list = candidates(entries).slice(0, 400);
  if (!list.length) return { ok: 0, bad: 0, reason: 'no audio files inside that pack' };

  const MEM_BUDGET = 380 * 1024 * 1024;
  let ok = 0, bad = 0, mem = 0, stopped = false;

  for (let i = 0; i < list.length; i++) {
    if (mem > MEM_BUDGET) { stopped = true; break; }
    const e = list[i];
    try {
      const data = await zipInflate(ab, e);
      const added = await addBuffer(cleanName(e.name), data, packName);
      if (added) {
        ok++;
        mem += (e.usize || e.csize) * 6;   // rough PCM cost of the compressed bytes
      } else bad++;
    } catch (err) {
      if (AUDIO_EXT.test(e.name)) bad++;
    }
    if ((i & 3) === 3) {
      onProgress && onProgress(ok, list.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress && onProgress(ok, list.length);
  return { ok, bad, stopped, total: list.length };
}

export const isZip = (f) =>
  /\.zip$/i.test(f && f.name || '') || (f && f.type === 'application/zip');
