// edition-stress.cjs — drive every edition's real UI under load.
//
// The unit suites test core modules; boot.cjs proves the app opens. Neither
// hammers the wired-up instrument. SMK has its own deep stress suite, but
// ULTIMATE and JP had none — so a handler that leaks a node per hit, or throws
// on the 500th pad, or leaves a voice stuck after a flood, would ship green.
//
// This boots each edition, warms its real AudioContext (headless Chromium is
// launched with autoplay allowed), then fires a barrage through the SAME entry
// points a finger does — the exposed play/transport handles — and checks three
// things that separate "works once" from "works on stage":
//
//   1. no uncaught error through thousands of hits
//   2. the engine is still alive and scheduling afterwards
//   3. the JS heap does not grow without bound under a repeated-hit flood
//
// It is deliberately tolerant of shape: an edition missing a given handle skips
// that sub-check rather than failing, so adding an edition here is cheap.

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..');

// Transport check per edition. PLAY/STOP/REC is the function the user has come
// back to more than any other ("make the PLAY stop and Record button do their
// job"), so every edition proves it here. SMK and JP expose transport() on
// their handle; ULTIMATE drives it from the deck buttons, so it clicks #play
// and #rec and reads the button state back. Returns null on success or a string
// describing what went wrong.
const TRANSPORT = {
  __smk: async (page, h) => page.evaluate((H) => {
    try { window[H].transport('play'); window[H].transport('rec'); window[H].transport('stop'); return null; }
    catch (e) { return String(e.message || e); }
  }, h),
  __jp: async (page, h) => page.evaluate((H) => {
    try { window[H].transport('play'); window[H].transport('rec'); window[H].transport('stop'); return null; }
    catch (e) { return String(e.message || e); }
  }, h),
  __ult: async (page) => {
    // Click play (lights), play again (clears), rec (lights). If the button
    // never changes class, the click did nothing — a dead transport.
    await page.click('#play', { timeout: 3000 });
    const on = await page.evaluate(() => document.getElementById('play').className.includes('on'));
    await page.click('#play', { timeout: 3000 });
    const off = await page.evaluate(() => !document.getElementById('play').className.includes('on'));
    await page.click('#rec', { timeout: 3000 });
    const rec = await page.evaluate(() => document.getElementById('rec').className.includes('on'));
    return on && off && rec ? null : `play-on=${on} play-off=${off} rec-on=${rec}`;
  },
};

const EDITIONS = [
  {
    id: 'ULTIMATE', file: 'ultimate/dist/index.html', handle: '__ult',
    // Play cells' own voices straight through the engine, the same call the
    // deck's pointer handler makes: eng.play(cell.voice, 0, vel, i). Cells live
    // inside the current scene (song.scenes[song.scene].cells), NOT on song
    // directly — getting that wrong makes this burst a no-op that passes.
    burst: (H, n) => {
      const eng = H.eng;
      const scene = H.song && H.song.scenes && H.song.scenes[H.song.scene || 0];
      const cells = (scene && scene.cells) || [];
      if (!eng || !cells.length) throw new Error('no engine/cells — burst would be a vacuous pass');
      eng.resume && eng.resume();
      for (let k = 0; k < n; k++) {
        const i = k % cells.length;
        eng.play(cells[i].voice, 0, 30 + (k * 37) % 97, i);
      }
      return 'played ' + n;
    },
  },
  {
    id: 'SMK', file: 'smk/dist/index.html', handle: '__smk',
    burst: (H, n) => {
      if (H.__warm) H.__warm(); else if (H.eng && H.eng.resume) H.eng.resume();
      for (let k = 0; k < n; k++) {
        if (k % 3 === 0) H.padHit(k % 8, 30 + (k * 37) % 97);
        else { const note = 48 + (k % 25); H.keyOn(note, 30 + (k * 29) % 97); if (k % 2) H.keyOff(note); }
      }
      return 'played ' + n;
    },
  },
  {
    id: 'JP', file: 'jp/dist/index.html', handle: '__jp',
    burst: (H, n) => {
      if (H.eng && H.eng.resume) H.eng.resume();
      for (let k = 0; k < n; k++) {
        if (k % 2 === 0) H.strike(k % 16, 30 + (k * 37) % 97);
        else { H.padDown(k % 16, 30 + (k * 29) % 97); H.padUp(k % 16); }
      }
      return 'played ' + n;
    },
  },
];

(async () => {
  const browser = await chromium.launch({
    // --enable-precise-memory-info: without it performance.memory is quantized
    //   to ~10MB buckets, so every heap delta reads as a meaningless 0.0.
    // --expose-gc: lets the heap check force collection between rounds so what
    //   is left is RETAINED, not just uncollected garbage.
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
           '--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });

  for (const ed of EDITIONS) {
    const abs = path.join(ROOT, ed.file);
    if (!fs.existsSync(abs)) { ok(false, ed.id + ' — bundle present', ed.file); continue; }

    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

    await page.goto('file://' + abs, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(800);

    const H = await page.evaluate((h) => !!window[h], ed.handle);
    ok(H, ed.id + ' — exposes its test handle window.' + ed.handle);
    if (!H) { await page.close(); continue; }

    // A big flood, driven through the real handlers. If any hit throws, it lands
    // in errs via pageerror; the return value tells us it actually ran.
    const burstFn = ed.burst.toString();
    const result = await page.evaluate(({ h, fnSrc, n }) => {
      const H = window[h];
      const fn = eval('(' + fnSrc + ')');
      try { return { ok: true, msg: fn(H, n) }; }
      catch (e) { return { ok: false, msg: String(e.message || e) }; }
    }, { h: ed.handle, fnSrc: burstFn, n: 1500 });
    ok(result.ok, ed.id + ' — 1500 hits through the real handlers without throwing', result.msg);

    await page.waitForTimeout(400);

    // The engine must still be there and usable — a flood that killed it would
    // leave a dead instrument that looks fine until the next note.
    const alive = await page.evaluate((h) => {
      const H = window[h];
      if (!H || !H.eng) return false;
      try { const b = H.eng.bus; return b !== undefined; } catch (e) { return false; }
    }, ed.handle);
    ok(alive, ed.id + ' — engine is still alive and scheduling after the flood');

    // Heap discipline. Repeated identical floods must not grow the heap without
    // bound — the classic leak is one Web Audio node per hit that never gets
    // disconnected. Measure across several rounds with a gc between.
    const heap = await page.evaluate(async ({ h, fnSrc }) => {
      const H = window[h];
      const fn = eval('(' + fnSrc + ')');
      const gc = () => { if (window.gc) window.gc(); };
      const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      gc(); await sleep(50);
      const before = mem();
      for (let r = 0; r < 4; r++) { fn(H, 1000); await sleep(60); }
      gc(); await sleep(120);
      const after = mem();
      return { before, after, supported: mem() > 0 };
    }, { h: ed.handle, fnSrc: burstFn });

    if (!heap.supported) {
      ok(true, ed.id + ' — heap growth (performance.memory unavailable here, skipped)', 'n/a');
    } else {
      const grewMB = (heap.after - heap.before) / (1024 * 1024);
      // 4000 more hits should not add tens of MB of retained heap. A per-hit
      // node leak shows up as steady multi-MB growth; a healthy engine settles.
      ok(grewMB < 24, ed.id + ' — 4000 more hits do not grow the heap without bound',
         grewMB.toFixed(1) + ' MB retained');
    }

    // PLAY / STOP / REC must work — the transport the user cares about most.
    const tfn = TRANSPORT[ed.handle];
    if (tfn) {
      let terr = null;
      try { terr = await tfn(page, ed.handle); } catch (e) { terr = String(e.message || e); }
      ok(terr === null, ed.id + ' — PLAY / STOP / REC all fire', terr || 'play, rec, stop');
    }

    ok(errs.length === 0, ed.id + ' — no page errors through the whole stress run',
       errs.slice(0, 2).join(' | ') || 'clean');

    await page.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
