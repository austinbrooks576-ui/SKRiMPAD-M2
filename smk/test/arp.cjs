// arp.cjs — the arpeggiator and the twelve rhythms, checked as maths.
//
// The order logic is pure — notes in, notes out — so it can be swept rather
// than sampled. Every mode, at every chord size from one to six, over several
// full cycles, is a few thousand cases and takes no time at all. That matters
// because arpeggiator bugs are almost never "it makes no sound"; they are "the
// pattern limps at the top with four notes held", which one hand-written
// example will never find.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

// The module is ESM; this harness is CJS. Bundle it to CJS rather than
// re-implementing it, so what is tested is the file the app actually ships.
const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimarp-'));
const out = path.join(TMP, 'arp.cjs');
const src = path.join(ROOT, 'smk/src/core/arp.js').split(path.sep).join('/');
execSync(`npx --yes esbuild "${src}" --bundle --format=cjs --platform=node --outfile="${out}"`, { stdio: 'inherit' });
const A = require(out);
const R = require(path.join(ROOT, 'smk/src/core/smk25.js').split(path.sep).join('/').replace(/\.js$/, '.js'));

const notes = (...ns) => ns.map((n, i) => ({ note: n, vel: 100, at: i }));
const seq = (list, mode, count) => {
  const o = [];
  for (let i = 0; i < count; i++) o.push(A.arpStep(list, mode, i).map((x) => x.note).join('+'));
  return o;
};

// ---- the shapes, by name -------------------------------------------------
const CEG = notes(60, 64, 67);
ok(seq(CEG, 'UP', 6).join(' ') === '60 64 67 60 64 67', 'UP climbs and wraps',
   seq(CEG, 'UP', 6).join(' '));
ok(seq(CEG, 'DOWN', 6).join(' ') === '67 64 60 67 64 60', 'DOWN falls and wraps',
   seq(CEG, 'DOWN', 6).join(' '));
// The two up-and-down modes, and the difference between them is why both exist.
ok(seq(CEG, 'INCL', 12).join(' ') === '60 64 67 67 64 60 60 64 67 67 64 60',
   'INCL turns on a REPEATED end note — the classic inclusive shape',
   seq(CEG, 'INCL', 6).join(' '));
ok(seq(CEG, 'EXCL', 8).join(' ') === '60 64 67 64 60 64 67 64',
   'EXCL turns WITHOUT repeating, so the ends do not stutter',
   seq(CEG, 'EXCL', 8).join(' '));
ok(seq(CEG, 'REPEAT', 2).join(' ') === '60+64+67 60+64+67', 'REPEAT plays the whole chord every step');

// ORDER is the only mode that can play a shape you fingered rather than one
// sorted for you, so it must NOT sort.
const played = [{ note: 67, vel: 100, at: 5 }, { note: 60, vel: 100, at: 1 }, { note: 64, vel: 100, at: 3 }];
ok(seq(played, 'ORDER', 4).join(' ') === '60 64 67 60', 'ORDER follows the order you pressed them, not pitch',
   seq(played, 'ORDER', 3).join(' '));
ok(seq(played, 'UP', 3).join(' ') === '60 64 67', '...while UP sorts the same input by pitch');

// ---- the sweep -----------------------------------------------------------
// Properties that must hold for EVERY mode at EVERY chord size. This is the
// part a handful of examples cannot do.
let swept = 0, offGrid = 0, uneven = [], stuck = [];
for (const mode of ['UP', 'DOWN', 'INCL', 'EXCL', 'ORDER', 'REPEAT']) {
  for (let n = 1; n <= 6; n++) {
    const list = notes(...Array.from({ length: n }, (_, i) => 60 + i * 3));
    const counts = new Map();
    let last = null, repeats = 0;
    // Enough steps to cover several whole cycles of the longest period (2n-2).
    const steps = n * 12;
    for (let i = 0; i < steps; i++) {
      const picked = A.arpStep(list, mode, i);
      swept++;
      // 1. It must only ever play notes that are actually held.
      picked.forEach((p) => { if (!list.some((x) => x.note === p.note)) offGrid++; });
      // 2. It must always play something.
      if (!picked.length) offGrid++;
      picked.forEach((p) => counts.set(p.note, (counts.get(p.note) || 0) + 1));
      const key = picked.map((p) => p.note).join('+');
      if (key === last) repeats++;
      last = key;
    }
    // 3. Every held note gets played. A mode that silently drops the top note
    //    of a four-note chord is the classic off-by-one, and it is invisible
    //    until you happen to hold four.
    if (counts.size !== n) stuck.push(mode + '/' + n + ' played ' + counts.size + ' of ' + n);
    // 4. No mode may sit on one note. INCL legitimately repeats at the turn,
    //    and REPEAT is all one "note", so they are exempt.
    if (mode !== 'REPEAT' && mode !== 'INCL' && n > 1 && repeats > 0) {
      uneven.push(mode + '/' + n + ' repeated ' + repeats);
    }
  }
}
ok(offGrid === 0, 'across every mode and chord size, it only ever plays held notes — and always plays one',
   swept + ' steps swept');
ok(stuck.length === 0, 'and every held note is reached', stuck.join('; ') || 'nothing dropped');
ok(uneven.length === 0, 'and no mode stalls on the same note twice running', uneven.join('; ') || 'clean');

// A negative step index must not throw or index out of bounds — the scheduler
// can hand one back after a tempo change moves the origin.
let threw = false;
try { for (let i = -8; i < 0; i++) A.arpStep(CEG, 'EXCL', i); } catch (e) { threw = true; }
ok(!threw, 'a negative step index is handled rather than thrown');

// One held note is the case every wrap-around formula divides by zero on.
ok(seq(notes(60), 'EXCL', 4).join(' ') === '60 60 60 60', 'one note held is four of the same note, not a crash');
ok(A.arpStep([], 'UP', 3).length === 0, 'no notes held plays nothing');

// ---- the rhythms ---------------------------------------------------------
ok(R.RHYTHMS.length === 12, 'there are twelve rhythms', R.RHYTHMS.length + '');
ok(R.RHYTHMS.every((r) => r.s.length === 16), 'each is sixteen steps',
   R.RHYTHMS.map((r) => r.s.length).join(','));
ok(R.RHYTHMS.every((r) => r.s.some((x) => x > 0)), 'and none of them is silent');
ok(new Set(R.RHYTHMS.map((r) => r.s.join(','))).size === 12, 'and no two are the same pattern');

const fourfloor = R.RHYTHMS.find((r) => r.id === 'fourfloor').s;
// At 1/16 the rhythm is read step for step.
ok([0, 1, 2, 3, 4].map((i) => (A.rhythmAt(fourfloor, i, 1) > 0 ? 'x' : '.')).join('') === 'x...x',
   'four-on-the-floor at 1/16 sounds on the beat and rests between');
// At 1/8 — TWO sixteenths per step — it must read every OTHER weight. Reading
// the first eight instead is the bug that makes eleven of the twelve rhythms
// come out as something else entirely at any rate but 1/16.
ok([0, 1, 2, 3].map((i) => (A.rhythmAt(fourfloor, i, 2) > 0 ? 'x' : '.')).join('') === 'x.x.',
   'and at 1/8 it still lands on the beat, by reading every other weight');
ok([0, 1].every((i) => A.rhythmAt(fourfloor, i, 4) > 0),
   'and at 1/4 every step is a beat, so none of them rest');
ok(A.rhythmAt(null, 5, 1) === 1, 'no rhythm chosen means every step sounds at full weight');
const sparse = R.RHYTHMS.find((r) => r.id === 'sparse').s;
ok(A.rhythmAt(sparse, 0, 1) > 0 && [1, 2, 3, 7, 15].every((i) => A.rhythmAt(sparse, i, 1) === 0),
   'Sparse really is once a bar');
// Weights are velocities, not just on/off.
const build = R.RHYTHMS.find((r) => r.id === 'build').s;
ok(A.rhythmAt(build, 15, 1) > A.rhythmAt(build, 0, 1), 'Build ends louder than it starts',
   A.rhythmAt(build, 0, 1).toFixed(2) + ' → ' + A.rhythmAt(build, 15, 1).toFixed(2));

// ---- swing ----------------------------------------------------------------
// Swing delays the ODD steps only. Applying it to every step is just playing
// slower, which is the mistake that makes "swing" sound like a tempo control.
const sps = 0.125;
ok(A.stepTime(0, sps, 0.3) === 0, 'swing leaves the downbeat alone');
ok(Math.abs(A.stepTime(1, sps, 0.3) - (sps + sps * 0.3)) < 1e-9, 'and delays the offbeat');
ok(Math.abs(A.stepTime(2, sps, 0.3) - sps * 2) < 1e-9, 'and the next downbeat is back where it belongs');
ok(A.stepTime(1, sps, 0) === sps, 'swing at zero changes nothing');
// Successive steps must never cross over each other, at any swing setting.
let crossed = 0;
for (let sw = 0; sw <= 0.6; sw += 0.05) {
  for (let i = 1; i < 40; i++) if (A.stepTime(i, sps, sw) <= A.stepTime(i - 1, sps, sw)) crossed++;
}
ok(crossed === 0, 'and no amount of swing makes a step land before the one before it');

// ---- the running arpeggiator ---------------------------------------------
// A fake clock, so the scheduler can be driven a step at a time.
function harness(cfg) {
  let t = 0;
  const fired = [];
  const a = A.createArp({ now: () => t, onNote: (note, vel, when, len) => fired.push({ note, vel, when, len }) });
  a.set(Object.assign({ mode: 'UP', q: 1, bpm: 120, gate: 0.5, swing: 0 }, cfg || {}));
  // Advance the clock in small bites and pump the scheduler each time, which is
  // exactly what the 25ms interval does in the app — the same fill(), not a
  // stand-in for it.
  return { a, fired, at: () => t,
           adv: (dt) => { for (let k = 0; k < Math.round(dt / 0.02); k++) { t += 0.02; a.pump(); } } };
}
let H = harness();
H.a.hold(60, 100); H.a.hold(64, 100); H.a.hold(67, 100);
H.adv(1.0);
// 120bpm, 1/16 → 0.125s a step. One second is eight steps, and the look-ahead
// commits a little past that.
ok(H.fired.length >= 8, 'a held chord actually produces notes', H.fired.length + ' in one second');
ok(H.fired.slice(0, 6).map((f) => f.note).join(' ') === '60 64 67 60 64 67',
   'in the order the mode says', H.fired.slice(0, 6).map((f) => f.note).join(' '));
ok(H.fired.every((f, i) => i === 0 || f.when >= H.fired[i - 1].when), 'each one scheduled after the last');
ok(Math.abs(H.fired[0].len - 0.0625) < 1e-6, 'and the gate sets the length, not the tempo alone',
   H.fired[0].len.toFixed(4) + 's at gate 0.5 of a 0.125s step');

// Releasing every key stops it. A latched-off arpeggiator that keeps running is
// a stuck note you cannot reach.
H = harness();
H.a.hold(60, 100); H.adv(0.3);
const before = H.fired.length;
H.a.release(60); H.adv(0.5);
ok(H.a.running === false, 'letting go stops it');
ok(H.fired.length === before, 'and nothing sounds after you let go',
   before + ' → ' + H.fired.length);

// LATCH keeps it going, and the whole chord survives — not just the last note
// released, which is what happens if you latch after removing rather than
// before.
H = harness({ latch: true });
H.a.hold(60, 100); H.a.hold(64, 100); H.a.hold(67, 100);
H.adv(0.2);
H.a.release(60); H.a.release(64); H.a.release(67);
const heldAfter = H.a.notes.slice().sort((x, y) => x - y);
H.adv(0.6);
ok(H.a.running === true, 'latched, it keeps running with no keys down');
ok(heldAfter.join(' ') === '60 64 67', 'and it keeps the WHOLE chord, not the last note released',
   heldAfter.join(' '));

// ...and pressing a new key while latched starts a new chord rather than
// growing the old one forever.
H.a.hold(72, 100);
ok(H.a.notes.join(' ') === '72', 'a new key while latched starts a new chord', H.a.notes.join(' '));
H.a.clear();
ok(H.a.running === false && H.a.notes.length === 0, 'and clear() really clears it');

// A rest in the rhythm must produce SILENCE, not a quiet note.
H = harness({ rhythm: R.RHYTHMS.find((r) => r.id === 'sparse').s });
H.a.hold(60, 100); H.a.hold(64, 100);
H.adv(2.0);
const bars = Math.floor(2.0 / (0.125 * 16));
ok(H.fired.length > 0 && H.fired.length <= 3, 'a sparse rhythm fires about once a bar, not every step',
   H.fired.length + ' notes in ' + (2.0 / (0.125 * 16)).toFixed(1) + ' bars');

// Octave spread reaches above the chord.
H = harness({ octaves: 2 });
H.a.hold(60, 100); H.a.hold(64, 100);
H.adv(1.0);
const highest = Math.max(...H.fired.map((f) => f.note));
ok(highest >= 72, 'two octaves of spread actually reaches the octave above', 'top note ' + highest);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
