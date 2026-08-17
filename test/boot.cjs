// boot.cjs — every shipped bundle actually opens.
//
// A green unit suite proves the modules are correct in isolation. It does not
// prove the bundle boots: a bundler can drop a file, a top-level throw can blank
// the screen, an edition with no suite at all (LIVEx, the consumer bundle) can
// rot unnoticed. This loads each dist/index.html the way a phone does — from
// file://, no network — and fails on the first uncaught error or empty screen.
//
// It tests the ARTIFACT, not the source. That is the whole point: the thing that
// reaches a device is the built html, and until now nothing checked that it runs.

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..');

// Each edition: its bundle, and a DOM marker that proves the real app painted
// rather than an error page or a blank body. Markers are things the app cannot
// boot without.
//
// These are the four editions whose source lives on this branch. The consumer
// M2/SE/VGA editions live on main and are not built here. Note there is NO entry
// for android/app/src/main/assets/index.html — that path is a STAGING SLOT the
// APK workflows overwrite per edition (`cp <edition>/dist/index.html` into it),
// so whatever sits there is a copy of one of the four below, not an edition of
// its own. Testing it would just be testing one of these twice.
const EDITIONS = [
  { id: 'ULTIMATE', file: 'ultimate/dist/index.html', needs: ['canvas', '#deck'] },
  { id: 'SMK',      file: 'smk/dist/index.html',      needs: ['#app', '.pad, [class*="pad"], #pads'] },
  { id: 'JP',       file: 'jp/dist/index.html',       needs: ['#grid'] },
  { id: 'LIVEx',    file: 'livex/dist/index.html',    needs: ['#app', '#mappads', '#transport'] },
];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });

  for (const ed of EDITIONS) {
    const abs = path.join(ROOT, ed.file);
    if (!fs.existsSync(abs)) { ok(false, ed.id + ' — bundle exists', ed.file + ' missing'); continue; }

    const size = fs.statSync(abs).size;
    ok(size > 5000, ed.id + ' — bundle is a real file, not a stub', (size / 1024).toFixed(0) + ' KB');

    // Self-contained: an APK/desktop bundle runs from file:// with no server, so
    // a stray ./core/x.js or an https CDN link opens to a blank screen.
    const html = fs.readFileSync(abs, 'utf8');
    const ext = html.match(/<(?:script[^>]+src|link[^>]+href)="(\.\/|https?:\/\/)[^"]+"/i);
    ok(!ext, ed.id + ' — no external file/CDN references (boots offline)', ext ? ext[0] : 'self-contained');

    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

    try {
      await page.goto('file://' + abs, { waitUntil: 'load', timeout: 20000 });
      // Give the app a beat to run its boot code, register handlers, first paint.
      await page.waitForTimeout(1200);

      for (const sel of ed.needs) {
        const n = await page.locator(sel).count().catch(() => 0);
        ok(n > 0, ed.id + ' — booted: found ' + sel, n + ' node(s)');
      }

      // A booted app paints something with real size. A blank/error screen does
      // not. Checks the body actually filled the viewport.
      const painted = await page.evaluate(() => {
        const b = document.body;
        if (!b) return { w: 0, h: 0, kids: 0 };
        const r = b.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), kids: b.querySelectorAll('*').length };
      });
      ok(painted.w > 200 && painted.h > 200 && painted.kids > 20,
         ed.id + ' — painted a real interface', `${painted.w}×${painted.h}, ${painted.kids} nodes`);

      ok(errs.length === 0, ed.id + ' — no page errors on boot', errs.slice(0, 2).join(' | ') || 'clean');
    } catch (e) {
      ok(false, ed.id + ' — page loaded without throwing', String(e.message || e).slice(0, 120));
    }
    await page.close();
  }

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
