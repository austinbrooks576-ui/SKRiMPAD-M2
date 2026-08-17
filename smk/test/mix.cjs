// mix.cjs — is it too loud, and does it pop?
//
// "the sound is over powering and popping" is a measurement, not an opinion,
// and it has two separate causes that need telling apart:
//
//   OVERPOWERING is level. Too many voices summing past the ceiling, so the
//   limiter stops being a safety net and becomes the sound.
//   POPPING is discontinuity. A waveform that jumps between one sample and the
//   next is a click no matter how quiet the passage is — and the usual cause is
//   an envelope that never reached zero before its voice was cut, or notes
//   piling up because their attack is longer than the gap between them.
//
// So both are measured, separately, on a rendered passage: peak, RMS, the
// number of samples at the ceiling, and the largest sample-to-sample jump.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');
const { chromium } = require('playwright-core');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimmix-'));
const mod = (p) => JSON.stringify(path.join(ROOT, p).split(path.sep).join('/'));
const entry = path.join(TMP, 'entry.js');
fs.writeFileSync(entry, `
import { createEngine } from ${mod('ultimate/src/core/engine.js')};
import { voiceLimits } from ${mod('smk/src/core/mix.js')};
window.P = { createEngine, voiceLimits };
`);
const bundleFile = path.join(TMP, 'bundle.js');
execSync(`npx --yes esbuild "${entry}" --bundle --format=iife --platform=browser --target=es2019 --outfile="${bundleFile}"`,
  { stdio: 'inherit' });
const BUNDLE = fs.readFileSync(bundleFile, 'utf8');

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('about:blank');
  await p.addScriptTag({ content: BUNDLE });

  await p.evaluate(() => {
    window.M = {
      stats(d) {
        let peak = 0, sum = 0, hot = 0, jump = 0;
        for (let i = 0; i < d.length; i++) {
          const a = Math.abs(d[i]);
          if (a > peak) peak = a;
          if (a >= 0.999) hot++;
          sum += d[i] * d[i];
          if (i) { const j = Math.abs(d[i] - d[i - 1]); if (j > jump) jump = j; }
        }
        return { peak, rms: Math.sqrt(sum / d.length), hot, jump,
                 dbfs: 20 * Math.log10(Math.max(1e-9, Math.sqrt(sum / d.length))) };
      },
    };
  });

  const RATE = 44100;

  // A busy but ORDINARY passage: a four-on-the-floor pad part, a held chord,
  // and an arpeggio over the top. Not a stress test — this is what the app is
  // for, and it is the thing that was reported as too loud.
  const busy = await p.evaluate(async ({ RATE }) => {
    const ctx = new OfflineAudioContext(1, RATE * 4, RATE);
    const e = P.createEngine({ context: ctx, preserveLength: true });
    const L = P.voiceLimits;
    const pad = (drum, i) => Object.assign({}, L.pad, { kind: 'drum', drum, note: 36 + i });
    const key = (n) => Object.assign({}, L.key, { kind: 'synth', wave: 'sawtooth', note: n });
    for (let bar = 0; bar < 2; bar++) {
      for (let s = 0; s < 8; s++) {
        const t = bar * 2 + s * 0.25;
        e.play(pad('kick', 0), t, 110);
        if (s % 2 === 1) e.play(pad('hat', 2), t, 70);
        if (s === 4) e.play(pad('snare', 1), t, 100);
      }
      [60, 64, 67, 71].forEach((n) => e.play(key(n), bar * 2, 90));
      // The arpeggio: sixteen notes a bar, which is where voices pile up.
      for (let s = 0; s < 16; s++) {
        e.play(key(60 + [0, 4, 7, 12][s % 4]), bar * 2 + s * 0.125, 100);
      }
    }
    const d = (await ctx.startRendering()).getChannelData(0);
    return M.stats(d);
  }, { RATE });

  console.log('\n  busy passage: peak ' + busy.peak.toFixed(3) + '  rms ' + busy.dbfs.toFixed(1)
              + ' dBFS  clipped ' + busy.hot + '  biggest jump ' + busy.jump.toFixed(3) + '\n');

  ok(busy.hot === 0, 'nothing reaches the digital ceiling', busy.hot + ' samples at or past 1.0');
  ok(busy.peak < 0.95, 'and the peak leaves headroom', busy.peak.toFixed(3));
  // Loud enough to be usable, quiet enough to have dynamics. Anything above
  // about -9 dBFS RMS on a passage like this is a mix with no room left in it —
  // which is what "overpowering" sounds like.
  ok(busy.dbfs < -9, 'the mix is not squashed flat against the limiter', busy.dbfs.toFixed(1) + ' dBFS');
  ok(busy.dbfs > -30, 'and it is not so quiet as to be useless', busy.dbfs.toFixed(1) + ' dBFS');
  // A click is a discontinuity. At 44.1k a musical waveform moves by a small
  // fraction between neighbouring samples; a jump of a third of full scale in
  // one sample is not a sound an instrument makes.
  ok(busy.jump < 0.33, 'and no sample-to-sample jump big enough to be a click',
     busy.jump.toFixed(3));

  // A single note, in isolation, must start and end at silence. This is the
  // other half of popping: a voice that is cut before its envelope reached zero
  // clicks every time it is played, and it is inaudible in a busy passage and
  // obvious when you play one note.
  const one = await p.evaluate(async ({ RATE }) => {
    const ctx = new OfflineAudioContext(1, RATE * 2, RATE);
    const e = P.createEngine({ context: ctx, preserveLength: true });
    const v = Object.assign({}, P.voiceLimits.key, { kind: 'synth', wave: 'sawtooth', note: 60 });
    e.play(v, 0.2, 110);
    const d = (await ctx.startRendering()).getChannelData(0);
    const first = Math.max(...Array.from(d.slice(0, Math.round(0.19 * RATE))).map(Math.abs));
    const last = Math.max(...Array.from(d.slice(Math.round(1.9 * RATE))).map(Math.abs));
    return { first, last, stats: M.stats(d) };
  }, { RATE });
  ok(one.first < 1e-4, 'one note starts from silence rather than clicking in', one.first.toExponential(2));
  ok(one.last < 1e-3, 'and decays to silence rather than being cut off', one.last.toExponential(2));
  ok(one.stats.jump < 0.2, 'with no discontinuity anywhere in it', one.stats.jump.toFixed(3));

  // The arpeggio on its own. Sixteen notes a bar at 120bpm is a note every
  // 125ms — if a voice's ATTACK is longer than that, every note is still
  // rising when the next one starts and they stack instead of articulating.
  // That is the specific way an arpeggiator becomes a wall of sound.
  const arpish = await p.evaluate(async ({ RATE }) => {
    const ctx = new OfflineAudioContext(1, RATE * 3, RATE);
    const e = P.createEngine({ context: ctx, preserveLength: true });
    const L = P.voiceLimits;
    for (let s = 0; s < 24; s++) {
      const v = Object.assign({}, L.arp, { kind: 'synth', wave: 'sawtooth', note: 60 + (s % 4) * 4 });
      e.play(v, 0.1 + s * 0.125, 100);
    }
    const d = (await ctx.startRendering()).getChannelData(0);
    // Does it ARTICULATE? Between notes the level must actually drop. A wall of
    // sound has no troughs.
    let lo = 1, hi = 0;
    for (let k = 0; k < 20; k++) {
      const a = Math.round((0.1 + k * 0.125 + 0.10) * RATE);   // just before the next note
      const z = a + Math.round(0.01 * RATE);
      let m = 0; for (let i = a; i < z; i++) m = Math.max(m, Math.abs(d[i]));
      lo = Math.min(lo, m);
    }
    for (let k = 0; k < 20; k++) {
      const a = Math.round((0.1 + k * 0.125 + 0.01) * RATE);
      const z = a + Math.round(0.01 * RATE);
      let m = 0; for (let i = a; i < z; i++) m = Math.max(m, Math.abs(d[i]));
      hi = Math.max(hi, m);
    }
    return { lo, hi, stats: M.stats(d) };
  }, { RATE });
  console.log('  arpeggio: peak ' + arpish.stats.peak.toFixed(3) + '  note ' + arpish.hi
              + '  gap ' + arpish.lo + '\n');
  ok(arpish.lo < arpish.hi * 0.5, 'an arpeggio ARTICULATES — the level drops between notes',
     'gap ' + arpish.lo.toFixed(3) + ' vs note ' + arpish.hi.toFixed(3));
  ok(arpish.stats.hot === 0 && arpish.stats.peak < 0.95, 'and it does not stack up into a wall',
     'peak ' + arpish.stats.peak.toFixed(3));

  // ---- THE CONTROL: what it used to do ------------------------------------
  // These are the voices the app built before mix.js existed, with every knob
  // at its centre detent — which is where they sit until somebody moves one.
  // They MUST fail the same measurements, or the measurements are not measuring
  // the thing that was reported and every pass above them is decoration.
  const OLD_KEY = { gain: 0.85, attack: 0.302, decay: 0.4, sustain: 0.7, release: 0.76,
                    cutoff: 0.545, res: 0.4, drive: 0.4, space: 0.5, spread: 0.45, pan: 0, tune: 0 };
  const OLD_PAD = { gain: 1.15, attack: 0.001, decay: 0.4, sustain: 0, release: 0.12,
                    cutoff: 0.75, res: 0.25, drive: 0.4, space: 0.3, spread: 0, pan: 0, tune: 0 };
  const before = await p.evaluate(async ({ RATE, OLD_KEY, OLD_PAD }) => {
    const ctx = new OfflineAudioContext(1, RATE * 4, RATE);
    const e = P.createEngine({ context: ctx, preserveLength: true });
    const pad = (drum, i) => Object.assign({}, OLD_PAD, { kind: 'drum', drum, note: 36 + i });
    const key = (n) => Object.assign({}, OLD_KEY, { kind: 'synth', wave: 'sawtooth', note: n });
    for (let bar = 0; bar < 2; bar++) {
      for (let s = 0; s < 8; s++) {
        const t = bar * 2 + s * 0.25;
        e.play(pad('kick', 0), t, 110);
        if (s % 2 === 1) e.play(pad('hat', 2), t, 70);
        if (s === 4) e.play(pad('snare', 1), t, 100);
      }
      [60, 64, 67, 71].forEach((n) => e.play(key(n), bar * 2, 90));
      for (let s = 0; s < 16; s++) e.play(key(60 + [0, 4, 7, 12][s % 4]), bar * 2 + s * 0.125, 100);
    }
    const d = (await ctx.startRendering()).getChannelData(0);
    // ...and the articulation test, on the old arpeggio voice: attack 302ms
    // against a note every 125ms.
    const c2 = new OfflineAudioContext(1, RATE * 3, RATE);
    const e2 = P.createEngine({ context: c2, preserveLength: true });
    for (let s = 0; s < 24; s++) {
      const v = Object.assign({}, OLD_KEY, { kind: 'synth', wave: 'sawtooth', note: 60 + (s % 4) * 4,
                                             decay: 0.09, sustain: 0, release: 0.04 });
      e2.play(v, 0.1 + s * 0.125, 100);
    }
    const d2 = (await c2.startRendering()).getChannelData(0);
    let lo = 1, hi = 0;
    for (let k = 0; k < 20; k++) {
      const a = Math.round((0.1 + k * 0.125 + 0.10) * RATE), z = a + Math.round(0.01 * RATE);
      let m = 0; for (let i = a; i < z; i++) m = Math.max(m, Math.abs(d2[i]));
      lo = Math.min(lo, m);
      const a2 = Math.round((0.1 + k * 0.125 + 0.01) * RATE), z2 = a2 + Math.round(0.01 * RATE);
      let m2 = 0; for (let i = a2; i < z2; i++) m2 = Math.max(m2, Math.abs(d2[i]));
      hi = Math.max(hi, m2);
    }
    return { stats: M.stats(d), lo, hi };
  }, { RATE, OLD_KEY, OLD_PAD });

  console.log('\n  BEFORE: peak ' + before.stats.peak.toFixed(3) + '  rms ' + before.stats.dbfs.toFixed(1)
              + ' dBFS  clipped ' + before.stats.hot
              + '  |  arpeggio gap ' + before.lo.toFixed(3) + ' vs note ' + before.hi.toFixed(3));
  console.log('  AFTER:  peak ' + busy.peak.toFixed(3) + '  rms ' + busy.dbfs.toFixed(1)
              + ' dBFS  clipped ' + busy.hot
              + '  |  arpeggio gap ' + arpish.lo.toFixed(3) + ' vs note ' + arpish.hi.toFixed(3) + '\n');

  ok(before.stats.dbfs > busy.dbfs + 4,
     'CONTROL: the old voices really were far louder — this is what "overpowering" was',
     before.stats.dbfs.toFixed(1) + ' → ' + busy.dbfs.toFixed(1) + ' dBFS');
  ok(before.stats.peak > busy.peak, 'CONTROL: and peaked higher, into the limiter',
     before.stats.peak.toFixed(3) + ' → ' + busy.peak.toFixed(3));
  // WHEN does a note get loud? The old voice's ATTACK sat at 302ms with the
  // knob at its centre, so a note played now reached its peak two and a half
  // sixteenths later — the loudest moment of every note landing nowhere near
  // the moment you played it. It still articulated, because the app overrode
  // decay and release; it just did not articulate WHERE IT WAS PLAYED. That is
  // an attack problem masquerading as a timing problem, and it is why the
  // first version of this control was wrong.
  const rise = await p.evaluate(async ({ RATE, OLD_KEY }) => {
    const peakAt = async (v) => {
      const ctx = new OfflineAudioContext(1, RATE * 2, RATE);
      const e = P.createEngine({ context: ctx, preserveLength: true });
      e.play(Object.assign({ kind: 'synth', wave: 'sawtooth', note: 60 }, v), 0.1, 110);
      const d = (await ctx.startRendering()).getChannelData(0);
      let best = 0, at = 0;
      for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > best) { best = a; at = i; } }
      return at / RATE - 0.1;
    };
    return { old: await peakAt(Object.assign({}, OLD_KEY, { decay: 0.09, sustain: 0, release: 0.04 })),
             now: await peakAt(P.voiceLimits.arp) };
  }, { RATE, OLD_KEY });
  console.log('  time to peak: was ' + (rise.old * 1000).toFixed(0) + 'ms, now '
              + (rise.now * 1000).toFixed(0) + 'ms\n');
  ok(rise.old > 0.12, 'CONTROL: the old note took an age to get loud',
     (rise.old * 1000).toFixed(0) + 'ms after it was played');
  ok(rise.now < 0.03, 'and a plucked note now peaks where you played it',
     (rise.now * 1000).toFixed(0) + 'ms');

  ok(errs.length === 0, 'no page errors', errs.join(' | ') || 'clean');

  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
