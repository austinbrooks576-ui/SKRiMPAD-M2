// snip.js — cutting a sound bite out of a sound.
//
// A sample almost never arrives the length you want it. A one-shot has silence
// in front of it, a loop has a bar and a half of tail, a vocal has the breath
// before the word. Every one of those is a trim, and without one the only
// options are "use it as it is" or "go and edit it somewhere else".
//
// THE RESULT IS A NEW SOUND, NOT A SETTING. A snip goes back into the library
// as its own entry, which means it saves, it survives a restart, it can be
// dropped on a pad, and it can be snipped again. The alternative — storing
// in/out points on the slot — makes the edit invisible everywhere except the
// one place it was made, and means the same trimmed sound has to be re-trimmed
// for every pad you want it on.
//
// FADES ARE NOT OPTIONAL, THEY ARE THE POINT. Cutting a waveform at an
// arbitrary sample leaves a step from whatever the signal was to zero, and a
// step is a click. So even a "no fade" snip gets a couple of milliseconds at
// each end — short enough to leave a transient intact, long enough that the cut
// is not audible as a tick.

// The shortest fade that removes a click. Below about 1ms the ramp is still a
// step as far as the ear is concerned; 2ms is inaudible on a kick's attack and
// reliably silent at the seam.
export const MIN_FADE = 0.002;

export const DEFAULT_EDIT = { start: 0, end: 1, fadeIn: 0, fadeOut: 0.01, gain: 1, reverse: false };

// Where the sound ACTUALLY starts. Most trimming is "take the silence off the
// front", and asking somebody to find that by dragging is asking them to do
// arithmetic the computer is better at.
//
// The threshold is relative to the sample's own peak, not absolute, because a
// quiet recording's noise floor and a loud one's are nothing alike. Backing off
// a few milliseconds keeps the very start of the transient, which is the part
// that makes a drum sound like it was hit.
export function findEdges(buffer, thresh = 0.012) {
  const d = buffer.getChannelData(0), n = d.length;
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  if (peak <= 0) return { start: 0, end: 1 };
  const t = peak * thresh;
  let a = 0, z = n - 1;
  while (a < n && Math.abs(d[a]) < t) a++;
  while (z > a && Math.abs(d[z]) < t) z--;
  const back = Math.round(buffer.sampleRate * 0.003);
  a = Math.max(0, a - back);
  z = Math.min(n - 1, z + back);
  return { start: a / n, end: (z + 1) / n };
}

// Cut, fade, gain, reverse — in that order, because reversing after fading is
// the only way to get a fade-IN on a reversed sound that is where you asked for
// it rather than at the other end.
//
// start/end are FRACTIONS of the source, so an edit made against one sample
// means the same thing against a resampled copy of it. fadeIn/fadeOut are in
// seconds, because a fade is a length of time and a fraction of a long sample
// is a completely different fade from a fraction of a short one.
export function snip(ctx, buffer, edit = {}) {
  const e = Object.assign({}, DEFAULT_EDIT, edit);
  const rate = buffer.sampleRate, chans = buffer.numberOfChannels, n = buffer.length;

  let a = Math.round(Math.max(0, Math.min(1, e.start)) * n);
  let z = Math.round(Math.max(0, Math.min(1, e.end)) * n);
  if (z <= a) z = Math.min(n, a + 1);
  const len = z - a;

  const out = ctx.createBuffer(chans, len, rate);
  // Fades are clamped to HALF the snip each. Two fades longer than the sound
  // between them would overlap and multiply, and the middle of a short snip
  // would come out quieter than both ends — which looks like a bug in the
  // sample rather than in the edit.
  const fi = Math.min(Math.round(Math.max(MIN_FADE, e.fadeIn) * rate), Math.floor(len / 2));
  const fo = Math.min(Math.round(Math.max(MIN_FADE, e.fadeOut) * rate), Math.floor(len / 2));
  const g = Math.max(0, Math.min(4, e.gain));

  for (let c = 0; c < chans; c++) {
    const src = buffer.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      let v = src[a + i] * g;
      if (i < fi) v *= i / fi;
      const back = len - 1 - i;
      if (back < fo) v *= back / fo;
      dst[i] = v;
    }
    if (e.reverse) dst.reverse();
  }
  return out;
}

// A 16-bit PCM WAV. Written here because the snip has to go back through the
// library, and the library takes bytes — the same path a dropped file takes, so
// a snip is stored, listed, cached and reloaded by code that already works
// rather than by a second system that only handles snips.
export function encodeWav(buffer) {
  const chans = buffer.numberOfChannels, n = buffer.length, rate = buffer.sampleRate;
  const bytes = new ArrayBuffer(44 + n * chans * 2);
  const v = new DataView(bytes);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * chans * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, chans, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * chans * 2, true); v.setUint16(32, chans * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * chans * 2, true);

  const data = [];
  for (let c = 0; c < chans; c++) data.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < chans; c++) {
      // Clamp before converting. A float above 1 wraps to a large NEGATIVE
      // sixteen-bit value rather than saturating, so one hot sample becomes a
      // full-scale spike in the opposite direction — the loudest click a
      // computer can make, from a gain setting of 1.1.
      const s = Math.max(-1, Math.min(1, data[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(bytes);
}

// A small waveform, for drawing. Peak per bucket rather than an average,
// because an average of a waveform is roughly zero and draws a flat line.
export function peaks(buffer, buckets = 160) {
  const d = buffer.getChannelData(0), n = d.length;
  const per = Math.max(1, Math.floor(n / buckets));
  const out = new Float32Array(buckets);
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    const a = b * per, z = Math.min(n, a + per);
    for (let i = a; i < z; i++) { const x = Math.abs(d[i]); if (x > m) m = x; }
    out[b] = m;
  }
  return out;
}
