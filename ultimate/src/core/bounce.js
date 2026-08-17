// bounce.js — getting the music out.
//
// You could make something in this app and then have no way to take it
// anywhere. That is a strange gap for a music tool: the whole point of writing
// a loop is to send it to someone, drop it into another project, or just keep
// it. Everything needed to fix it was already here — the tests have been
// rendering voices through an OfflineAudioContext for several rounds to measure
// them, which is the same machinery a bounce needs.
//
// WHY THIS RE-IMPLEMENTS THE SCHEDULE INSTEAD OF REUSING IT.
// The live scheduler is built around wall-clock catch-up: a lazy timer tops up
// a queue against a context that advances in real time. An OfflineAudioContext
// does not advance until you tell it to render, so that loop would never run.
// The SCHEDULE, though — which step lands when, how swing shifts it, which
// cells are silent — is ten lines, and those ten lines are the part that has to
// match. They are written out once here, deliberately close enough to the
// engine's own loop that a change to one is obviously a change to both.

// A canonical 16-bit PCM WAV. Nothing exotic: this file will be opened by a
// phone, a DAW, and whatever a friend has installed, and the boring format is
// the one all three agree on.
export function encodeWav(left, right, rate) {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    // Clamp before scaling. A float that crept past 1.0 would otherwise wrap to
    // full-scale negative — a click at the loudest moment of the bar, which is
    // exactly where nobody wants one.
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    v.setInt16(44 + i * 4, l * 32767, true);
    v.setInt16(46 + i * 4, r * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Render `bars` bars of a scene and hand back a WAV blob.
//
// `makeEngine` is the engine factory, so the bounce uses THE SAME voice code as
// live playback — every drum recipe, the unison, the drive curves, the limiter.
// A bounce that renders through a second implementation is a bounce that sounds
// different from what you heard, which is worse than no bounce at all.
export async function bounceScene({ song, sceneIndex, makeEngine, sampleFor, bars = 4, rate = 44100, tail = 2.5 }) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;

  const scene = song.scenes[sceneIndex] || song.scenes[0];
  const cells = scene.cells;
  const spb = 60 / Math.max(20, Math.min(300, song.bpm)) / 4;   // one sixteenth
  const START = 0.05;
  // The tail is not padding. A PAD releases over 3.2 seconds and the reverb
  // keeps going after that; cutting at the last step would chop the end off
  // every ambient voice in the kit and make the loop sound abruptly gated.
  const length = Math.ceil((START + bars * 16 * spb + tail) * rate);

  const oc = new OAC(2, length, rate);
  const eng = makeEngine({ context: oc, sampleFor });

  const anySolo = cells.some((c) => c.solo);
  for (let bar = 0; bar < bars; bar++) {
    for (let s = 0; s < 16; s++) {
      // Swing delays the off-beats only — the same rule as the live scheduler,
      // and the same reason: applying it to every step just slows the tempo.
      const swung = (s % 2) ? Math.max(0, Math.min(0.6, song.swing || 0)) * spb * 0.6 : 0;
      const t = START + ((bar * 16) + s) * spb + swung;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c.mute || (anySolo && !c.solo)) continue;
        const vel = c.steps[s % c.steps.length];
        // Same pitch rule as the live scheduler. An export that ignored the
        // pitch lane would render a different song from the one you heard,
        // which is the one thing an export must never do.
        if (vel > 0) {
          const semis = (c.notes && c.voice.kind !== 'drum') ? (c.notes[s % c.notes.length] | 0) : 0;
          eng.play(c.voice, t, vel, null, semis);
        }
      }
    }
  }

  const buf = await oc.startRendering();
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  return { blob: encodeWav(L, R, rate), seconds: buf.duration };
}

// Hand the file to whatever the platform uses for files. An <a download> works
// in a browser and in Electron; on Android the WebView routes it through the
// download manager. No File System Access API, no permissions prompt, no path
// for this to fail silently.
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  // Revoking immediately can cancel the download on some builds; a beat later
  // is safe and still frees the memory.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
