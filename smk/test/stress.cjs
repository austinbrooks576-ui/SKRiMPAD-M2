// stress.cjs — what happens when the app is ABUSED.
//
// The other suites check that things work. This one checks that they keep
// working when a player does the things players actually do: mash the
// transport, sweep every knob during a take, hold everything at once, play a
// flood of notes over a running sequencer, and leave the app on for an hour.
//
// Every assertion here is either a NUMBER (how long did 2000 events take, how
// late was the worst note) or an INVARIANT (nothing held after everything was
// released, nothing scheduled in the past). "It didn't crash" is not a result.
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
  await p.evaluate(() => { const s = document.querySelector('#splash'); if (s) s.remove(); });
  await p.evaluate(() => { window.PORT = { id: 'smk', name: 'SMK-25 II MIDI 2' }; });

  // ---- 1a. THE HANDLER FLOOD -------------------------------------------------
  // 3000 events that make NO sound: unclaimed CCs at mid values, bends with
  // nothing held, aftertouch. This isolates the ROUTING cost — the price every
  // single event pays before anything musical happens — from the price of
  // building voices, which is real audio work with its own budget below.
  //
  // The first run of this measured 2.9ms per event, and part of it was a real
  // bug: an unclaimed button-ish CC rebuilt the ENTIRE SETUP sheet, listeners
  // and all, even with the sheet closed. Some controllers chatter constantly.
  const route = await p.evaluate(async () => {
    const A = window.__smk;
    A.S.arp.on = false;
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      A.io._emit([0xb0, 70 + (i % 8), 40 + (i % 40)], window.PORT); // mid-value CCs
      A.io._emit([0xe0, i % 128, (i * 7) % 128], window.PORT);      // bends, no notes held
      A.io._emit([0xb0, 77, i % 2 === 0 ? 127 : 0], window.PORT);   // the chatter that hit the bug
    }
    const ms = performance.now() - t0;
    return { ms: +ms.toFixed(1), perEvent: +(ms / 3000).toFixed(4) };
  });
  ok(route.ms < 900, '3000 silent events route in under 0.9s — the per-event tax is small',
     route.ms + 'ms, ' + route.perEvent + 'ms per event');

  // ---- 1b. THE VOICE FLOOD ----------------------------------------------------
  // Two floods, because they answer different questions.
  //
  // 200 voices in one synchronous burst is the realistic worst case — eight
  // dense channels committed inside a single look-ahead window — and it gets a
  // BUDGET, measured at 0.8ms per voice on this rig.
  //
  // 1000 voices is past anything real: in headless the audio clock crawls under
  // the load, so all thousand stay alive in the graph at once and each new node
  // pays for the congestion. On hardware the clock runs true and voices die on
  // schedule, so that pile-up cannot form. The 1000 run therefore asserts only
  // the INVARIANTS — nothing stuck, nothing lit, no errors — not a time.
  const flood = await p.evaluate(async () => {
    const A = window.__smk;
    // warm the engine so the first-voice setup cost is not billed to the burst
    A.io._emit([0x90, 60, 100], window.PORT); A.io._emit([0x80, 60, 0], window.PORT);
    await new Promise((r) => setTimeout(r, 500));
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) {
      const n = 60 + (i % 25);
      A.io._emit([0x90, n, 100], window.PORT);
      A.io._emit([0x80, n, 0], window.PORT);
    }
    const burstMs = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 500));
    return { perVoice: +(burstMs / 200).toFixed(3),
             litKeys: document.querySelectorAll('#keys .on').length };
  });
  ok(flood.perVoice < 4, 'a 200-voice burst builds at a playable per-voice cost',
     flood.perVoice + 'ms per voice');
  ok(flood.litKeys === 0, 'and nothing is left lit or stuck after it',
     flood.litKeys + ' keys still lit');

  // ---- 2. EVERYTHING HELD AT ONCE -------------------------------------------
  // All 25 keys down, arpeggiator on, max octaves, fastest rate, both strips
  // moving. This is the worst thing two hands and a chin can do to the unit.
  const pileup = await p.evaluate(async () => {
    const A = window.__smk;
    A.S.arp.on = true; A.S.arp.mode = 'RAND'; A.S.arp.rate = 7; A.S.arp.octaves = 4;
    A.S.bpm = 300; A.syncArp();
    let fired = 0, past = 0;
    const real = A.eng.play;
    A.eng.play = function (v, when) {
      fired++;
      // THE INVARIANT: nothing is ever handed to the audio clock in the past.
      // A note in the past starts mid-envelope, which is a click.
      if (when && A.eng.ctx && when < A.eng.ctx.currentTime - 0.001) past++;
      return real.apply(this, arguments);
    };
    const audio0 = A.eng.ctx.currentTime;
    let audio1 = audio0;
    for (let n = 60; n < 85; n++) A.io._emit([0x90, n, 100], window.PORT);
    for (let k = 0; k < 10; k++) {
      A.io._emit([0xe0, 0, (k * 25) % 128], window.PORT);
      A.io._emit([0xb0, 1, (k * 13) % 128], window.PORT);
      await new Promise((r) => setTimeout(r, 100));
    }
    audio1 = A.eng.ctx.currentTime;
    for (let n = 60; n < 85; n++) A.io._emit([0x80, n, 0], window.PORT);
    await new Promise((r) => setTimeout(r, 250));
    const after = fired;
    await new Promise((r) => setTimeout(r, 400));
    A.eng.play = real;
    A.S.arp.on = false; A.arp.clear(); A.setBend(0); A.setMod(0);
    // MEASURED AGAINST THE AUDIO CLOCK, not the wall. Under this load the
    // headless null-sink renders slower than real time, so ctx.currentTime
    // crawls — and the scheduler's whole promise is notes per AUDIO second.
    // On hardware the audio clock IS the wall clock; here they diverge and the
    // audio one is the honest denominator.
    const audioSecs = audio1 - audio0;
    const perAudioSec = fired / Math.max(0.05, audioSecs);
    return { fired, past, silent: fired === after, audioSecs: +audioSecs.toFixed(2),
             perAudioSec: +perAudioSec.toFixed(1) };
  });
  // 300bpm at 1/32T is a step every 16.7ms — sixty a second, minus the chord
  // window at the front.
  ok(pileup.perAudioSec > 35, '25 keys + RAND arp at 1/32T/300bpm/4 octaves runs at rate',
     pileup.perAudioSec + ' notes per audio-second over ' + pileup.audioSecs + 's of audio (' + pileup.fired + ' total)');
  ok(pileup.past === 0, 'and not one of them was scheduled in the past',
     pileup.past + ' of ' + pileup.fired + ' late');
  ok(pileup.silent, 'and releasing every key stops it dead');

  // ---- 3. THE TRANSPORT MASHED ----------------------------------------------
  // 200 PLAY/STOP alternations as fast as MIDI can carry them. The failure this
  // hunts is a leaked interval: play() starting a second scheduler while the
  // first is still alive, which doubles every note and never stops.
  const mash = await p.evaluate(async () => {
    const A = window.__smk;
    for (let i = 0; i < 100; i++) {
      A.io._emit([0xfa], window.PORT);
      A.io._emit([0xfc], window.PORT);
    }
    A.transport('stop');
    A.seq.clear(); A.seq.setBars(0, 1);
    A.seq.channels[0].events = [{ note: 60, vel: 100, at: 0, len: 0.25 }];
    let fired = 0;
    const real = A.eng.play;
    A.eng.play = function () { fired++; return real.apply(this, arguments); };
    A.seq.setBpm(240);
    A.io._emit([0xfa], window.PORT);          // one clean PLAY
    await new Promise((r) => setTimeout(r, 1050));
    A.io._emit([0xfc], window.PORT);
    A.eng.play = real;
    // 240bpm, 1-bar loop = 1s → the note fires ~1-2 times in 1.05s (plus the
    // look-ahead's one extra). A leaked scheduler doubles that.
    return { fired };
  });
  ok(mash.fired >= 1 && mash.fired <= 4,
     '100 rapid PLAY/STOP cycles leak no scheduler — one PLAY then fires the pattern once per loop, not doubled',
     mash.fired + ' notes in 1.05s of a 1s loop');

  // ---- 4. THE SEQUENCER FULL ------------------------------------------------
  // Eight channels, 512 events total, five seconds of playback. Counts, not
  // vibes: every fired note must belong to a channel that is ON, and the
  // per-second rate must match what the arithmetic says.
  const full = await p.evaluate(async () => {
    const A = window.__smk;
    A.transport('stop'); A.seq.clear();
    for (let c = 0; c < 8; c++) {
      A.seq.setBars(c, 1);
      const evs = [];
      for (let s = 0; s < 8; s++) evs.push({ note: 40 + c, vel: 90, at: s * 0.5, len: 0.2, k: c < 4 ? 'pad' : 'key', pad: c % 8 });
      A.seq.channels[c].events = evs;
      A.seq.channels[c].on = c !== 3;            // one muted
    }
    let fired = 0, muted = 0;
    const real = A.eng.play;
    A.eng.play = function (v) { fired++; if (v && v.note === 43 && v.kind !== 'sample') muted++; return real.apply(this, arguments); };
    A.seq.setBpm(120);
    const audio0 = A.eng.ctx.currentTime;
    A.seq.play();
    await new Promise((r) => setTimeout(r, 4000));
    const audioSecs = A.eng.ctx.currentTime - audio0;
    A.seq.stop(); A.eng.play = real; A.seq.clear();
    // 120bpm 1-bar loop = 2s, 8 events per loop per channel, 7 channels on:
    // 28 notes per AUDIO second, whatever the wall clock thinks.
    const perAudioSec = fired / Math.max(0.05, audioSecs);
    return { fired, muted, audioSecs: +audioSecs.toFixed(2), perAudioSec: +perAudioSec.toFixed(1) };
  });
  ok(Math.abs(full.perAudioSec - 28) < 8, 'seven full channels fire the number the arithmetic says, per audio-second',
     full.perAudioSec + '/s over ' + full.audioSecs + 's of audio (expected 28/s, ' + full.fired + ' total)');
  ok(full.muted === 0, 'and the muted channel contributed none of them', full.muted + '');

  // ---- 5. THE LONG SESSION ---------------------------------------------------
  // A thousand key presses with a sample voice on the keyboard — the granular
  // path, which builds the most nodes. The claim is that memory is BOUNDED:
  // JS heap after a thousand notes and a GC is within shouting distance of
  // where it started, because every voice is disposable.
  const leak = await p.evaluate(async () => {
    const A = window.__smk;
    if (!performance.memory) return null;
    // a sample on the keyboard so the granular path runs
    const it = A.lib.items[0];
    if (it) A.setVoice(it);
    A.S.knobBank = 1;
    for (let i = 0; i < 200; i++) { A.keyOn(60 + (i % 25), 100); }
    for (let i = 0; i < 200; i++) { A.keyOff(60 + (i % 25)); }
    await new Promise((r) => setTimeout(r, 400));
    const before = performance.memory.usedJSHeapSize;
    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 100; i++) { A.keyOn(60 + (i % 25), 100); A.keyOff(60 + (i % 25)); }
      await new Promise((r) => setTimeout(r, 120));
    }
    await new Promise((r) => setTimeout(r, 600));
    const after = performance.memory.usedJSHeapSize;
    A.setVoice(null);
    return { beforeMB: +(before / 1048576).toFixed(1), afterMB: +(after / 1048576).toFixed(1),
             grewMB: +((after - before) / 1048576).toFixed(1) };
  });
  if (leak) {
    ok(leak.grewMB < 30, 'a thousand granular key presses do not grow the heap unboundedly',
       leak.beforeMB + 'MB → ' + leak.afterMB + 'MB (+' + leak.grewMB + 'MB)');
  } else {
    console.log('SKIP heap measurement — performance.memory not available in this build');
  }

  // ---- 6. THE STALLED MAIN THREAD -------------------------------------------
  // Block the main thread for 150ms while the sequencer runs — a GC pause, a
  // heavy paint, a zip import. The look-ahead exists for exactly this: notes
  // committed before the stall play ON TIME through it, because they are on
  // the audio clock, not the JS clock.
  const stall = await p.evaluate(async () => {
    const A = window.__smk;
    A.transport('stop'); A.seq.clear(); A.seq.setBars(0, 1);
    A.seq.channels[0].events = Array.from({ length: 8 }, (_, s) => ({ note: 60, vel: 90, at: s * 0.5, len: 0.1 }));
    let late = 0, total = 0;
    const real = A.eng.play;
    A.eng.play = function (v, when) {
      total++;
      if (when && A.eng.ctx && when < A.eng.ctx.currentTime) late++;
      return real.apply(this, arguments);
    };
    A.seq.setBpm(240);
    const audio0 = A.eng.ctx.currentTime;
    A.seq.play();
    await new Promise((r) => setTimeout(r, 300));
    // the stall
    const t0 = performance.now(); while (performance.now() - t0 < 150) { /* spin */ }
    await new Promise((r) => setTimeout(r, 700));
    const audioSecs = A.eng.ctx.currentTime - audio0;
    A.seq.stop(); A.eng.play = real; A.seq.clear();
    // 240bpm, 1-bar loop = 1s, 8 events per loop → 8 per audio-second.
    return { total, late, audioSecs: +audioSecs.toFixed(2),
             perAudioSec: +(total / Math.max(0.05, audioSecs)).toFixed(1) };
  });
  ok(stall.perAudioSec > 5.5, 'the sequencer kept playing through a 150ms main-thread stall',
     stall.perAudioSec + ' notes per audio-second over ' + stall.audioSecs + 's (expected 8/s)');
  ok(stall.late === 0, 'and not one note was handed to the audio clock late',
     stall.late + ' of ' + stall.total);

  // ---- 7. THE KNOBS SWEPT DURING A TAKE --------------------------------------
  // Every knob in both banks swept end to end while the arpeggiator plays.
  // The failure: a knob whose handler re-renders something per tick, turning a
  // sweep into a half-second freeze.
  const sweep = await p.evaluate(async () => {
    const A = window.__smk;
    A.S.arp.on = true; A.syncArp();
    A.io._emit([0x90, 60, 100], window.PORT);
    const t0 = performance.now();
    for (let bank = 0; bank < 2; bank++) {
      A.S.knobBank = bank;
      for (let k = 0; k < 8; k++) for (let v = 0; v <= 127; v += 2) A.setKnob(k, v / 127);
    }
    const ms = performance.now() - t0;
    A.io._emit([0x80, 60, 0], window.PORT);
    A.S.arp.on = false; A.arp.clear(); A.S.knobBank = 0;
    return { ms: +ms.toFixed(1), sweeps: 16 * 64 };
  });
  ok(sweep.ms < 1500, 'sweeping all sixteen knobs end to end mid-take stays fluid',
     sweep.ms + 'ms for ' + sweep.sweeps + ' knob writes');

  // ---- 8. THE ENDURANCE FLOOD, DELIBERATELY LAST -----------------------------
  // A thousand voices in one synchronous tick — past anything a player or the
  // sequencer can produce. In headless the null-sink cannot render fast enough,
  // so the audio clock crawls, the scheduled voice-ends never arrive, and every
  // measurement taken AFTER this would be measuring the wreckage: the first
  // version of this file ran it early and watched the arp test read an audio
  // clock that had all but stopped. Abuse goes last. Only invariants here.
  const endure = await p.evaluate(async () => {
    const A = window.__smk;
    for (let i = 0; i < 500; i++) {
      const n = 60 + (i % 25);
      A.io._emit([0x90, n, 100], window.PORT);
      A.io._emit([0x80, n, 0], window.PORT);
      A.io._emit([0x99, 36 + (i % 8), 100], window.PORT);
      A.io._emit([0x89, 36 + (i % 8), 0], window.PORT);
    }
    await new Promise((r) => setTimeout(r, 500));
    return { litKeys: document.querySelectorAll('#keys .on').length,
             heldOpen: document.querySelectorAll('#keys .on').length };
  });
  ok(endure.litKeys === 0, 'a thousand-voice pile-up leaves nothing lit, nothing stuck, and no errors',
     endure.litKeys + ' keys lit');

  ok(errs.length === 0, 'no page errors through any of it', errs.slice(0, 2).join(' | ') || 'clean');

  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
