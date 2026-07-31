// library.js — universal sound-file system. Decodes any browser-supported audio
// (WAV/MP3/FLAC/OGG/AIFF/M4A…), imports .zip sample packs (native DecompressionStream,
// no dependency), and assigns a sample to a pad index or key note so the audio
// engine plays it instead of the built-in synth. Drop a file straight onto a pad/key.

import { context, initAudio, setSample } from './audio.js';

const AUDIO_EXT = /\.(wav|mp3|ogg|oga|opus|flac|aif|aiff|aifc|m4a|mp4|aac|weba|webm|wma|caf|au)$/i;

export function createLibrary({ onChange } = {}) {
  const items = []; // { name, buffer }

  async function decode(arrayBuffer, name) {
    initAudio();
    try {
      const buf = await context().decodeAudioData(arrayBuffer);
      const it = { name: name || ('sample-' + (items.length + 1)), buffer: buf };
      items.push(it); onChange && onChange(items);
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

  // assign a library item to a target: {role:'pad'|'key', id: index|note}
  function assign(item, role, id) { if (item && item.buffer) { setSample(role, id, item.buffer); onChange && onChange(items); } }

  // re-emit the current list (selection highlight, etc.) without re-importing
  function touch() { onChange && onChange(items); }

  return { importFiles, assign, touch, items: () => items };
}
