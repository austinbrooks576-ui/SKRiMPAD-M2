// snip.cjs — cutting a sound bite out of a sound.
//
// Every claim here is about SAMPLES, so every check reads samples back. The
// interesting cases are the ends: a cut that does not reach zero is a click,
// and a click is the whole reason the fades exist.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');
const { chromium } = require('playwright-core');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimsnip-'));
const mod = JSON.stringify(path.join(ROOT, 'smk/src/core/snip.js').split(path.sep).join('/'));
const entry = path.join(TMP, 'entry.js');
fs.writeFileSync(entry, `import * as S from ${mod};\nwindow.S = S;\n`);
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

  const RATE = 44100;

  // A one-second tone with a quarter-second of silence at each end — the shape
  // of almost every sample anybody ever imports.
  const r = await p.evaluate(async ({ RATE }) => {
    const ctx = new OfflineAudioContext(1, RATE, RATE);
    const src = ctx.createBuffer(1, RATE, RATE);
    const d = src.getChannelData(0);
    for (let i = RATE * 0.25; i < RATE * 0.75; i++) d[i] = Math.sin(2 * Math.PI * 220 * i / RATE) * 0.8;

    const out = {};
    const edges = S.findEdges(src);
    out.edges = edges;

    const cut = S.snip(ctx, src, { start: edges.start, end: edges.end });
    out.cut = { len: cut.length, rate: cut.sampleRate,
                first: cut.getChannelData(0)[0],
                last: cut.getChannelData(0)[cut.length - 1] };

    // Biggest sample-to-sample jump at each seam — the thing that is a click.
    const c = cut.getChannelData(0);
    let headJump = 0, tailJump = Math.abs(c[cut.length - 1]);
    for (let i = 1; i < 200; i++) headJump = Math.max(headJump, Math.abs(c[i] - c[i - 1]));
    out.headJump = headJump; out.tailJump = tailJump;

    // A HARD cut with no fade at all, for comparison — this is what the trim
    // would sound like if the fades were left out.
    const raw = ctx.createBuffer(1, RATE, RATE);
    const rd = raw.getChannelData(0);
    for (let i = 0; i < RATE; i++) rd[i] = Math.sin(2 * Math.PI * 220 * i / RATE) * 0.8;
    // How big a step a hard cut here WOULD be. Read as the largest magnitude
    // over a window, not one sample: a 220Hz sine crosses zero 440 times a
    // second, so a single sample at an arbitrary point is as likely to be 0.00
    // as 0.80 — which is what the first version of this measured, and it made
    // the control look like there had never been a click to fix.
    const hard = raw.getChannelData(0);
    let hs = 0;
    for (let i = Math.round(RATE * 0.3); i < Math.round(RATE * 0.31); i++) hs = Math.max(hs, Math.abs(hard[i]));
    out.hardStep = hs;

    // Fades.
    const faded = S.snip(ctx, raw, { start: 0, end: 1, fadeIn: 0.05, fadeOut: 0.05 });
    const f = faded.getChannelData(0);
    // An ENVELOPE is read over at least one cycle of the waveform underneath
    // it. At 220Hz a cycle is 4.5ms, so a 1ms window can land anywhere between
    // the peak and a zero crossing and says nothing about the fade — the first
    // version of this read 0.318 where the envelope was exactly 0.5.
    const env = (t) => {
      const a = Math.round((t - 0.003) * RATE), z = Math.round((t + 0.003) * RATE);
      let m = 0; for (let i = Math.max(0, a); i < Math.min(f.length, z); i++) m = Math.max(m, Math.abs(f[i]));
      return m;
    };
    out.fade = { atStart: Math.abs(f[0]), quarterIn: env(0.025), middle: env(0.5),
                 atEnd: Math.abs(f[faded.length - 1]) };

    // Fades longer than the sound must not overlap and eat the middle.
    const tiny = S.snip(ctx, raw, { start: 0, end: 0.01, fadeIn: 5, fadeOut: 5 });
    const t = tiny.getChannelData(0);
    out.tinyMid = Math.max(...Array.from(t).map(Math.abs));
    out.tinyLen = tiny.length;

    // Reverse.
    const fwd = S.snip(ctx, raw, { start: 0, end: 0.2 });
    const rev = S.snip(ctx, raw, { start: 0, end: 0.2, reverse: true });
    const F = fwd.getChannelData(0), R = rev.getChannelData(0);
    let mirrored = 0;
    for (let i = 0; i < F.length; i++) if (Math.abs(F[i] - R[R.length - 1 - i]) < 1e-6) mirrored++;
    out.mirrored = mirrored / F.length;

    // Gain, and the clamp. 1.5 on a 0.8 signal wants 1.2 — which cannot be
    // written to sixteen bits, and wraps to a full-scale NEGATIVE spike if it
    // is not clamped first.
    const hot = S.snip(ctx, raw, { start: 0, end: 0.2, gain: 1.5 });
    const wav = S.encodeWav(hot);
    const dv = new DataView(wav.buffer);
    // A WRAP IS A SIGN FLIP, not a big negative number. Clamping a hot positive
    // peak legitimately produces +1.0, and clamping a hot negative one
    // legitimately produces -1.0 — counting "samples below -0.99" therefore
    // counts every correctly clamped trough and reported 1610 failures on
    // code that was working. The actual fault being guarded against is a
    // positive input coming out negative, so that is what is checked.
    const src2 = hot.getChannelData(0);
    let flips = 0;
    for (let i = 0; i < src2.length; i++) {
      const enc = dv.getInt16(44 + i * 2, true) / 32768;
      if (Math.abs(src2[i]) > 0.05 && Math.sign(enc) !== Math.sign(src2[i])) flips++;
    }
    out.wrapped = flips;
    out.wav = { len: wav.length, riff: String.fromCharCode(wav[0], wav[1], wav[2], wav[3]),
                fmt: dv.getUint16(20, true), chans: dv.getUint16(22, true),
                rate: dv.getUint32(24, true), bits: dv.getUint16(34, true),
                dataLen: dv.getUint32(40, true) };

    out.peaks = Array.from(S.peaks(src, 16));
    return out;
  }, { RATE });

  // findEdges must land on the sound, not on the silence.
  ok(Math.abs(r.edges.start - 0.25) < 0.02, 'findEdges finds where the sound actually starts',
     r.edges.start.toFixed(3) + ' (silence ends at 0.250)');
  ok(Math.abs(r.edges.end - 0.75) < 0.02, 'and where it stops', r.edges.end.toFixed(3));
  ok(r.edges.start < 0.25, 'backing off a few ms so the transient survives the trim',
     r.edges.start.toFixed(4) + ' < 0.25');

  ok(Math.abs(r.cut.len - RATE * 0.5) < RATE * 0.02, 'the trim is the length it claims',
     r.cut.len + ' samples ≈ ' + (r.cut.len / RATE).toFixed(3) + 's');
  ok(r.cut.rate === RATE, 'at the original sample rate — a trim is not a resample');

  // The click test. A hard cut through a 0.8 sine steps from up to 0.8 straight
  // to nothing; the trimmed one must not.
  ok(Math.abs(r.cut.first) < 1e-6, 'a snip starts at exactly zero', r.cut.first.toExponential(2));
  ok(Math.abs(r.cut.last) < 1e-6, 'and ends at exactly zero', r.cut.last.toExponential(2));
  ok(r.headJump < 0.05, 'with no step at the head that could click',
     'biggest jump ' + r.headJump.toFixed(4) + ' vs a hard cut of ' + r.hardStep.toFixed(3));
  ok(r.tailJump < 1e-6, 'and none at the tail', r.tailJump.toExponential(2));
  ok(r.hardStep > 0.3, 'CONTROL: cutting there without a fade really would be a step of that size',
     r.hardStep.toFixed(3) + ' — this is the click the fades exist to remove');

  // Fades: linear, so half way through a 50ms fade the level is half.
  ok(r.fade.atStart < 1e-6, 'a fade-in starts from silence');
  ok(Math.abs(r.fade.quarterIn / r.fade.middle - 0.5) < 0.12,
     'and is linear — half way through, half the level',
     (r.fade.quarterIn / r.fade.middle).toFixed(3));
  ok(r.fade.atEnd < 1e-6, 'and a fade-out reaches silence');
  ok(r.tinyMid > 0.1 && r.tinyLen > 0,
     'fades longer than the snip are clamped, so the middle is not eaten',
     'peak ' + r.tinyMid.toFixed(3) + ' over ' + r.tinyLen + ' samples');

  ok(r.mirrored > 0.98, 'reverse really is the same audio backwards',
     (r.mirrored * 100).toFixed(1) + '% of samples mirror');

  // WAV.
  ok(r.wav.riff === 'RIFF' && r.wav.fmt === 1 && r.wav.bits === 16,
     'the snip encodes to a real 16-bit PCM WAV', r.wav.riff + ' fmt' + r.wav.fmt + ' ' + r.wav.bits + 'bit');
  ok(r.wav.rate === RATE && r.wav.chans === 1, 'at the right rate and channel count',
     r.wav.rate + 'Hz × ' + r.wav.chans);
  ok(r.wav.len === 44 + r.wav.dataLen, 'with a header that agrees with its own data length',
     r.wav.len + ' = 44 + ' + r.wav.dataLen);
  ok(r.wrapped === 0, 'and gain past full scale is CLAMPED, not wrapped into a spike of the opposite sign',
     r.wrapped + ' sign flips at gain 1.5');

  // peaks() must describe the shape, not average it to nothing.
  const mid = r.peaks.slice(5, 11), ends = r.peaks.slice(0, 3).concat(r.peaks.slice(13));
  ok(Math.max(...mid) > 0.5 && Math.max(...ends) < 0.05,
     'the waveform preview shows the sound in the middle and silence at the ends',
     r.peaks.map((x) => x.toFixed(1)).join(' '));

  ok(errs.length === 0, 'no page errors', errs.join(' | ') || 'clean');

  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
