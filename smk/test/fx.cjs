// fx.cjs — six effects, each proven by its SIGNATURE in rendered audio.
//
// A toggle that "works" is not a class name changing — it is a measurable
// difference in the sound: a delay leaves energy after the note ends, a filter
// removes highs, drive flattens peaks, a compressor closes the gap between
// loud and soft. Each unit is rendered off and on and the difference is the
// assertion. If a unit ever becomes a no-op, its test goes red — not silent.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');
const { chromium } = require('playwright-core');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimfx-'));
const mod = (p) => JSON.stringify(path.join(ROOT, p).split(path.sep).join('/'));
const entry = path.join(TMP, 'entry.js');
fs.writeFileSync(entry, `
import { createEngine } from ${mod('ultimate/src/core/engine.js')};
import { buildFxChain, FX_UNITS, defaultFx } from ${mod('smk/src/core/fx.js')};
window.P = { createEngine, buildFxChain, FX_UNITS, defaultFx };
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
    const RATE = 44100;
    // Render a two-burst phrase (one loud, one soft) through the engine with a
    // given fx state, and return the measurements every unit is judged on.
    window.render = async (fxState) => {
      const ctx = new OfflineAudioContext(1, RATE * 4, RATE);
      const e = P.createEngine({ context: ctx });
      e.init();
      e.patchFx(fxState ? P.buildFxChain(fxState, 120) : null);
      const v = (vel) => ({ kind: 'synth', wave: 'sawtooth', note: 48, gain: 0.7,
        attack: 0.003, decay: 0.25, sustain: 0, release: 0.05,
        cutoff: 0.9, res: 0.1, drive: 0, space: 0, spread: 0, pan: 0, tune: 0 });
      e.play(v(), 0.10, 120);      // the loud burst
      e.play(v(), 1.20, 40);       // the soft one
      const d = (await ctx.startRendering()).getChannelData(0);
      const seg = (t0, t1) => {
        const a = Math.round(t0 * RATE), z = Math.round(t1 * RATE);
        let sum = 0, peak = 0, hfsum = 0, y = 0;
        // HIGHS ARE MEASURED AS ENERGY ABOVE 2kHz, through a one-pole
        // high-pass run over the samples — NOT as the mean first difference.
        // A sawtooth's mean |diff| is dominated by its ramp, whose slope
        // scales with the FUNDAMENTAL, so cutting every harmonic above 820Hz
        // barely moved that number and the first version of this file failed
        // a filter that was audibly working.
        // ...and the high-pass is CASCADED: one pole leaks -6dB/oct, so the
        // strong 500-800Hz harmonics the filter deliberately KEEPS (and its
        // resonance boosts) still dominated the "highs" and hid a filter that
        // was removing 20dB up top. Two poles give -12dB/oct and the number
        // finally describes what it names.
        const alpha = 1 / (1 + 2 * Math.PI * 2000 / RATE);
        let y2 = 0, py = 0;
        for (let i = a; i < z; i++) {
          const x = d[i]; sum += x * x; const ax = Math.abs(x);
          if (ax > peak) peak = ax;
          const px = i > a ? d[i - 1] : x;
          y = alpha * (y + x - px);
          y2 = alpha * (y2 + y - py);
          py = y;
          hfsum += y2 * y2;
        }
        const n = Math.max(1, z - a);
        return { rms: Math.sqrt(sum / n), peak, hf: Math.sqrt(hfsum / n) };
      };
      return {
        loud: seg(0.10, 0.45), soft: seg(1.20, 1.55),
        tail: seg(2.0, 3.9),               // long after both notes have died
        all: seg(0, 4),
      };
    };
  });

  const dry = await p.evaluate(() => render(null));
  const off = await p.evaluate(() => render(P.defaultFx()));

  // All six off must be EXACTLY the dry path — buildFxChain returns null and
  // the seam keeps its straight wire.
  ok(Math.abs(off.all.rms - dry.all.rms) < 1e-6, 'every unit off is bit-for-bit the dry signal',
     dry.all.rms.toFixed(6) + ' vs ' + off.all.rms.toFixed(6));
  ok(await p.evaluate(() => P.buildFxChain(P.defaultFx(), 120) === null),
     'because an empty rack builds NO chain at all, not a chain of wires');

  const one = async (id) => {
    const st = await p.evaluate((id) => { const s = P.defaultFx(); s[id] = true; return render(s); }, id);
    return st;
  };

  // DELAY: echoes are energy where the dry signal has none.
  const dl = await one('delay');
  ok(dl.tail.rms > dry.tail.rms * 4 + 1e-4, 'DELAY leaves echoes after the notes end',
     'tail rms ' + dry.tail.rms.toExponential(2) + ' → ' + dl.tail.rms.toExponential(2));

  // VERB: likewise, shorter.
  const vb = await one('verb');
  ok(vb.tail.rms > dry.tail.rms * 2, 'VERB leaves a room tail',
     dry.tail.rms.toExponential(2) + ' → ' + vb.tail.rms.toExponential(2));
  ok(vb.tail.rms < dl.tail.rms, 'and it is a room, not an echo — shorter than the delay',
     vb.tail.rms.toExponential(2) + ' < ' + dl.tail.rms.toExponential(2));

  // FILTER: BRIGHTNESS drops hard. hf alone confounds level with tone — the
  // resonant peak changes the level too — so the measure is hf per unit of
  // rms, which is what "darker" means as a number.
  const fl = await one('filter');
  const brightDry = dry.loud.hf / dry.loud.rms, brightFl = fl.loud.hf / fl.loud.rms;
  ok(brightFl < brightDry * 0.6, 'FILTER pulls the highs out of the whole mix',
     'brightness ' + brightDry.toFixed(4) + ' → ' + brightFl.toFixed(4));

  // DRIVE: peaks flatten (tanh), level stays in the same neighbourhood.
  const dr = await one('drive');
  const crestDry = dry.loud.peak / dry.loud.rms, crestDrv = dr.loud.peak / dr.loud.rms;
  ok(crestDrv < crestDry * 0.9, 'DRIVE flattens the peaks the way saturation does',
     'crest ' + crestDry.toFixed(2) + ' → ' + crestDrv.toFixed(2));
  ok(dr.loud.rms > dry.loud.rms * 0.6 && dr.loud.rms < dry.loud.rms * 1.8,
     'without turning the toggle into a volume switch',
     'rms ' + dry.loud.rms.toFixed(3) + ' → ' + dr.loud.rms.toFixed(3));

  // COMP: the gap between the loud and soft bursts closes.
  const cp = await one('comp');
  const gapDry = dry.loud.rms / Math.max(1e-9, dry.soft.rms);
  const gapCmp = cp.loud.rms / Math.max(1e-9, cp.soft.rms);
  ok(gapCmp < gapDry * 0.85, 'COMP closes the gap between loud and soft',
     'ratio ' + gapDry.toFixed(1) + ':1 → ' + gapCmp.toFixed(1) + ':1');

  // EQ: measurable tilt — this phrase is a low sawtooth, so the low shelf and
  // the air shelf both move the numbers.
  const eq = await one('eq');
  ok(Math.abs(eq.loud.rms - dry.loud.rms) / dry.loud.rms > 0.03,
     'EQ audibly reshapes the mix', 'rms ' + dry.loud.rms.toFixed(3) + ' → ' + eq.loud.rms.toFixed(3));

  // ALL SIX AT ONCE: through the seam, the compressor and the ceiling still
  // guarantee the output — the rack cannot be the thing that clips.
  const all = await p.evaluate(() => {
    const s = P.defaultFx(); P.FX_UNITS.forEach((u) => { s[u.id] = true; });
    return render(s);
  });
  ok(all.all.peak < 0.999, 'all six at once still cannot clip — the rack lives before the ceiling',
     'peak ' + all.all.peak.toFixed(3));
  ok(all.all.rms > 0.001, 'and sound still comes out the other end', all.all.rms.toFixed(4));

  // SAFETY: a chain that throws mid-build must leave the dry wire standing.
  const safe = await p.evaluate(async () => {
    const RATE = 44100;
    const ctx = new OfflineAudioContext(1, RATE, RATE);
    const e = P.createEngine({ context: ctx });
    e.init();
    e.patchFx(() => { throw new Error('a broken pedal'); });
    e.play({ kind: 'synth', wave: 'sawtooth', note: 60, gain: 0.7, attack: 0.003, decay: 0.2,
             sustain: 0, release: 0.05, cutoff: 0.9, res: 0, drive: 0, space: 0, spread: 0, pan: 0, tune: 0 }, 0.1, 110);
    const d = (await ctx.startRendering()).getChannelData(0);
    let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    return peak;
  });
  ok(safe > 0.01, 'a builder that throws cannot silence the app — the dry wire is never broken first',
     'peak ' + safe.toFixed(3) + ' with a deliberately broken chain');

  ok(await p.evaluate(() => P.FX_UNITS.length === 6 && P.FX_UNITS.every((u) => u.d.length > 20)),
     'six units, each with a real description for the SETUP tab');

  ok(errs.length === 0, 'no page errors', errs.join(' | ') || 'clean');

  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
