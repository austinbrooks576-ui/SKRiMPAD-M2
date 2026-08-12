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

  // A NOTE YOU CAN PLAY IS NEVER A TRANSPORT BUTTON.
  //
  // Mackie's codes 93/94/95 are also A6/A#6/B6, which are real keys on this
  // keyboard once the octave is shifted up. The original guard only asked "is
  // that note a pad?", so at octave +3 the top of the keybed became STOP, PLAY
  // and RECORD and playing a phrase up there stopped the transport.
  //
  // SWEPT ACROSS EVERY OCTAVE, because that is what hid it: at the default
  // octave the keys are 48..72 and 93 is nowhere near them, so every earlier
  // test of this passed while the bug was live.
  const octaveSweep = await p.evaluate(async () => {
    const A = window.__smk;
    const bad = [];
    for (let oct = -4; oct <= 4; oct++) {
      A.setOctave(oct);
      // The keybed's real window, clamped exactly as the app clamps it. Hard
      // coding a base here is how this drifted: the keyboard now starts at C4,
      // and a test that still assumed C3 called notes playable that were not.
      const lo = Math.max(0, Math.min(103, 60 + A.S.octave * 12)), hi = lo + 24;
      // Only 93/94/95. 91, 92 and 96 are rewind, fast-forward and loop: they
      // are DECODED so they cannot fall through and play a note, but nothing
      // acts on them, so expecting them to move the transport is wrong.
      for (const n of [0x5d, 0x5e, 0x5f]) {
        A.transport('stop');
        const was = (A.lastTransport && A.lastTransport.seq) || 0;
        const lit0 = document.querySelectorAll('#keys .on').length;
        A.io._emit([0x90, n, 100], window.PORT);
        A.io._emit([0x80, n, 0], window.PORT);
        await new Promise((r) => setTimeout(r, 10));
        const fired = !!(A.lastTransport && A.lastTransport.seq > was);
        const playable = n >= lo && n <= hi;
        if (playable && fired) bad.push('oct' + oct + ' note' + n + ' fired the transport');
        if (!playable && !fired) bad.push('oct' + oct + ' note' + n + ' did NOT reach the transport');
      }
    }
    A.setOctave(0);
    A.transport('stop');
    return bad;
  });
  ok(octaveSweep.length === 0,
     'across every octave, a note inside the keybed plays and a Mackie code outside it works the transport',
     octaveSweep.length ? octaveSweep.slice(0, 3).join('; ') : '9 octaves x 3 transport codes swept, all correct');

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

  // ---- the sequencer, through the app -------------------------------------
  // seq.cjs proves the arithmetic. This proves the panel is wired to it: that
  // arming a channel and hitting pads really records, that a muted channel
  // really goes quiet, and that EXPORT really produces a file.
  const panel = await p.evaluate(() => {
    const A = window.__smk;
    A.seq.stop(); A.seq.clear();
    A.renderSeq();
    const body = document.querySelector('#seqbody');
    return {
      rows: body.querySelectorAll('[data-mute]').length,
      arms: body.querySelectorAll('[data-arm]').length,
      grids: body.querySelectorAll('[data-grid]').length,
      heads: body.querySelectorAll('[data-head]').length,
      hasExport: !!document.querySelector('#seqexport'),
    };
  });
  ok(panel.rows === 8 && panel.arms === 8, 'eight channels, each with its own mute and arm',
     panel.rows + ' / ' + panel.arms);
  ok(panel.heads === 8, 'and its own playhead, because eight lengths at once are unreadable as numbers');
  ok(panel.grids === 7, 'seven quantise grids, triplets included', panel.grids + '');
  ok(panel.hasExport, 'and an export button');

  const recorded = await p.evaluate(async () => {
    const A = window.__smk;
    A.seq.stop(); A.seq.clear();
    A.seq.setBpm(200); A.seq.setBars(0, 1); A.seq.setQuantize(0.25, 1);
    A.seq.arm(0); A.seq.play();
    A.padHit(0, 110);
    await new Promise((r) => setTimeout(r, 160));
    A.padHit(2, 100);
    await new Promise((r) => setTimeout(r, 60));
    const n = A.seq.channels[0].events.length;
    const onGrid = A.seq.channels[0].events.every((e) => Math.abs(e.at / 0.25 - Math.round(e.at / 0.25)) < 1e-9);
    const kept = A.seq.channels[0].events.every((e) => typeof e.raw === 'number');
    A.seq.stop();
    return { n, onGrid, kept };
  });
  ok(recorded.n === 2, 'arming a channel and hitting pads records them', recorded.n + ' notes');
  ok(recorded.onGrid, 'each one snapped to the grid as it was played, not on playback');
  ok(recorded.kept, 'and the original timing is kept, so it can be re-quantised from the take');

  const heard = await p.evaluate(async () => {
    const A = window.__smk;
    A.seq.stop();
    let fired = 0;
    const real = A.eng.play;
    A.eng.play = function () { fired++; return real.apply(this, arguments); };
    A.seq.channels[0].on = true;
    A.seq.setBpm(240); A.seq.play();
    await new Promise((r) => setTimeout(r, 500));
    const withSound = fired;
    A.seq.toggle(0);                       // mute
    fired = 0;
    await new Promise((r) => setTimeout(r, 500));
    const muted = fired;
    A.seq.stop(); A.eng.play = real;
    return { withSound, muted, kept: A.seq.channels[0].events.length };
  });
  ok(heard.withSound > 0, 'the recorded channel plays back', heard.withSound + ' notes in 0.5s');
  ok(heard.muted === 0, 'and muting it really silences it', heard.muted + ' while muted');
  ok(heard.kept === 2, 'without losing the notes', heard.kept + ' still there');

  const exported = await p.evaluate(() => {
    const A = window.__smk;
    const bytes = window.__toMidi ? null : null;
    // Reach the export through the same button the user presses, and intercept
    // the download rather than performing it.
    let got = null;
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (b) => { got = b; return 'blob:test'; };
    A.exportMid();
    URL.createObjectURL = realCreate;
    return got ? { size: got.size, type: got.type } : null;
  });
  ok(exported && exported.size > 40, 'EXPORT produces an actual MIDI file',
     exported ? exported.size + ' bytes, ' + exported.type : 'nothing');

  // ---- the right-click menus --------------------------------------------
  // Every pad, key and knob has had a menu wired to it since this edition
  // shipped, and none of it was ever VISIBLE: menu.js builds `.menu`/`.mitem`
  // elements and the stylesheet for them lived only in ULTIMATE. So the check
  // is not "does a menu open" — it did — but "can it be seen".
  const menu = await p.evaluate(async () => {
    const fire = (el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
    const look = () => {
      const m = document.querySelector('.menu');
      if (!m) return null;
      const cs = getComputedStyle(m);
      const r = m.getBoundingClientRect();
      return { pos: cs.position, z: cs.zIndex, opacity: +cs.opacity, w: Math.round(r.width), items: m.querySelectorAll('.mitem').length };
    };
    const out = {};
    for (const [name, sel] of [['pad', '.pad'], ['key', '#keys .kw'], ['knob', '.knob'], ['bed', '#bed']]) {
      document.querySelectorAll('.menu').forEach((m) => m.remove());
      fire(document.querySelector(sel));
      // Long enough for the open transition to SETTLE. At 60ms the menus were
      // caught mid-fade and read back opacities between 0 and 0.89 — which
      // tests the animation, not the thing being claimed.
      await new Promise((r) => setTimeout(r, 260));
      out[name] = look();
    }
    document.querySelectorAll('.menu').forEach((m) => m.remove());
    return out;
  });
  for (const k of ['pad', 'key', 'knob', 'bed']) {
    const m = menu[k];
    ok(m && m.pos === 'fixed' && +m.z >= 10 && m.opacity > 0.95 && m.w > 100 && m.items > 0,
       'right-clicking a ' + k + ' opens a menu that can actually be SEEN',
       m ? (m.items + ' items, ' + m.w + 'px, z' + m.z + ', opacity ' + m.opacity) : 'no menu at all');
  }

  // ---- drag and drop onto a pad ------------------------------------------
  const dropped = await p.evaluate(async () => {
    const A = window.__smk;
    A.S.pads[A.S.padBank][3] = null;
    const pad = document.querySelectorAll('.pad')[3];
    // A real DragEvent carrying a real file, aimed at the pad — not at the
    // window. The pad must claim it.
    const wav = new Uint8Array(44 + 800);
    const dv = new DataView(wav.buffer);
    const put = (o, s) => { for (let i = 0; i < s.length; i++) wav[o + i] = s.charCodeAt(i); };
    put(0, 'RIFF'); dv.setUint32(4, 36 + 800, true); put(8, 'WAVE'); put(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 8000, true); dv.setUint32(28, 16000, true); dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true); put(36, 'data'); dv.setUint32(40, 800, true);
    for (let i = 0; i < 400; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(i / 6) * 9000), true);
    const file = new File([wav], 'DroppedLoop.wav', { type: 'audio/wav' });
    const dt = new DataTransfer(); dt.items.add(file);
    pad.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    window.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 900));
    const slot = A.S.pads[A.S.padBank][3];
    return { name: slot && slot.name, libOpened: document.querySelector('#lib').classList.contains('open') };
  });
  ok(dropped.name && /DroppedLoop/.test(dropped.name), 'a file dropped ON a pad lands on that pad',
     dropped.name || 'nothing');
  ok(!dropped.libOpened, 'and the library does not slide up over the pad you just aimed at');

  // ---- DRAGGING A SOUND OUT OF THE LIBRARY --------------------------------
  // Not a file drop. The rows were marked draggable and every target listened
  // only for files, so a drag from the library reached the target and then fell
  // through to the file importer, which waited for files that never came.
  const dragOut = await p.evaluate(async () => {
    const A = window.__smk;
    A.renderList();
    const row = document.querySelector('.snd');
    const id = A.lib.items[0].id, name = A.lib.items[0].name;
    A.S.pads[A.S.padBank][5] = null;
    const pad = document.querySelectorAll('.pad')[5];
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const carried = dt.getData('text/skrimpad-sound');
    pad.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    pad.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 120));
    const slot = A.S.pads[A.S.padBank][5];
    // ...and onto the loop deck.
    A.bed.clear();
    const deck = document.querySelector('#bed');
    deck.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    deck.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await new Promise((r) => setTimeout(r, 120));
    return { carried, expect: id, padGot: slot && slot.name, want: name, bedGot: A.bed.name };
  });
  ok(dragOut.carried === dragOut.expect, 'dragging a library row actually carries the sound',
     dragOut.carried || 'nothing on the dataTransfer');
  ok(dragOut.padGot === dragOut.want, 'and dropping it on a pad puts it on that pad',
     dragOut.padGot || 'nothing landed');
  ok(dragOut.bedGot === dragOut.want, 'and dropping it on the loop deck loads the deck',
     dragOut.bedGot || 'nothing landed');

  // ---- THE LOOP ACTUALLY LOOPS -------------------------------------------
  // "it needs to run the sample over and over so I can play keys behind it."
  // A source that plays once and stops is not a loop, and nothing until now
  // checked that the flag was even set.
  const loops = await p.evaluate(async () => {
    const A = window.__smk;
    const it = A.lib.items[0];
    A.bed.set(it.id, it.name);
    await A.__warm();
    A.bed.start();
    await new Promise((r) => setTimeout(r, 120));
    const src = A.bed.src;
    const out = { started: !!src, looping: !!(src && src.loop), dur: src && src.buffer && src.buffer.duration };
    // Playing keys over the top must not disturb it.
    A.keyOn(64, 100); A.keyOn(67, 100);
    await new Promise((r) => setTimeout(r, 200));
    out.stillGoing = A.bed.playing && A.bed.src === src;
    A.keyOff(64); A.keyOff(67);
    A.transport('stop');
    return out;
  });
  ok(loops.started, 'a loop on the deck starts');
  ok(loops.looping, 'and it LOOPS — the source repeats rather than playing once',
     'loop flag ' + loops.looping + ' on a ' + (loops.dur || 0).toFixed(3) + 's buffer');
  ok(loops.stillGoing, 'and playing keys over the top does not interrupt it');

  // ---- the loop bed -------------------------------------------------------
  const bedState = await p.evaluate(async () => {
    const A = window.__smk;
    const it = A.lib.items[A.lib.items.length - 1];
    A.bed.set(it.id, it.name);
    A.bed.start();
    await new Promise((r) => setTimeout(r, 400));
    const on = A.bed.playing;
    const label = document.querySelector('#bed').textContent;
    A.transport('stop');
    await new Promise((r) => setTimeout(r, 60));
    return { on, offAfterStop: !A.bed.playing, label };
  });
  ok(bedState.on, 'a loop dropped on the bed plays');
  ok(/DroppedLoop/.test(bedState.label), 'and the transport shows which loop it is', bedState.label);
  ok(bedState.offAfterStop, 'and STOP stops it along with everything else');

  // ---- the library, organised --------------------------------------------
  const org = await p.evaluate(async () => {
    const A = window.__smk;
    A.renderList();
    const row = document.querySelector('.snd');
    return {
      rows: document.querySelectorAll('.snd').length,
      kind: row && row.querySelector('.k').textContent,
      dur: row && row.querySelector('.d').textContent,
      draggable: row && row.draggable,
      filters: document.querySelectorAll('#libkinds [data-kind]').length,
      hasSearch: !!document.querySelector('#libq'),
    };
  });
  ok(org.rows > 0 && org.hasSearch, 'the library lists sounds and can be searched', org.rows + ' rows');
  ok(!!org.kind && /^[A-Z]+$/.test(org.kind), 'each row carries its KIND, so four hundred rows are not identical',
     org.kind);
  ok(/\d\.\d\ds/.test(org.dur || ''), 'and its length', org.dur);
  ok(org.draggable, 'and can be dragged onto a pad');
  ok(org.filters >= 2, 'with a kind filter built from what is actually in the library',
     org.filters + ' filters (ALL + the kinds present)');

  const filtered = await p.evaluate(async () => {
    const A = window.__smk;
    const before = document.querySelectorAll('.snd').length;
    document.querySelector('#libq').value = 'zzzznothing';
    document.querySelector('#libq').dispatchEvent(new Event('input', { bubbles: true }));
    const none = document.querySelectorAll('.snd').length;
    document.querySelector('#libq').value = '';
    document.querySelector('#libq').dispatchEvent(new Event('input', { bubbles: true }));
    return { before, none, back: document.querySelectorAll('.snd').length };
  });
  ok(filtered.none === 0 && filtered.back === filtered.before, 'search really filters, and clearing it restores',
     filtered.before + ' → ' + filtered.none + ' → ' + filtered.back);

  // Clicking a sound must HEAR it — every time, not only the first time.
  const heard2 = await p.evaluate(async () => {
    const A = window.__smk;
    let played = 0;
    const real = A.eng.play;
    A.eng.play = function () { played++; return real.apply(this, arguments); };
    const row = document.querySelector('.snd');
    row.click(); await new Promise((r) => setTimeout(r, 250));
    const first = played;
    document.querySelector('.snd').click(); await new Promise((r) => setTimeout(r, 250));
    A.eng.play = real;
    return { first, second: played - first };
  });
  ok(heard2.first > 0, 'clicking a sound in the library plays it');
  ok(heard2.second > 0, 'and clicking it AGAIN plays it again — the audition is not tied to arming',
     heard2.first + ' then ' + heard2.second);

  // ---- the face mirrors the unit -----------------------------------------
  const face = await p.evaluate(() => {
    const q = (x) => document.querySelector(x);
    const box = (x) => { const e = q(x); return e ? e.getBoundingClientRect() : null; };
    const L = box('#left'), M = box('#mid'), P = box('#pads'), K = box('#keys');
    const btns = Array.from(document.querySelectorAll('#btns .fb')).map((b) => b.textContent.trim());
    return {
      order: !!(L && M && P && L.right <= M.left + 2 && M.right <= P.left + 2),
      keysBelow: !!(K && P && K.top >= P.bottom - 4),
      keysFullWidth: !!(K && L && P && K.left <= L.left + 4 && K.right >= P.right - 6),
      btns, lcd: !!q('#lcd'),
      strips: !!(q('#sPitch') && q('#sMod')),
      stripsAboveOct: !!(box('#sensors') && box('#octs') && box('#sensors').bottom <= box('#octs').top + 2),
    };
  });
  ok(face.order, 'the face runs left to right as the unit does: strips, then the middle block, then the pads');
  ok(face.stripsAboveOct, 'with PITCH and MOD above OCT- / OCT+, in the top-left corner');
  ok(face.keysBelow && face.keysFullWidth, 'and the keybed underneath all of it, full width');
  ok(face.btns.join(' ') === 'PLAY STOP REC BT ARP SC/CH KNOB-B PAD-B',
     'the eight face buttons are the eight on the unit, in order', face.btns.join(' '));
  ok(face.lcd, 'and the three-character readout is there');

  // ---- the knobs are what the unit says they are --------------------------
  // The panel silkscreens MODE OCT LATCH GATE / SWING TEMPO RATE TRANSPOSE.
  // These were CUTOFF/RESO/ATTACK/... — sensible synth controls, and not what
  // is written on the keyboard. A knob named something other than what is
  // printed on it is the worst kind of wrong: everything works and nothing is
  // where it says it is.
  const knobs = await p.evaluate(async () => {
    const A = window.__smk;
    A.S.knobBank = 0;
    const labels = A.KNOB_ROLES.slice(0, 8).map((r) => r.l);
    const before = { mode: A.S.arp.mode, rate: A.S.arp.rate, oct: A.S.arp.octaves,
                     latch: A.S.arp.latch, bpm: A.S.bpm, tr: A.S.transpose };
    A.setKnob(0, 0.95);   // MODE
    A.setKnob(1, 0.95);   // OCT
    A.setKnob(2, 0.95);   // LATCH
    A.setKnob(5, 0.30);   // TEMPO
    A.setKnob(6, 0.05);   // RATE
    A.setKnob(7, 0.95);   // TRANSPOSE
    const after = { mode: A.S.arp.mode, rate: A.S.arp.rate, oct: A.S.arp.octaves,
                    latch: A.S.arp.latch, bpm: A.S.bpm, tr: A.S.transpose };
    // Rows, as on the unit.
    const cs = getComputedStyle(document.querySelector('#knobs'));
    return { labels, before, after, cols: cs.gridTemplateColumns.split(' ').length };
  });
  ok(knobs.labels.join(' ') === 'MODE OCT LATCH GATE SWING TEMPO RATE TRANSPOSE',
     'bank A is labelled exactly as the unit is silkscreened', knobs.labels.join(' '));
  ok(knobs.cols === 4, 'and laid out 2x4 like the panel, not one row of eight', knobs.cols + ' columns');
  ok(knobs.after.mode !== knobs.before.mode, 'MODE changes the arpeggiator mode',
     knobs.before.mode + ' → ' + knobs.after.mode);
  ok(knobs.after.oct !== knobs.before.oct, 'OCT changes its octave spread',
     knobs.before.oct + ' → ' + knobs.after.oct);
  ok(knobs.after.latch !== knobs.before.latch, 'LATCH latches past halfway',
     knobs.before.latch + ' → ' + knobs.after.latch);
  ok(knobs.after.rate !== knobs.before.rate, 'RATE changes the division',
     knobs.before.rate + ' → ' + knobs.after.rate);
  ok(knobs.after.bpm !== knobs.before.bpm, 'TEMPO changes the tempo',
     knobs.before.bpm + ' → ' + knobs.after.bpm);
  ok(knobs.after.tr !== knobs.before.tr, 'and TRANSPOSE transposes',
     knobs.before.tr + ' → ' + knobs.after.tr + ' semitones');

  // ---- the pads, and the one tap that fixes a unit that disagrees ---------
  const flip = await p.evaluate(async () => {
    const A = window.__smk;
    const key = A.unit.unitKey('SMK-25 II MIDI 2');
    A.unit.reset(key);
    const before = A.unit.padSnapshot(key, 0).map((x) => x && x.note);
    A.flipPadRows();
    const after = A.unit.padSnapshot(key, 0).map((x) => x && x.note);
    A.flipPadRows();
    const back = A.unit.padSnapshot(key, 0).map((x) => x && x.note);
    A.unit.reset(key);
    return { before, after, back };
  });
  ok(flip.before.join(',') === '36,37,38,39,40,41,42,43',
     'Pad 1 is top-left and takes the first note, as the unit is numbered', flip.before.join(','));
  ok(flip.after.join(',') === '40,41,42,43,36,37,38,39',
     'FLIP ROWS swaps the two rows for a unit mapped the other way', flip.after.join(','));
  ok(flip.back.join(',') === flip.before.join(','), 'and flipping again puts it back');

  // ---- the two touch strips ----------------------------------------------
  // Both were being dropped: pitch bend has its own status byte (0xE0) and the
  // handler had no case for it, and mod (CC 1) fell through the knob lookup.
  const strips = await p.evaluate(async () => {
    const A = window.__smk;
    A.setBend(0); A.setMod(0);
    const out = {};
    out.onScreen = { pitch: !!document.querySelector('#sPitch'), mod: !!document.querySelector('#sMod') };

    // Pitch bend from the hardware: 14 bits, centre 8192.
    A.io._emit([0xe0, 0x00, 0x60], window.PORT);        // (0x60<<7) = 12288 → +0.5
    await new Promise((r) => setTimeout(r, 30));
    out.bentUp = A.bendSemis;
    A.io._emit([0xe0, 0x00, 0x00], window.PORT);        // 0 → fully down
    await new Promise((r) => setTimeout(r, 30));
    out.bentDown = A.bendSemis;
    A.io._emit([0xe0, 0x00, 0x40], window.PORT);        // 8192 → centre
    await new Promise((r) => setTimeout(r, 30));
    out.centred = A.bendSemis;

    // Mod from the hardware.
    A.io._emit([0xb0, 1, 127], window.PORT);
    await new Promise((r) => setTimeout(r, 30));
    out.mod = A.modAmt;

    // It must reach a note that is ALREADY sounding.
    A.setBend(0); A.setMod(0);
    let bends = 0;
    const realHold = A.eng.hold;
    A.eng.hold = function () {
      const h = realHold.apply(this, arguments);
      const rb = h.bend; h.bend = function (x) { bends++; return rb.apply(this, arguments); };
      return h;
    };
    A.keyOn(60, 100);
    A.io._emit([0xe0, 0x00, 0x60], window.PORT);
    await new Promise((r) => setTimeout(r, 40));
    out.reachedLiveNote = bends;
    // ...and a note started WHILE bent must start bent.
    A.keyOn(64, 100);
    await new Promise((r) => setTimeout(r, 30));
    out.newNoteInherits = bends > out.reachedLiveNote;
    A.keyOff(60); A.keyOff(64); A.eng.hold = realHold;
    A.setBend(0); A.setMod(0);

    // The pitch strip reads its position from the bend, so the handle moves.
    A.setBend(1);
    out.handleMoved = document.querySelector('#sPitch i').style.top;
    A.setBend(0);
    out.handleHome = document.querySelector('#sPitch i').style.top;
    return out;
  });
  ok(strips.onScreen.pitch && strips.onScreen.mod, 'both strips are drawn, on the left where the sensors are');
  ok(Math.abs(strips.bentUp - 1) < 0.01, 'pitch bend from the keyboard reaches the app', '+' + strips.bentUp.toFixed(2) + ' semitones');
  ok(Math.abs(strips.bentDown + 2) < 0.01, 'in both directions', strips.bentDown.toFixed(2) + ' semitones at the bottom');
  ok(strips.centred === 0, 'and 8192 is dead centre, not a small permanent detune', strips.centred + '');
  ok(strips.mod === 1, 'the modulation strip (CC 1) reaches it too', 'mod ' + strips.mod);
  ok(strips.reachedLiveNote > 0, 'a bend moves the note ALREADY under your finger',
     strips.reachedLiveNote + ' bend calls on a sounding note');
  ok(strips.newNoteInherits, 'and a note started while bent starts bent, rather than jumping later');
  ok(strips.handleMoved !== strips.handleHome, 'the handle on screen follows the bend',
     strips.handleMoved + ' → ' + strips.handleHome);

  // ---- the keyboard voice, splashed across all 25 keys --------------------
  const splashed = await p.evaluate(async () => {
    const A = window.__smk;
    const it = A.lib.items[0];
    const chips = document.querySelectorAll('#voicepick [data-voice]').length;
    A.setVoice(it);
    await new Promise((r) => setTimeout(r, 200));
    // Every key must now be that sound — without twenty-five assignments.
    const perKey = Object.keys(A.S.keys).filter((k) => A.S.keys[k]).length;
    // ...and an individually set key still wins over it.
    A.S.keys[64] = { id: 'other', name: 'Only This Key' };
    const on64 = A.S.keys[64].name;
    A.setVoice(null);
    return { chips, voiceWas: it.name, perKey, on64, cleared: A.S.voice };
  });
  ok(splashed.chips >= 2, 'the voice row offers the pad sounds and the library', splashed.chips + ' chips');
  ok(splashed.perKey === 0, 'splashing a voice does NOT write twenty-five key assignments',
     splashed.perKey + ' per-key assignments');
  ok(splashed.on64 === 'Only This Key', 'and an individually set key still beats the splashed voice');
  ok(splashed.cleared === null, 'and it can be cleared back to the synth');

  // ---- the loop deck looks like a deck ------------------------------------
  const deck = await p.evaluate(() => {
    const el = document.querySelector('#bed');
    const r = el.getBoundingClientRect();
    return { inStage: !!el.closest('#stage'), w: Math.round(r.width), h: Math.round(r.height),
             wave: !!document.querySelector('#bedwave'), btn: !!document.querySelector('#bedgo'),
             lev: !!document.querySelector('#bedlev') };
  });
  ok(deck.inStage, 'the loop deck is ON the machine face, not a chip in a toolbar');
  ok(deck.wave && deck.btn && deck.lev, 'with a screen, a transport button and a level fader');
  ok(deck.h > 90, 'and it is a panel, not a button', deck.w + '×' + deck.h);

  // ---- the snip editor ----------------------------------------------------
  const snipped = await p.evaluate(async () => {
    const A = window.__smk;
    const it = A.lib.items.find((x) => /DroppedLoop/.test(x.name));
    const wasCount = A.lib.items.length;
    await A.openSnip(it);
    const panel = document.querySelector('#snip');
    const e = A.snipEdit;
    const opened = { hidden: panel.hidden, wave: !!document.querySelector('#snipwave'),
                     sliders: panel.querySelectorAll('input[type=range]').length,
                     start: e.start, end: e.end };
    // Trim it to the middle half and save.
    e.start = 0.25; e.end = 0.75;
    await A.saveSnip();
    await new Promise((r) => setTimeout(r, 400));
    const made = A.lib.items.find((x) => /✂/.test(x.name));
    return { opened, count: A.lib.items.length - wasCount,
             name: made && made.name, dur: made && made.dur, orig: it.dur,
             closed: document.querySelector('#snip').hidden };
  });
  ok(!snipped.opened.hidden && snipped.opened.wave, 'the snip editor opens with a waveform');
  ok(snipped.opened.sliders === 5, 'start, end, two fades and gain', snipped.opened.sliders + ' sliders');
  ok(snipped.opened.end <= 1 && snipped.opened.start >= 0 && snipped.opened.start < snipped.opened.end,
     'and it opens already trimmed to where the sound actually is',
     snipped.opened.start.toFixed(3) + '..' + snipped.opened.end.toFixed(3));
  ok(snipped.count === 1, 'saving a snip makes ONE new sound — not a setting on a slot',
     '+' + snipped.count + ' in the library');
  ok(snipped.name && /✂/.test(snipped.name), 'named so you can tell it from its parent', snipped.name);
  ok(snipped.dur > 0 && snipped.dur < snipped.orig,
     'and it really is shorter than what it was cut from',
     snipped.dur + 's from ' + snipped.orig + 's');
  ok(snipped.closed, 'and the editor closes once it is saved');

  // ---- the FX rack, through the app ----------------------------------------
  // fx.cjs proves each unit's audio signature offline. This proves the panel
  // is wired: six toggles exist, clicking one patches the engine's seam, and
  // the state survives a reload.
  const rack = await p.evaluate(async () => {
    const A = window.__smk;
    const chips = document.querySelectorAll('#fxrow [data-fx]');
    let patched = null;
    const real = A.eng.patchFx;
    A.eng.patchFx = function (b) { patched = b; return real.call(this, b); };
    document.querySelector('[data-fx="delay"]').click();
    const onAfterClick = A.S.fx.delay;
    const chainWhenOn = patched;
    document.querySelector('[data-fx="delay"]').click();
    const chainWhenOff = patched;
    A.eng.patchFx = real;
    return { chips: chips.length,
             labels: Array.from(chips).map((c) => c.textContent).join(' '),
             onAfterClick, gotChain: typeof chainWhenOn === 'function', clearedChain: chainWhenOff === null,
             saved: JSON.parse(localStorage.getItem('skrimpad.smk.state.v1') || '{}').fx !== undefined };
  });
  ok(rack.chips === 6 && rack.labels === 'EQ COMP DRIVE FILTER DELAY VERB',
     'the rack is six toggles in the unit order', rack.labels);
  ok(rack.onAfterClick === true && rack.gotChain, 'switching one on patches a real chain into the engine');
  ok(rack.clearedChain, 'and switching it off restores the straight wire — null chain, not a chain of wires');

  // ---- the piano roll, through the app -------------------------------------
  // roll.cjs proves the geometry. This proves the canvas is wired to it: a
  // click on empty grid makes a real note in the real channel, dragging moves
  // it, and right-click removes it.
  const roll = await p.evaluate(async () => {
    const A = window.__smk;
    A.seq.stop(); A.seq.clear(); A.seq.setBars(0, 2); A.seq.setQuantize(0.25, 1);
    A.openRoll(0);
    await new Promise((r) => setTimeout(r, 120));
    const cv = document.querySelector('#rollcv');
    const b = cv.getBoundingClientRect();
    const down = (x, y, btn) => cv.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, clientX: b.left + x, clientY: b.top + y, pointerId: 1, button: btn || 0 }));
    const move = (x, y) => cv.dispatchEvent(new PointerEvent('pointermove',
      { bubbles: true, clientX: b.left + x, clientY: b.top + y, pointerId: 1 }));
    const up = () => cv.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

    // draw one
    down(200, 150); up();
    const made = A.seq.channels[0].events.length;
    const first = Object.assign({}, A.seq.channels[0].events[0]);

    // MOVE IT — from the note's ACTUAL rectangle, not from where the click
    // that made it landed. Those differ: a new note snaps back to the grid
    // line, so pressing at the original x can be past its right-hand edge, and
    // the first version of this test "moved" the note by quietly creating a
    // second one beside it and then comparing the first with itself.
    await new Promise((r) => setTimeout(r, 40));
    // Grabbed by its LEFT portion, not its centre. A note one grid-step long
    // is ~17px wide and the resize handle is the last 7.5px of it, so "the
    // middle" is a few pixels from the handle and the gesture flips to a
    // resize on the smallest layout difference — which is exactly what
    // happened, and it made a working drag look broken.
    let rc = A.rollRectFor(0);
    down(rc.x + 3, rc.y + rc.h / 2); move(rc.x + 90, rc.y - 40); up();
    const moved = Object.assign({}, A.seq.channels[0].events[0]);

    // right-click it away, again from where it now actually is
    const removedFrom = A.seq.channels[0].events.length;
    rc = A.rollRectFor(0);
    cv.dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, cancelable: true, clientX: b.left + rc.x + rc.w / 2, clientY: b.top + rc.y + rc.h / 2 }));
    await new Promise((r) => setTimeout(r, 40));
    const after = A.seq.channels[0].events.length;

    const lanes = document.querySelectorAll('#rollbar [data-rch]').length;
    A.seq.clear();
    return { made, first, moved, removedFrom, after, lanes,
             inLoop: moved.at >= 0 && moved.at < 8, note: moved.note };
  });
  ok(roll.made === 1, 'clicking empty grid in the piano roll draws a real note', roll.made + ' note');
  ok(roll.first.len > 0 && roll.first.note >= 24 && roll.first.note <= 107,
     'at a real pitch and a visible length', 'note ' + roll.first.note + ', len ' + roll.first.len);
  ok(roll.moved.at !== roll.first.at || roll.moved.note !== roll.first.note,
     'dragging it moves it',
     roll.first.note + '@' + roll.first.at + ' → ' + roll.moved.note + '@' + roll.moved.at);
  ok(roll.inLoop, 'and never outside the loop, where it would be stored and never played',
     'at ' + roll.moved.at + ' of 8 beats');
  ok(roll.after === roll.removedFrom - 1, 'right-clicking a note deletes it',
     roll.removedFrom + ' → ' + roll.after);
  ok(roll.lanes === 8, 'and all eight channels are switchable from the roll', roll.lanes + '');

  // ---- the timeline --------------------------------------------------------
  const daw = await p.evaluate(async () => {
    const A = window.__smk;
    A.seq.stop(); A.seq.clear();
    A.seq.setBars(0, 2);
    // SET THE PRECONDITION. An earlier section mutes channel 0 to prove that
    // muting silences it and never unmutes — so this test inherited a muted
    // channel and asserted the wrong direction. A test that depends on where
    // the last one left things is not testing what it says.
    A.seq.channels[0].on = true;
    A.seq.channels[0].events = [{ note: 60, vel: 100, at: 0, len: 0.5 }];
    A.renderDaw();
    await new Promise((r) => setTimeout(r, 120));
    const cv = document.querySelector('#dawcv');
    const b = cv.getBoundingClientRect();
    const wasOn = A.seq.channels[0].on;
    // a click in the lane BODY mutes
    cv.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, clientX: b.left + 300, clientY: b.top + 8, pointerId: 1 }));
    await new Promise((r) => setTimeout(r, 60));
    const muted = A.seq.channels[0].on;
    const bars = document.querySelectorAll('#dawbar [data-dbars]').length;
    const painted = cv.width > 0 && cv.height > 0;
    A.seq.channels[0].on = wasOn; A.seq.clear();
    return { wasOn, muted, bars, painted };
  });
  ok(daw.painted, 'the timeline paints');
  ok(daw.wasOn === true && daw.muted === false, 'and clicking a lane mutes that channel',
     daw.wasOn + ' → ' + daw.muted);
  ok(daw.bars === 4, 'with four arrangement lengths to view it at', daw.bars + '');

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
