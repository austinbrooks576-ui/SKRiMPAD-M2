// ultimate.cjs — the core of SKRiMPAD ULTIMATE, checked in the repo.
//
// THIS FILE EXISTS BECAUSE THE LAST SET DID NOT. Six hundred assertions lived
// in a scratch directory outside the repository, and a container restart took
// every one of them. The app survived because it was pushed; the tests did not
// because they were not. A test that is not committed is a test you have once.
//
// What it covers: the app boots and makes sound, the control surface stays
// small, every scene action still works and now works on ANY scene, the key
// fold cannot produce an out-of-key note, a genre writes a whole song, and the
// MIDI chain does not leave notes ringing when a controller vanishes.
const { chromium } = require('playwright-core');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..', 'dist', 'index.html');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.ULT_CHROME || undefined,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const p = await b.newPage({ viewport: { width: 1280, height: 880 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(U, { waitUntil: 'load' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(700);

  ok(errs.length === 0, 'it boots clean', errs.slice(0, 2).join(' / '));
  const boot = await p.evaluate(() => ({
    cells: document.querySelectorAll('.cell').length,
    dots: document.querySelectorAll('.rdot').length,
    scenes: window.__ult.song.scenes.length,
  }));
  ok(boot.cells === 16 && boot.dots === 5 && boot.scenes === 4,
     'sixteen cells, five altitudes, four scenes',
     boot.cells + '/' + boot.dots + '/' + boot.scenes);

  // ---- THE CONTROL SURFACE, counted ---------------------------------------
  // A surface creeps back one convenient addition at a time. A number in a test
  // is the only thing that stops it.
  const surface = await p.evaluate(async () => {
    window.__ult.atlas.goTo(0, 0);
    await new Promise((r) => setTimeout(r, 500));
    return {
      console: document.querySelectorAll('#console button, #console input').length,
      underCons: document.querySelectorAll('.consbot button').length,
      sceneOpsGone: !document.getElementById('sclear')
        && !document.getElementById('scopy') && !document.getElementById('sbounce'),
    };
  });
  ok(surface.console <= 8, 'the transport holds no more than eight controls',
     surface.console + ' controls');
  ok(surface.underCons <= 5, 'and the constellation no more than five under it',
     surface.underCons + ' buttons — four scenes and the view');
  ok(surface.sceneOpsGone,
     'CLEAR, COPY and EXPORT are no longer three permanent buttons');

  // ---- ...but everything they did still works, on ANY scene ---------------
  const menu = await p.evaluate(async () => {
    const A = window.__ult;
    const pill = document.querySelectorAll('.spill')[2];      // SCENE 3, not the live one
    const r = pill.getBoundingClientRect();
    pill.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: r.left + 6, clientY: r.top + 6 }));
    await new Promise((z) => setTimeout(z, 160));
    const m = document.querySelector('.menu');
    return { open: !!m, title: m && m.getAttribute('aria-label'),
             rows: m ? [...m.querySelectorAll('.mitem')].map((x) => x.textContent) : [] };
  });
  ok(menu.open, 'holding a scene pill opens what you can do to it');
  ok(/SCENE 3/i.test(menu.title || ''), 'named for the scene you held, not the live one',
     menu.title);
  const wanted = ['Copy it to', 'Export it', 'Clear it'];
  const lost = wanted.filter((w) => !menu.rows.some((r) => r.includes(w)));
  ok(lost.length === 0, 'with copy, export and clear all still there',
     lost.join(', ') || menu.rows.length + ' rows');

  // Clearing scene 3 must clear SCENE 3 — the whole reason this is better than
  // the button it replaces.
  const cleared = await p.evaluate(async () => {
    const A = window.__ult;
    document.body.click();                                    // dismiss the menu
    await new Promise((z) => setTimeout(z, 120));
    A.song.scenes[2].cells[0].steps[0] = 99;
    A.song.scenes[0].cells[0].steps[0] = 88;
    const live = A.song.scene;
    A.sceneClear(2);
    await new Promise((z) => setTimeout(z, 120));
    return { three: A.song.scenes[2].cells[0].steps[0],
             one: A.song.scenes[0].cells[0].steps[0], live, stillLive: A.song.scene };
  });
  ok(cleared.three === 0 && cleared.one === 88,
     'and clearing scene 3 clears scene 3 — not whichever one is playing',
     'scene3=' + cleared.three + ' scene1=' + cleared.one);
  ok(cleared.live === cleared.stillLive, 'without switching you to it');

  const copied = await p.evaluate(async () => {
    const A = window.__ult;
    A.song.scenes[1].cells.forEach((c) => c.steps.fill(0));
    A.song.scenes[0].cells[3].steps[5] = 77;
    A.sceneCopy(0);
    await new Promise((z) => setTimeout(z, 120));
    return { to: A.song.scenes[1].cells[3].steps[5], name: A.song.scenes[1].name };
  });
  ok(copied.to === 77 && /SCENE 2/i.test(copied.name),
     'copy still lands in the next scene, which keeps its own name',
     copied.name + ' got ' + copied.to);

  // ---- SOUND ---------------------------------------------------------------
  const heard = await p.evaluate(async () => {
    const A = window.__ult;
    A.eng.init();
    const oc = new OfflineAudioContext(1, 44100, 44100);
    const eng = window.__ultMakeEngine({ context: oc });
    eng.play(A.song.scenes[0].cells[0].voice, 0, 110);
    const d = (await oc.startRendering()).getChannelData(0);
    let peak = 0, first = 0;
    for (let i = 0; i < d.length; i++) { if (!first && d[i] !== 0) first = Math.abs(d[i]); peak = Math.max(peak, Math.abs(d[i])); }
    return { peak: +peak.toFixed(4), first: +first.toFixed(5) };
  });
  ok(heard.peak > 0.01, 'a pad makes sound', 'peak ' + heard.peak);
  ok(heard.first < heard.peak * 0.05, 'and starts from silence rather than clicking',
     'first sample ' + heard.first);

  // ---- THE KEY -------------------------------------------------------------
  const sweep = await p.evaluate(() => {
    const H = window.__ultHarmony;
    let bad = 0, n = 0;
    for (const mode of Object.keys(H.MODES)) {
      for (let root = 0; root < 12; root++) {
        const iv = H.MODES[mode].iv;
        for (let x = 0; x < 128; x++) {
          const f = H.foldNote(x, { root, mode, fold: true });
          if (!iv.includes(((f - root) % 12 + 12) % 12)) bad++;
          if (Math.abs(f - x) > 2) bad++;
          n++;
        }
      }
    }
    return { bad, n };
  });
  ok(sweep.bad === 0, 'no note in any key in any mode folds out of the scale',
     sweep.n + ' folds swept');

  // ---- GENRES --------------------------------------------------------------
  const genre = await p.evaluate(() => {
    const A = window.__ult;
    const rows = A.genreMenu().filter((i) => i.items).flatMap((f) => f.items);
    const H = window.__ultHarmony;
    let bad = 0, pitched = 0;
    for (const row of rows) {
      row.run();
      const key = A.song.key, iv = H.MODES[key.mode].iv;
      A.song.scenes.forEach((sc) => sc.cells.forEach((c) => {
        if (!c.notes || c.voice.kind === 'drum') return;
        for (let x = 0; x < 16; x++) {
          if (!c.steps[x] || !c.notes[x]) continue;
          const base = c.voice.note || 60;
          if (!iv.includes(((base + c.notes[x] - key.root) % 12 + 12) % 12)) bad++;
          pitched++;
        }
      }));
    }
    return { n: rows.length, bad, pitched };
  });
  ok(genre.n === 34, 'all thirty-four genres are reachable', genre.n);
  ok(genre.bad === 0 && genre.pitched > 100,
     'and every note they write is in the key they set',
     genre.pitched + ' pitched steps, ' + genre.bad + ' out of key');

  // ---- MIDI: a controller that vanishes -----------------------------------
  const stuck = await p.evaluate(async () => {
    const A = window.__ult;
    A.eng.init();
    A.atlas.goTo(1, 0);
    await new Promise((r) => setTimeout(r, 250));
    const wired = { id: 'w', name: 'Test Keystation 49' };
    const air = { id: 'a', name: 'Test SMK-25 BLE' };
    A.io._emit([0x90, 60, 100], wired);
    A.io._emit([0x91, 67, 100], air);
    await new Promise((r) => setTimeout(r, 120));
    const both = A.keys.voices;
    A.io._gone(air, 'link dropped');
    await new Promise((r) => setTimeout(r, 150));
    const after = A.keys.voices;
    A.io._emit([0x80, 60, 0], wired);
    await new Promise((r) => setTimeout(r, 120));
    return { both, after, end: A.keys.voices };
  });
  ok(stuck.both === 2 && stuck.after === 1,
     'a controller dropping out releases only its own notes',
     stuck.both + ' → ' + stuck.after);
  ok(stuck.end === 0, 'and the one still plugged in still releases its own');

  // ---- HELP: the standing rule -------------------------------------------
  const help = await p.evaluate(() => {
    document.getElementById('gear').click();
    const txt = document.getElementById('helpbody').textContent;
    const ids = [...document.querySelectorAll('button[id], input[id]')]
      .map((e) => e.id)
      .filter((id) => !/^(helpx|midix|shelfx|resetall|rescan)$/.test(id));
    return { txt, ids };
  });
  const undocumented = help.ids.filter((id) => !help.txt.includes('#' + id) && !new RegExp(id, 'i').test(help.txt));
  ok(help.txt.length > 2000, 'the manual is in the app', help.txt.length + ' characters');

  ok(errs.length === 0, 'no page errors throughout', errs.slice(0, 3).join(' / '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
