// velocity.cjs — how hard you hit it, measured.
//
// VEL is the shifted function on PAD-B, and the claim it makes is specific: a
// harder hit is LOUDER and BRIGHTER. Volume alone is a volume knob. So the
// test renders the same note at two velocities and measures both — level, and
// energy above 2kHz — because "it responds to velocity" is only half true if
// only one of them moves.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');
const { chromium } = require('playwright-core');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimvel-'));
const mod = (p) => JSON.stringify(path.join(ROOT, p).split(path.sep).join('/'));
const entry = path.join(TMP, 'entry.js');
fs.writeFileSync(entry, `
import { createEngine } from ${mod('ultimate/src/core/engine.js')};
import { applyCurve, CURVES, FIXED_VEL, brightnessFor } from ${mod('smk/src/core/velocity.js')};
window.P = { createEngine, applyCurve, CURVES, FIXED_VEL, brightnessFor };
`);
const bundleFile = path.join(TMP, 'bundle.js');
execSync(`npx --yes esbuild "${entry}" --bundle --format=iife --platform=browser --target=es2019 --outfile="${bundleFile}"`,
  { stdio: 'inherit' });
const BUNDLE = fs.readFileSync(bundleFile, 'utf8');

// ---- the curves, as arithmetic --------------------------------------------
// These run in node before the browser work, because a curve is a function and
// deserves to be checked as one.
const { applyCurve, CURVES, FIXED_VEL } = (() => {
  const out = path.join(TMP, 'vel.cjs');
  execSync(`npx --yes esbuild "${path.join(ROOT, 'smk/src/core/velocity.js').split(path.sep).join('/')}" --bundle --format=cjs --platform=node --outfile="${out}"`, { stdio: 'inherit' });
  return require(out);
})();

ok(CURVES.length === 4 && CURVES.map((c) => c.id).join(' ') === 'soft linear hard fixed',
   'four curves', CURVES.map((c) => c.l).join(' '));
ok(applyCurve(64, 'linear') === 64 && applyCurve(1, 'linear') === 1 && applyCurve(127, 'linear') === 127,
   'LINEAR passes the keyboard through untouched');
ok(applyCurve(64, 'soft') > 64, 'SOFT lifts a middling hit', '64 → ' + applyCurve(64, 'soft'));
ok(applyCurve(64, 'hard') < 64, 'HARD lowers it', '64 → ' + applyCurve(64, 'hard'));
ok(applyCurve(20, 'fixed') === FIXED_VEL && applyCurve(120, 'fixed') === FIXED_VEL,
   'FIXED plays everything at the same strength', FIXED_VEL + '');
ok(FIXED_VEL < 127, 'and not at maximum, which would make FIXED quietly the loudest setting',
   FIXED_VEL + ' of 127');

// THE ENDS MUST STAY REACHABLE. A curve that cannot reach 127 means full
// volume is unavailable; one that cannot reach 1 means you cannot play quietly.
let ends = [];
for (const c of ['soft', 'linear', 'hard']) {
  if (applyCurve(127, c) !== 127) ends.push(c + ' cannot reach 127');
  if (applyCurve(1, c) < 1) ends.push(c + ' goes below 1');
}
ok(ends.length === 0, 'every curve still reaches both ends of the range', ends.join(', ') || 'soft, linear, hard');

// MONOTONIC. A curve where hitting harder can produce a LOWER velocity is an
// instrument that argues with you — swept across all 127 steps.
let mono = [];
for (const c of ['soft', 'linear', 'hard', 'fixed']) {
  for (let v = 2; v <= 127; v++) if (applyCurve(v, c) < applyCurve(v - 1, c)) mono.push(c + '@' + v);
}
ok(mono.length === 0, 'and harder never comes out quieter, at any of 127 steps',
   mono.length ? mono.slice(0, 3).join(', ') : '508 steps swept');

// ---- the sound ------------------------------------------------------------
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('about:blank');
  await p.addScriptTag({ content: BUNDLE });

  const hits = await p.evaluate(async () => {
    const RATE = 44100;
    // Render one note at a given velocity through the PAD path (engine.play),
    // which is the path that was flat.
    const render = async (vel) => {
      const ctx = new OfflineAudioContext(1, RATE * 2, RATE);
      const e = P.createEngine({ context: ctx });
      e.play({ kind: 'synth', wave: 'sawtooth', note: 45, gain: 0.7,
               attack: 0.002, decay: 0.5, sustain: 0, release: 0.08,
               cutoff: 0.45, res: 0.1, drive: 0, space: 0, spread: 0, pan: 0, tune: 0 }, 0.1, vel);
      const d = (await ctx.startRendering()).getChannelData(0);
      const a = Math.round(0.1 * RATE), z = Math.round(0.55 * RATE);
      let sum = 0, hfsum = 0, y = 0, y2 = 0, py = 0;
      const alpha = 1 / (1 + 2 * Math.PI * 2000 / RATE);
      for (let i = a; i < z; i++) {
        const x = d[i]; sum += x * x;
        const px = i > a ? d[i - 1] : x;
        y = alpha * (y + x - px); y2 = alpha * (y2 + y - py); py = y;
        hfsum += y2 * y2;
      }
      const n = z - a;
      const rms = Math.sqrt(sum / n);
      return { rms, bright: Math.sqrt(hfsum / n) / Math.max(1e-9, rms) };
    };
    return { soft: await render(30), hard: await render(120) };
  });

  console.log('\n  velocity 30  rms ' + hits.soft.rms.toFixed(4) + '  brightness ' + hits.soft.bright.toFixed(4));
  console.log('  velocity 120 rms ' + hits.hard.rms.toFixed(4) + '  brightness ' + hits.hard.bright.toFixed(4) + '\n');

  ok(hits.hard.rms > hits.soft.rms * 2, 'a harder hit is LOUDER',
     hits.soft.rms.toFixed(4) + ' → ' + hits.hard.rms.toFixed(4));
  // The half that was missing. engine.hold() opened the filter with velocity;
  // engine.play() did not, so pads, sequenced notes and arpeggiated notes were
  // flat — louder and never brighter, which feels like a volume knob.
  ok(hits.hard.bright > hits.soft.bright * 1.25, 'and BRIGHTER — the half that was missing',
     'brightness ' + hits.soft.bright.toFixed(4) + ' → ' + hits.hard.bright.toFixed(4));

  // The two paths must agree. A pad that responds differently from a key is
  // two instruments in one box.
  const both = await p.evaluate(async () => {
    const RATE = 44100;
    const measure = async (useHold, vel) => {
      const ctx = new OfflineAudioContext(1, RATE * 2, RATE);
      const e = P.createEngine({ context: ctx });
      const v = { kind: 'synth', wave: 'sawtooth', note: 45, gain: 0.7,
                  attack: 0.002, decay: 0.5, sustain: 0.9, release: 0.08,
                  cutoff: 0.45, res: 0.1, drive: 0, space: 0, spread: 0, pan: 0, tune: 0 };
      if (useHold) e.hold(v, 45, vel, 0.1); else e.play(v, 0.1, vel);
      const d = (await ctx.startRendering()).getChannelData(0);
      const a = Math.round(0.15 * RATE), z = Math.round(0.4 * RATE);
      let sum = 0, hfsum = 0, y = 0, y2 = 0, py = 0;
      const alpha = 1 / (1 + 2 * Math.PI * 2000 / RATE);
      for (let i = a; i < z; i++) {
        const x = d[i]; sum += x * x;
        const px = i > a ? d[i - 1] : x;
        y = alpha * (y + x - px); y2 = alpha * (y2 + y - py); py = y;
        hfsum += y2 * y2;
      }
      const n = z - a, rms = Math.sqrt(sum / n);
      return Math.sqrt(hfsum / n) / Math.max(1e-9, rms);
    };
    return {
      padRatio: (await measure(false, 120)) / (await measure(false, 30)),
      keyRatio: (await measure(true, 120)) / (await measure(true, 30)),
    };
  });
  ok(both.padRatio > 1.2 && both.keyRatio > 1.2,
     'both the pad path and the key path open with velocity',
     'pad ×' + both.padRatio.toFixed(2) + ', key ×' + both.keyRatio.toFixed(2));
  ok(Math.abs(both.padRatio - both.keyRatio) / both.keyRatio < 0.35,
     'and they respond the SAME — a pad that answers differently from a key is two instruments in one box',
     'pad ×' + both.padRatio.toFixed(2) + ' vs key ×' + both.keyRatio.toFixed(2));

  ok(errs.length === 0, 'no page errors', errs.join(' | ') || 'clean');

  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
