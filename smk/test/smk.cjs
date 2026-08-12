// smk.cjs — SKRiMPAD SMK, the app that only speaks to an M-VAVE SMK-25.
//
// The bulk of this is the TRANSPORT, because that is the thing that was asked
// for and because it is the part with no standard behind it. The same three
// buttons on the same keyboard send one of four completely different things
// depending on how the unit was configured, and every one of them has to land.
//
// Everything else here guards a claim the app makes on screen: 25 keys, 2x4
// pads with DP1 top-left, two banks of each, and CLEAR ALL meaning all.
const { chromium } = require('playwright-core');
const path = require('path');
const U = 'file://' + path.resolve(__dirname, '..', 'dist', 'index.html');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(U);
  await p.waitForFunction(() => !!window.__smk, null, { timeout: 15000 });
  // Past the splash, which is a real feature and therefore really in the way.
  await p.evaluate(() => { const s = document.querySelector('#splash'); if (s) s.remove(); });

  // A port that identifies as the unit. Everything is routed by unit, not by
  // port name, because the SMK-25 publishes three ports over USB.
  await p.evaluate(() => { window.PORT = { id: 'smk', name: 'SMK-25 II MIDI 2' }; });

  ok(await p.evaluate(() => !!window.__smk), 'it boots');

  // ---- the shape of the thing ---------------------------------------------
  const shape = await p.evaluate(() => ({
    keys: document.querySelectorAll('#keys .kw, #keys .kk').length,
    pads: document.querySelectorAll('.pad').length,
    firstPad: (document.querySelector('.pad') || {}).textContent || '',
    knobs: document.querySelectorAll('.knob').length,
  }));
  ok(shape.keys === 25, 'twenty-five keys, because the unit has twenty-five', shape.keys + '');
  ok(shape.pads === 8, 'eight pads — a 2x4 block, not sixteen', shape.pads + '');
  ok(/DP1/.test(shape.firstPad), 'and DP1 is the first of them, top-left', JSON.stringify(shape.firstPad.slice(0, 12)));
  ok(shape.knobs === 8, 'eight knobs', shape.knobs + '');

  // The pads must be square at any window size. This is here because the JP
  // edition shipped pads that were only square at the test's own viewport —
  // height:100% beat aspect-ratio:1 and every phone got portrait rectangles.
  const squares = [];
  for (const [w, h] of [[380, 720], [820, 1180], [1400, 900], [600, 900]]) {
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(60);
    squares.push(await p.evaluate(() => {
      const r = document.querySelector('.pad').getBoundingClientRect();
      return +(r.width / r.height).toFixed(2);
    }));
  }
  await p.setViewportSize({ width: 1100, height: 900 });
  ok(squares.every((r) => Math.abs(r - 1) < 0.22), 'pads stay square at every window size', squares.join(' '));

  // ---- THE TRANSPORT ------------------------------------------------------
  // Four standards, one at a time.
  //
  // WHAT IS BEING MEASURED, and why it is not the looper's state. An untouched
  // looper reports 'empty' whatever you do to it, so an assertion like "the
  // state is no longer stopped" passes on an app that ignored the message
  // completely. It did, in the first run of this file — five hollow passes. So
  // the app records which transport command it acted on and how it arrived, and
  // that is what gets checked. It is also what SETUP shows, so the test and the
  // screen are reading the same fact.
  // The sequence number is what stops a case from inheriting the previous
  // case's answer — the same mistake in a different costume. A case that
  // changed nothing reports 'nothing' even though the latch still holds
  // whatever fired last.
  const T = async (bytes) => p.evaluate(async (msgs) => {
    const A = window.__smk;
    A.transport('stop');
    const was = (A.lastTransport && A.lastTransport.seq) || 0;
    msgs.forEach((m) => A.io._emit(m, window.PORT));
    await new Promise((r) => setTimeout(r, 40));
    const t = A.lastTransport;
    const fired = t && t.seq > was;
    return { got: fired ? t.name + '/' + t.how : 'nothing',
             times: t ? t.seq - was : 0, state: A.loop.info.state };
  }, bytes);

  // 1. System real-time. FA start, FB continue, FC stop.
  let r = await T([[0xfa]]);
  ok(r.got === 'play/realtime', 'real-time FA (start) is PLAY', r.got);
  r = await T([[0xfc]]);
  ok(r.got === 'stop/realtime', 'real-time FC is STOP', r.got);

  // 2. MMC over SysEx — what the unit sends OUT OF THE BOX, and the reason
  // these buttons look dead in a DAW that never asked for SysEx permission.
  r = await T([[0xf0, 0x7f, 0x7f, 0x06, 0x02, 0xf7]]);
  ok(r.got === 'play/mmc', 'MMC play (F0 7F 7F 06 02 F7) is PLAY', r.got);
  // ...and addressed to a device ID rather than the 7F broadcast, because a
  // unit that has been given an ID sends that instead, and insisting on the
  // broadcast would make the same button work on one keyboard and not the next.
  r = await T([[0xf0, 0x7f, 0x03, 0x06, 0x02, 0xf7]]);
  ok(r.got === 'play/mmc', 'MMC play addressed to device 3, not the broadcast ID', r.got);
  r = await T([[0xf0, 0x7f, 0x7f, 0x06, 0x01, 0xf7]]);
  ok(r.got === 'stop/mmc', 'MMC stop (cmd 01) is STOP', r.got);
  r = await T([[0xf0, 0x7f, 0x7f, 0x06, 0x06, 0xf7]]);
  ok(r.got === 'rec/mmc' && (r.state === 'armed' || r.state === 'recording'),
     'MMC record (cmd 06) is REC, and the recorder actually arms', r.got + ' → ' + r.state);

  // 3. Mackie Control notes — what the unit sends in DAW mode.
  r = await T([[0x90, 0x5e, 0x7f]]);
  ok(r.got === 'play/mackie', 'Mackie note 94 (0x5E) is PLAY', r.got);
  r = await T([[0x90, 0x5d, 0x7f]]);
  ok(r.got === 'stop/mackie', 'Mackie note 93 (0x5D) is STOP', r.got);
  r = await T([[0x90, 0x5f, 0x7f]]);
  ok(r.got === 'rec/mackie', 'Mackie note 95 (0x5F) is REC', r.got);

  // 4. Plain CC — where owners land after reconfiguring with M-VAVE's own
  // CubeSuite editor. CC 117 at value 127 is the reported working setting.
  r = await T([[0xb0, 117, 127]]);
  ok(r.got === 'play/cc', 'CC 117 = 127 is PLAY, the CubeSuite default', r.got);
  r = await T([[0xb0, 94, 127]]);
  ok(r.got === 'play/cc', 'CC 94 = 127 is PLAY too — the other number owners report', r.got);
  r = await T([[0xb0, 119, 127]]);
  ok(r.got === 'rec/cc', 'CC 119 = 127 is REC', r.got);

  // A knob sweeping THROUGH a transport CC must not fire it. Encoders send
  // every value on the way past, and a transport that triggers at 64 would
  // start playback in the middle of a filter sweep.
  r = await T([[0xb0, 117, 40], [0xb0, 117, 64], [0xb0, 117, 90]]);
  ok(r.got === 'nothing', 'a CC swept through its middle is not a button press', r.got);

  // The RELEASE must be swallowed, not acted on twice. A button that toggles
  // play on press and again on release does nothing at all.
  r = await T([[0xb0, 117, 127], [0xb0, 117, 0]]);
  ok(r.got === 'play/cc' && r.times === 1, 'press-then-release is ONE play, not two',
     r.got + ' × ' + r.times);
  // Same for a Mackie note: the note-off must be claimed and dropped.
  r = await T([[0x90, 0x5e, 0x7f], [0x80, 0x5e, 0]]);
  ok(r.got === 'play/mackie' && r.times === 1, 'a Mackie note-off does not fire it a second time',
     r.got + ' × ' + r.times);

  // A transport note must never leak through and sound. Mackie note 94 is
  // inside the range a 25-key keyboard can reach with the octave up.
  const leaked = await p.evaluate(async () => {
    const A = window.__smk;
    A.transport('stop');
    const before = document.querySelectorAll('#keys .on').length;
    A.io._emit([0x90, 0x5e, 0x7f], window.PORT);
    A.io._emit([0x80, 0x5e, 0], window.PORT);
    await new Promise((r) => setTimeout(r, 30));
    return { before, after: document.querySelectorAll('#keys .on').length };
  });
  ok(leaked.after === leaked.before, 'a Mackie transport note does not also play a note',
     leaked.before + ' → ' + leaked.after);

  // ---- and a guess must never beat something the user taught ---------------
  // CC 94 is a real GM controller as well as a transport button. If it has been
  // learned as a knob, it stays a knob — otherwise teaching the app would make
  // it worse, which is the opposite of the point.
  const claimed = await p.evaluate(async () => {
    const A = window.__smk;
    const key = A.unit.unitKey(window.PORT.name);
    A.unit.teachKnob(key, A.S.knobBank, 0, 94, 0);
    A.transport('stop');
    const was = (A.lastTransport && A.lastTransport.seq) || 0;
    const k0 = A.S.knob[A.S.knobBank * 8];
    A.io._emit([0xb0, 94, 127], window.PORT);
    await new Promise((r) => setTimeout(r, 40));
    const out = { fired: !!(A.lastTransport && A.lastTransport.seq > was),
                  moved: A.S.knob[A.S.knobBank * 8] !== k0 };
    A.unit.reset(key);
    return out;
  });
  ok(claimed.moved && !claimed.fired,
     'a CC taught to a knob stays a knob — the transport guess loses',
     'knob moved: ' + claimed.moved + ', transport fired: ' + claimed.fired);

  // ---- an unrecognised button is REPORTED, not swallowed -------------------
  const seen = await p.evaluate(async () => {
    const A = window.__smk;
    A.io._emit([0xb0, 46, 127], window.PORT);     // a CC nothing knows
    await new Promise((r) => setTimeout(r, 30));
    A.renderSetup();
    return document.querySelector('#setupbody').textContent;
  });
  ok(/CC 46 = 127/.test(seen), 'a CC nobody claimed is shown in SETUP, so it can be taught',
     (seen.match(/Last unrecognised message: [^—]+/) || ['not shown'])[0].trim());
  ok(/MMC over SysEx/.test(seen), 'and SETUP explains why these buttons usually appear dead');

  // ---- the arpeggiator actually runs --------------------------------------
  // arp.cjs proves the maths. This proves the app reaches for it — which is a
  // different failure, and the one that was true until now: the ARP rail and
  // all twelve rhythms were displayed and set, and nothing ever ran them.
  const arpRan = await p.evaluate(async () => {
    const A = window.__smk;
    A.transport('stop');
    A.S.arp.on = true; A.S.arp.mode = 'UP'; A.S.arp.rate = 4; A.S.bpm = 120;
    A.S.arp.rhythm = ''; A.S.arp.latch = false;
    A.syncArp();
    const fired = [];
    const real = A.eng.play;
    A.eng.play = function (v, when, vel) { fired.push({ note: v.note, when }); return real.apply(this, arguments); };
    A.keyOn(60, 100); A.keyOn(64, 100); A.keyOn(67, 100);
    await new Promise((r) => setTimeout(r, 700));
    const running = A.arp.running;
    A.keyOff(60); A.keyOff(64); A.keyOff(67);
    await new Promise((r) => setTimeout(r, 250));
    const after = fired.length;
    await new Promise((r) => setTimeout(r, 300));
    A.eng.play = real;
    A.S.arp.on = false; A.arp.clear();
    return { count: fired.length, order: fired.slice(0, 6).map((f) => f.note).join(' '),
             running, settled: fired.length === after };
  });
  ok(arpRan.count >= 4, 'with ARP on, holding keys actually produces notes',
     arpRan.count + ' notes in 0.7s at 120bpm 1/16');
  ok(arpRan.running === true, 'and the arpeggiator reports itself running');
  ok(/^60 64 67/.test(arpRan.order), 'in the order UP means — and the chord is complete from the first step',
     arpRan.order);
  ok(arpRan.settled, 'and letting go of every key stops it dead');

  // ---- CLEAR ALL means all ------------------------------------------------
  const cleared = await p.evaluate(async () => {
    const A = window.__smk;
    A.S.keys[60] = { id: 'x', name: 'a' };
    A.S.pads[0][0] = { id: 'y', name: 'b' };
    A.S.pads[1][3] = { id: 'z', name: 'c' };
    A.clearAll(); A.clearAll();                     // it arms, then wipes
    return {
      keys: Object.keys(A.S.keys).filter((k) => A.S.keys[k]).length,
      pads: A.S.pads.flat().filter(Boolean).length,
    };
  });
  ok(cleared.keys === 0 && cleared.pads === 0, 'CLEAR ALL wipes both pad banks AND every individually set key',
     cleared.keys + ' keys, ' + cleared.pads + ' pads left');

  ok(errs.length === 0, 'no page errors', errs.join(' | ') || 'clean');

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
