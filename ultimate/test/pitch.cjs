// pitch.cjs — does an octave change the note WITHOUT changing the length?
//
// This is the one claim that cannot be checked by looking at the screen, so it
// is checked by rendering audio offline and measuring it. Every assertion here
// is a number taken out of a rendered buffer, not a call that returned without
// throwing.
//
// The controls matter as much as the tests. A pitch-shift suite that only ever
// measures the shifter can pass while measuring nothing — so the same
// measurements are run against the OLD behaviour (playbackRate) and are
// required to FAIL in the specific way that motivated this work. If the control
// ever stops failing, the measurement has gone blind and every pass below is
// worthless.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimpitch-'));

// Bundle the REAL modules — not a copy, not a re-implementation. If pitch.js
// and engine.js stop agreeing with each other this fails at build time.
//
// The paths are written with FORWARD SLASHES and quoted by JSON.stringify. On
// Windows path.join hands back D:\a\SKRiMPAD-M2\..., and dropping that between
// quotes in generated JavaScript makes \a and \S escape sequences — esbuild
// reported `Syntax error "l"` on a line that looked perfectly fine, on the
// Windows runner only. esbuild takes D:/a/... quite happily.
const mod = (p) => JSON.stringify(path.join(ROOT, p).split(path.sep).join('/'));
const entry = path.join(TMP, 'entry.js');
fs.writeFileSync(entry, `
import { playPitched, createGrainStream, needsShift, semitonesFor } from ${mod('ultimate/src/core/pitch.js')};
import { createEngine } from ${mod('ultimate/src/core/engine.js')};
window.P = { playPitched, createGrainStream, needsShift, semitonesFor, createEngine };
`);
const bundleFile = path.join(TMP, 'bundle.js');
execSync(`npx --yes esbuild "${entry}" --bundle --format=iife --platform=browser --target=es2019 --outfile="${bundleFile}"`,
  { stdio: 'inherit' });
const BUNDLE = fs.readFileSync(bundleFile, 'utf8');

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('about:blank');
  await p.addScriptTag({ content: BUNDLE });

  // Measurement kit, installed in the page. Kept deliberately dumb: zero
  // crossings for frequency and a threshold sweep for length, because both are
  // things a person could check by hand on a plotted waveform.
  await p.evaluate(() => {
    window.M = {
      // A constant sine, as an AudioBuffer.
      tone(ctx, secs, freq, rate) {
        const n = Math.round(secs * rate);
        const buf = ctx.createBuffer(1, n, rate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * freq * i / rate);
        return buf;
      },
      // Two constant tones back to back — a sample with a landmark in it, so
      // the position of the read head can be seen in the output.
      twoTone(ctx, secs, fa, fb, rate) {
        const n = Math.round(secs * rate);
        const buf = ctx.createBuffer(1, n, rate);
        const d = buf.getChannelData(0);
        const half = Math.floor(n / 2);
        let ph = 0;
        for (let i = 0; i < n; i++) {
          ph += 2 * Math.PI * (i < half ? fa : fb) / rate;
          d[i] = Math.sin(ph);
        }
        return buf;
      },
      // Dominant frequency over a window centred on `at`, by normalised
      // autocorrelation.
      //
      // This started out as a zero-crossing counter, which is simpler and was
      // WRONG HERE. Granular output is two windowed copies of the sample
      // overlapping at different phases; where they interfere the waveform
      // grows extra crossings, and the counter read a -7 shift as 154Hz when it
      // was 147Hz. That is a 5% error in the measurement being blamed on the
      // thing measured. Autocorrelation looks for the period of the whole
      // window instead of counting edges, so interference ripple does not move
      // it.
      f0(d, rate, at, win) {
        const a = Math.max(0, Math.round((at - win / 2) * rate));
        const z = Math.min(d.length, Math.round((at + win / 2) * rate));
        const n = z - a;
        const minLag = Math.max(2, Math.floor(rate / 2000));
        const maxLag = Math.min(Math.floor(rate / 60), n >> 1);
        const c = new Float64Array(maxLag + 1);
        let best = 0;
        for (let lag = minLag; lag <= maxLag; lag++) {
          let s = 0, e1 = 0, e2 = 0;
          for (let i = 0; i < n - lag; i++) {
            const x = d[a + i], y = d[a + i + lag];
            s += x * y; e1 += x * x; e2 += y * y;
          }
          c[lag] = s / Math.sqrt(Math.max(1e-12, e1 * e2));
          if (c[lag] > best) best = c[lag];
        }
        if (best <= 0) return 0;
        // THE FIRST LOCAL MAXIMUM, not the first lag over a threshold. A slow
        // wave still correlates well with itself a few samples along — at 110Hz
        // the correlation at the shortest lag tested is 0.94 — so a plain
        // threshold sweep returned 2004Hz for a 110Hz tone. It has to be a
        // PEAK: the correlation must have fallen and come back up, which only
        // happens at a real period. The global maximum alone is not enough
        // either, since autocorrelation peaks just as hard at twice the true
        // period and would report an octave below the truth.
        let lag = 0;
        for (let k = minLag + 1; k < maxLag; k++) {
          if (c[k] > c[k - 1] && c[k] >= c[k + 1] && c[k] > best * 0.85) { lag = k; break; }
        }
        if (!lag) return 0;
        // Sub-sample interpolation across the peak. Without it the answer is
        // quantised to whole samples, which at 1200Hz is a 3% step — the same
        // size as the errors being looked for.
        const y0 = c[lag - 1], y1 = c[lag], y2 = c[lag + 1];
        const den = y0 - 2 * y1 + y2;
        const adj = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
        return rate / (lag + Math.max(-1, Math.min(1, adj)));
      },
      rms(d, rate, at, win) {
        const a = Math.max(0, Math.round((at - win / 2) * rate));
        const z = Math.min(d.length, Math.round((at + win / 2) * rate));
        let s = 0; for (let i = a; i < z; i++) s += d[i] * d[i];
        return Math.sqrt(s / Math.max(1, z - a));
      },
      // When does the sound actually stop? Last sample above a fraction of the
      // loudest one, which is what "how long is it" means to an ear.
      endsAt(d, rate, frac) {
        let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        const th = peak * (frac || 0.02);
        for (let i = d.length - 1; i >= 0; i--) if (Math.abs(d[i]) > th) return i / rate;
        return 0;
      },
      startsAt(d, rate, frac) {
        let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
        const th = peak * (frac || 0.02);
        for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > th) return i / rate;
        return 0;
      },
    };
  });

  const RATE = 44100;

  // ---- 1. length is preserved, pitch is not --------------------------------
  // The whole request, in one table: play a one-second 220Hz tone at five
  // different octaves/intervals and check the clock and the pitch separately.
  const shifts = [-12, -7, -3, 0, 3, 7, 12];
  const grid = await p.evaluate(async ({ shifts, RATE }) => {
    const out = [];
    for (const n of shifts) {
      const ctx = new OfflineAudioContext(1, RATE * 3, RATE);
      const buf = M.tone(ctx, 1.0, 220, RATE);
      P.playPitched(ctx, buf, 0.2, n, ctx.destination);
      const d = (await ctx.startRendering()).getChannelData(0);
      out.push({
        n,
        start: M.startsAt(d, RATE, 0.05),
        end: M.endsAt(d, RATE, 0.05),
        f0: M.f0(d, RATE, 0.7, 0.12),
      });
    }
    return out;
  }, { shifts, RATE });

  console.log('\n  shift   starts    ends   length     f0      wanted');
  for (const r of grid) {
    console.log('  ' + String(r.n).padStart(4) + '  ' + r.start.toFixed(3) + '   ' + r.end.toFixed(3) +
                '   ' + (r.end - r.start).toFixed(3) + '   ' + r.f0.toFixed(1).padStart(7) +
                '  ' + (220 * Math.pow(2, r.n / 12)).toFixed(1).padStart(7));
  }
  console.log('');

  for (const r of grid) {
    const len = r.end - r.start;
    // A 1.000s sample. Anything within 25ms is the window's fade, not a change
    // of tempo — the failure this guards against is 0.5s and 2.0s, not 0.99s.
    ok(Math.abs(len - 1.0) < 0.03, `${r.n >= 0 ? '+' : ''}${r.n} semitones keeps the sample 1.000s long`,
       len.toFixed(3) + 's');
    const want = 220 * Math.pow(2, r.n / 12);
    ok(Math.abs(r.f0 - want) / want < 0.04, `${r.n >= 0 ? '+' : ''}${r.n} semitones lands on ${want.toFixed(1)}Hz`,
       r.f0.toFixed(1) + 'Hz');
  }
  // ...and it starts when it was told to, at every pitch. A shifter that pads
  // the front is a shifter that puts every note late.
  ok(grid.every((r) => Math.abs(r.start - 0.2) < 0.01), 'every pitch starts exactly on time',
     grid.map((r) => r.start.toFixed(3)).join(' '));

  // ---- 2. the control: this is what it used to do --------------------------
  // playbackRate, measured the same way. It MUST fail the length test, or the
  // length test is not measuring anything.
  const control = await p.evaluate(async ({ RATE }) => {
    const out = {};
    for (const n of [-12, 12]) {
      const ctx = new OfflineAudioContext(1, RATE * 3, RATE);
      const buf = M.tone(ctx, 1.0, 220, RATE);
      const s = ctx.createBufferSource();
      s.buffer = buf; s.playbackRate.value = Math.pow(2, n / 12);
      s.connect(ctx.destination); s.start(0.2);
      const d = (await ctx.startRendering()).getChannelData(0);
      // Measured at 0.4s, not 0.7s. Up an octave this sample is FINISHED by
      // 0.7s — that is the bug — so measuring the pitch there measures silence.
      out[n] = { len: M.endsAt(d, RATE, 0.05) - M.startsAt(d, RATE, 0.05), f0: M.f0(d, RATE, 0.4, 0.12) };
    }
    return out;
  }, { RATE });
  ok(Math.abs(control[12].len - 0.5) < 0.05, 'CONTROL: playbackRate up an octave really does halve the length',
     control[12].len.toFixed(3) + 's — this is the bug, and the test can see it');
  ok(control[-12].len > 1.9, 'CONTROL: playbackRate down an octave really does double the length',
     control[-12].len.toFixed(3) + 's');
  // Both get the pitch right — which is exactly why this was easy to miss.
  ok(Math.abs(control[12].f0 - 440) / 440 < 0.04, 'CONTROL: playbackRate gets the PITCH right, only the time wrong',
     control[12].f0.toFixed(1) + 'Hz');

  // ---- 3. no shift costs nothing ------------------------------------------
  const unity = await p.evaluate(async ({ RATE }) => {
    const ctx = new OfflineAudioContext(1, RATE * 2, RATE);
    const buf = M.tone(ctx, 1.0, 220, RATE);
    const r = P.playPitched(ctx, buf, 0.1, 0, ctx.destination);
    const d = (await ctx.startRendering()).getChannelData(0);
    // At unity it must be the ORIGINAL SAMPLE, bit for bit, not a resynthesis
    // of it. Compare against the source directly.
    const src = buf.getChannelData(0);
    let worst = 0;
    for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(d[Math.round(0.1 * RATE) + i] - src[i]));
    return { grains: r.grains, worst, needs: P.needsShift(0), needs1: P.needsShift(1) };
  }, { RATE });
  ok(unity.grains === 1, 'an unshifted note is one plain source, not a grain cloud', unity.grains + ' source(s)');
  ok(unity.worst < 1e-6, 'an unshifted note is the untouched sample, sample for sample',
     'worst deviation ' + unity.worst.toExponential(2));
  ok(unity.needs === false && unity.needs1 === true, 'needsShift() knows when to bother', '0→no, 1→yes');

  // ---- 4. level is flat across the joins ----------------------------------
  // The seams are where a naive shifter announces itself. Measure the loudness
  // of the body in 30ms slices and look at the spread.
  const flat = await p.evaluate(async ({ RATE }) => {
    const out = {};
    for (const n of [-12, -5, 5, 12]) {
      const ctx = new OfflineAudioContext(1, RATE * 3, RATE);
      const buf = M.tone(ctx, 1.2, 220, RATE);
      P.playPitched(ctx, buf, 0.2, n, ctx.destination);
      const d = (await ctx.startRendering()).getChannelData(0);
      let lo = Infinity, hi = 0;
      for (let t = 0.35; t < 1.25; t += 0.03) {
        const r = M.rms(d, RATE, t, 0.03);
        lo = Math.min(lo, r); hi = Math.max(hi, r);
      }
      out[n] = { lo, hi, ratio: hi / Math.max(1e-9, lo) };
    }
    return out;
  }, { RATE });
  for (const n of [-12, -5, 5, 12]) {
    const r = flat[n];
    const db = 20 * Math.log10(r.ratio);
    // A sine is the WORST case for this: every grain is a copy of the same
    // waveform at a different phase, so where two overlap they interfere. Real
    // material has a moving spectrum and averages out. 6dB of ripple is the
    // published behaviour of a triangular window at 50% overlap and is not
    // audible as a level change on anything but a held test tone.
    ok(db < 6.5, `${n > 0 ? '+' : ''}${n} semitones holds its level across the grain joins`,
       db.toFixed(1) + 'dB peak-to-trough ripple');
  }

  // ---- 5. a held key: the loop keeps time at any pitch ----------------------
  // The sample is 200Hz for its first half and 600Hz for its second, so the
  // read head's position is legible in the output. Loop region is 0.2s..1.0s,
  // i.e. 0.8s round — and it must STILL be 0.8s round an octave up, which is
  // the thing a looped buffer source cannot do.
  const stream = await p.evaluate(async ({ RATE }) => {
    const ctx = new OfflineAudioContext(1, RATE * 3, RATE);
    const buf = M.twoTone(ctx, 1.0, 200, 600, RATE);
    const s = P.createGrainStream(ctx, buf, ctx.destination,
      { semis: 12, loop: true, loopStart: 0.2, loopEnd: 1.0, horizon: 3 });
    s.start(0);
    const d = (await ctx.startRendering()).getChannelData(0);
    const at = (t) => M.f0(d, RATE, t, 0.08);
    return {
      // first pass through the sample
      a1: at(0.30),   // read 0.30 → low half  → 400
      b1: at(0.70),   // read 0.70 → high half → 1200
      // after the wrap: t=1.0 → read 0.2, so t=1.15 → read 0.35
      a2: at(1.15),   // → 400 again
      b2: at(1.50),   // read 0.70 → 1200
      a3: at(1.95),   // one more loop: read 0.35 → 400
      alive: M.rms(d, RATE, 2.5, 0.05),
    };
  }, { RATE });
  console.log('\n  stream f0 over time: 0.30s=' + stream.a1.toFixed(0) + '  0.70s=' + stream.b1.toFixed(0) +
              '  1.15s=' + stream.a2.toFixed(0) + '  1.50s=' + stream.b2.toFixed(0) +
              '  1.95s=' + stream.a3.toFixed(0) + '\n');
  const near = (x, want) => Math.abs(x - want) / want < 0.10;
  ok(near(stream.a1, 400) && near(stream.b1, 1200), 'held key: an octave up doubles both halves of the sample',
     stream.a1.toFixed(0) + 'Hz / ' + stream.b1.toFixed(0) + 'Hz (want 400 / 1200)');
  ok(near(stream.a2, 400) && near(stream.b2, 1200) && near(stream.a3, 400),
     'held key: the loop still comes round every 0.8s AT DOUBLE PITCH',
     'a looped buffer source would be round in 0.4s and this would read 1200Hz at 1.15s');
  ok(stream.alive > 0.05, 'held key: still sounding after 2.5 seconds — the stream tops itself up',
     'rms ' + stream.alive.toFixed(3));

  // ---- 6. the engine actually uses it -------------------------------------
  // Everything above tests the shifter. This tests that the instrument reaches
  // for it, which is a different failure and the more likely one.
  const eng = await p.evaluate(async ({ RATE }) => {
    async function render(preserveLength, note) {
      const ctx = new OfflineAudioContext(1, RATE * 4, RATE);
      const buf = M.tone(ctx, 1.0, 220, RATE);
      const e = P.createEngine({ sampleFor: () => buf, context: ctx, preserveLength });
      const voice = { sampleId: 's', kind: 'sample', note: 60, tune: 0, cutoff: 1, res: 0,
                      attack: 0.005, decay: 3, sustain: 1, release: 0.5, gain: 1,
                      pan: 0, drive: 0, space: 0, spread: 0 };
      e.play(voice, 0.2, 110, null, note);
      const d = (await ctx.startRendering()).getChannelData(0);
      return { len: M.endsAt(d, RATE, 0.05) - M.startsAt(d, RATE, 0.05), f0: M.f0(d, RATE, 0.6, 0.12) };
    }
    return {
      keepUp: await render(true, 12),
      keepDown: await render(true, -12),
      tapeUp: await render(false, 12),
    };
  }, { RATE });
  ok(Math.abs(eng.keepUp.len - 1.0) < 0.06 && Math.abs(eng.keepUp.f0 - 440) / 440 < 0.05,
     'engine with preserveLength: +12 is 440Hz and still a second long',
     eng.keepUp.len.toFixed(3) + 's @ ' + eng.keepUp.f0.toFixed(0) + 'Hz');
  ok(Math.abs(eng.keepDown.len - 1.0) < 0.06 && Math.abs(eng.keepDown.f0 - 110) / 110 < 0.05,
     'engine with preserveLength: -12 is 110Hz and still a second long',
     eng.keepDown.len.toFixed(3) + 's @ ' + eng.keepDown.f0.toFixed(0) + 'Hz');
  ok(Math.abs(eng.tapeUp.len - 0.5) < 0.06,
     'engine WITHOUT preserveLength is unchanged — the other editions keep tape speed',
     eng.tapeUp.len.toFixed(3) + 's');

  // ---- 7. a held key through the engine, and it releases ------------------
  const heldRes = await p.evaluate(async ({ RATE }) => {
    const ctx = new OfflineAudioContext(1, RATE * 4, RATE);
    const buf = M.tone(ctx, 1.0, 220, RATE);
    const e = P.createEngine({ sampleFor: () => buf, context: ctx, preserveLength: true });
    const voice = { sampleId: 's', kind: 'sample', note: 60, tune: 0, cutoff: 1, res: 0,
                    attack: 0.01, decay: 0.2, sustain: 1, release: 0.2, gain: 1,
                    pan: 0, drive: 0, space: 0, spread: 0 };
    const v = e.hold(voice, 72, 110, 0.1);      // C5 — an octave above the sample
    const d = (await ctx.startRendering()).getChannelData(0);
    return { f0: M.f0(d, RATE, 1.6, 0.12), rms1: M.rms(d, RATE, 0.6, 0.05),
             rms3: M.rms(d, RATE, 3.0, 0.05), isSample: v.isSample };
  }, { RATE });
  ok(heldRes.isSample === true, 'engine: a held sample key reports itself as a sample');
  ok(Math.abs(heldRes.f0 - 440) / 440 < 0.06, 'engine: a held key an octave up sounds an octave up',
     heldRes.f0.toFixed(0) + 'Hz');
  // A 1.0s sample held for three seconds. Tape speed would have run out at 0.5s
  // (short samples do not loop); the stream loops and is still going.
  ok(heldRes.rms3 > 0.02, 'engine: a held key is still sounding three seconds in',
     'rms ' + heldRes.rms3.toFixed(3) + ' vs ' + heldRes.rms1.toFixed(3) + ' at 0.6s');

  ok(errs.length === 0, 'no page errors', errs.join(' | ') || 'clean');

  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
