// seq.cjs — eight channels, thirty-two bars, and the timing fix.
//
// Almost all of this is arithmetic on beats, so it is checked as arithmetic
// rather than by listening. The parts that get sequencers wrong are the ones
// with an edge in them: what happens at the loop seam, what happens when two
// channels are different lengths, and what happens to the playhead when the
// tempo changes while it is moving.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimseq-'));
const out = path.join(TMP, 'seq.cjs');
const src = path.join(ROOT, 'smk/src/core/seq.js').split(path.sep).join('/');
execSync(`npx --yes esbuild "${src}" --bundle --format=cjs --platform=node --outfile="${out}"`, { stdio: 'inherit' });
const S = require(out);

// ---- quantise -------------------------------------------------------------
const G16 = 0.25;
ok(S.snapOne(0.26, G16, 1, 16) === 0.25, 'a note just after the grid is pulled back onto it',
   S.snapOne(0.26, G16, 1, 16) + '');
ok(Math.abs(S.snapOne(0.30, G16, 0.5, 16) - 0.275) < 1e-9,
   'half strength moves it half way, so the feel survives',
   S.snapOne(0.30, G16, 0.5, 16).toFixed(4));
ok(S.snapOne(0.30, G16, 0, 16) === 0.30, 'zero strength leaves it exactly alone');
ok(S.snapOne(0.30, 0, 1, 16) === 0.30, 'and grid Off is not quantising at all');

// THE SEAM. A note played at 15.98 in a sixteen-beat loop is somebody reaching
// for the DOWNBEAT and arriving early. It belongs at 0. Rounding without
// wrapping puts it at 16 — outside the loop, so it never plays again.
ok(S.snapOne(15.98, G16, 1, 16) === 0, 'a note played just BEFORE the downbeat lands ON the downbeat',
   '15.98 → ' + S.snapOne(15.98, G16, 1, 16));
ok(S.snapOne(15.98, G16, 1, 16) < 16, 'and not one beat past the end of the loop, where it would never play again');
ok(S.snapOne(31.99, G16, 1, 32) === 0, 'the same at thirty-two beats', '31.99 → ' + S.snapOne(31.99, G16, 1, 32));
// Triplets must survive. Quantising a triplet part to straight sixteenths
// destroys it rather than tightening it, which is why the grid list has both.
const T8 = 1 / 3;
ok(Math.abs(S.snapOne(0.34, T8, 1, 16) - 1 / 3) < 1e-9, 'a triplet grid keeps triplets where they belong',
   S.snapOne(0.34, T8, 1, 16).toFixed(4));
ok(Math.abs(S.snapOne(0.34, G16, 1, 16) - 0.25) < 1e-9, '...and a straight grid would have moved it to 0.25 — which is why both exist');

const qz = S.quantize([{ at: 0.26 }, { at: 1.01 }], G16, 1, 16);
ok(qz[0].at === 0.25 && qz[1].at === 1, 'quantize() does the whole channel');
ok(S.GRIDS.length === 7 && S.GRIDS.some((g) => g.id === '1/8T'), 'seven grids, triplets included',
   S.GRIDS.map((g) => g.id).join(' '));

// ---- the machine ----------------------------------------------------------
// The clock is driven by hand and the scheduler is topped up through pump(),
// which is the same fill() the app's interval calls — not a stand-in for it.
function rig(bpm) {
  let t = 0;
  const fired = [];
  const q = S.createSeq({ now: () => t, onFire: (e, when, c) => fired.push({ note: e.note, when, ch: c.id }) });
  q.setBpm(bpm || 120);
  return { q, fired };
}

ok(S.MAX_CHANNELS === 8, 'eight channels', S.MAX_CHANNELS + '');
ok(S.MAX_BARS === 32, 'up to thirty-two bars', S.MAX_BARS + '');

// A channel is toggleable, and muting is not erasing.
{
  const { q } = rig();
  q.add(0, { note: 60, vel: 100, at: 0, len: 0.25 });
  ok(q.channels[0].on === true, 'a channel starts on');
  q.toggle(0);
  ok(q.channels[0].on === false, 'and toggles off');
  ok(q.channels[0].events.length === 1, 'without losing a single note', q.channels[0].events.length + '');
  q.toggle(0);
  ok(q.channels[0].on === true, 'and back on again');
}

// Shortening a channel folds its notes rather than deleting them.
{
  const { q } = rig();
  q.setBars(0, 4);
  q.add(0, { note: 60, at: 13.5, len: 0.25 });
  q.setBars(0, 2);
  ok(q.channels[0].events.length === 1, 'shortening a channel does not delete the take');
  ok(Math.abs(q.channels[0].events[0].at - 5.5) < 1e-9, 'it folds the note back into the shorter loop',
     '13.5 in 8 beats → ' + q.channels[0].events[0].at);
}

// Tempo change while running must not teleport the playhead.
{
  let t = 0;
  const q = S.createSeq({ now: () => t });
  q.setBpm(120); q.play();
  t = 2.03;                       // ~4 beats at 120bpm
  const before = q.beat;
  q.setBpm(240);
  const after = q.beat;
  ok(Math.abs(before - after) < 0.01, 'doubling the tempo mid-flight leaves the playhead where it was',
     before.toFixed(3) + ' → ' + after.toFixed(3) + ' beats');
  t = 2.53;
  ok(q.beat > after + 1.5, 'and it then runs at the NEW tempo', (q.beat - after).toFixed(2) + ' beats in 0.5s');
  q.stop();
}

// Two channels of different lengths run against each other correctly: the
// two-bar part comes round twice as often as the four-bar one, and neither
// needs the other copied out.
{
  let t = 0;
  const fired = [];
  const q = S.createSeq({ now: () => t, onFire: (e, when, c) => fired.push({ ch: c.id, when }) });
  q.setBpm(240);                                  // 0.25s a beat
  q.setBars(0, 1); q.setBars(1, 2);               // 4 beats vs 8 beats
  q.add(0, { note: 60, at: 0, len: 0.25 });
  q.add(1, { note: 62, at: 0, len: 0.25 });
  q.play();
  for (let k = 0; k < 260; k++) { t += 0.02; q.pump(); }   // ~5.2s ≈ 20 beats
  const a = fired.filter((f) => f.ch === 0).length;
  const b = fired.filter((f) => f.ch === 1).length;
  ok(a > 0 && b > 0, 'both channels play', a + ' and ' + b);
  ok(a >= b * 2 - 1 && a <= b * 2 + 1, 'a one-bar channel comes round twice as often as a two-bar one',
     a + ' vs ' + b);
  q.stop();
}

// Nothing fires twice. The window is half-open for exactly this reason — a
// closed interval fires the note on the boundary in both windows, and a doubled
// note is a flam nobody can find by looking at the pattern.
{
  let t = 0;
  const fired = [];
  const q = S.createSeq({ now: () => t, onFire: (e, when) => fired.push(when) });
  q.setBpm(120); q.setBars(0, 1);
  q.add(0, { note: 60, at: 0, len: 0.25 });
  q.add(0, { note: 62, at: 2, len: 0.25 });
  q.play();
  for (let k = 0; k < 200; k++) { t += 0.02; q.pump(); }   // 4s = 8 beats = 2 loops
  const dupes = fired.length - new Set(fired.map((x) => x.toFixed(4))).size;
  ok(dupes === 0, 'no note is ever scheduled twice', fired.length + ' notes, ' + dupes + ' duplicates');
  // NOT a count. The look-ahead legitimately commits a little past the window
  // being watched, so the number of notes depends on where the horizon happens
  // to fall — asserting "four" fails on correct behaviour. What must hold is
  // that every note landed on a beat the pattern actually has: 0 or 2 of each
  // four-beat loop, and nowhere else.
  const beats = fired.map((w) => Math.round(((w - 0.03) / 0.5) * 1000) / 1000);
  const offGrid = beats.filter((b) => Math.abs(b % 4) > 1e-6 && Math.abs((b % 4) - 2) > 1e-6);
  ok(offGrid.length === 0, 'and every note lands on a beat the pattern actually has',
     beats.join(' '));
  q.stop();
}

// A muted channel keeps its POSITION — unmuting drops it back in on the beat
// rather than restarting it from the top.
{
  let t = 0;
  const q = S.createSeq({ now: () => t });
  q.setBpm(120); q.setBars(0, 1);
  q.play();
  for (let k = 0; k < 60; k++) { t += 0.02; q.pump(); }
  q.toggle(0);
  const posMuted = q.positions()[0];
  for (let k = 0; k < 30; k++) { t += 0.02; q.pump(); }
  ok(q.positions()[0] !== posMuted, 'a muted channel keeps moving, so it comes back in time',
     posMuted.toFixed(3) + ' → ' + q.positions()[0].toFixed(3));
  q.stop();
}

// Recording quantises on the way IN, so the grid does not lie about where the
// note is — and the original timing is kept so it can be re-quantised without
// compounding.
{
  let t = 0;
  const q = S.createSeq({ now: () => t });
  q.setBpm(120); q.setBars(0, 1); q.setQuantize(0.25, 1);
  q.play(); q.arm(0);
  t = 0.03 + 0.14;                       // a bit after beat 0.25 (0.125s)
  q.capture({ note: 60, vel: 100, len: 0.25 });
  const e = q.channels[0].events[0];
  ok(e.at === 0.25, 'a recorded note is snapped as it is recorded', 'raw ' + e.raw.toFixed(3) + ' → ' + e.at);
  ok(e.raw !== 0.25, 'and the original timing is kept', e.raw.toFixed(4));
  q.requantize(0, 0.25, 0.5);
  ok(Math.abs(q.channels[0].events[0].at - (e.raw + (0.25 - e.raw) * 0.5)) < 1e-9,
     're-quantising works from the ORIGINAL, so passes do not compound',
     q.channels[0].events[0].at.toFixed(4));
  q.stop();
  ok(q.armed === -1, 'stopping disarms the recorder');
}

// Nothing records when the transport is not running — an armed channel that
// silently swallows notes while stopped is worse than one that refuses.
{
  let t = 0;
  const q = S.createSeq({ now: () => t });
  q.arm(0);
  ok(q.capture({ note: 60 }) === false && q.channels[0].events.length === 0,
     'nothing is captured while stopped');
}

// Save and restore.
{
  const { q } = rig();
  q.setBars(2, 16); q.toggle(3);
  q.add(2, { note: 64, vel: 90, at: 1.5, len: 0.5 });
  const snap = q.snapshot();
  const { q: q2 } = rig();
  q2.restore(snap);
  ok(q2.channels[2].bars === 16 && q2.channels[3].on === false,
     'a snapshot round-trips lengths and mutes');
  ok(q2.channels[2].events.length === 1 && q2.channels[2].events[0].at === 1.5,
     'and the notes', JSON.stringify(q2.channels[2].events[0]));
}

// A minimal Standard MIDI File reader, so the export can be CHECKED rather than
// searched. Delta times are variable-length and running status omits the status
// byte entirely, so the only way to know what a byte means is to have read
// everything before it.
function parseMidi(b) {
  let p = 0;
  const u32 = () => { const v = b.readUInt32BE(p); p += 4; return v; };
  const u16 = () => { const v = b.readUInt16BE(p); p += 2; return v; };
  const vlq = () => { let v = 0, c; do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
  if (b.slice(p, p + 4).toString('ascii') !== 'MThd') throw new Error('not a MIDI file');
  p += 4; u32(); u16(); const nTracks = u16(); u16();
  let on = 0, off = 0, tracks = 0;
  for (let t = 0; t < nTracks; t++) {
    if (b.slice(p, p + 4).toString('ascii') !== 'MTrk') throw new Error('missing MTrk');
    p += 4;
    const len = u32();
    const end = p + len;
    let status = 0, done = false;
    while (p < end) {
      vlq();
      let s0 = b[p];
      if (s0 & 0x80) { status = s0; p++; } // else running status: reuse the last
      if (status === 0xff) {
        const type = b[p++]; const n = vlq();
        if (type === 0x2f) done = true;
        p += n;
      } else if (status === 0xf0 || status === 0xf7) {
        const n = vlq(); p += n;
      } else {
        const hi = status & 0xf0;
        const d1 = b[p++];
        const d2 = (hi === 0xc0 || hi === 0xd0) ? 0 : b[p++];
        if (hi === 0x90 && d2 > 0) on++;
        else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) off++;
      }
    }
    if (done) tracks++;
    p = end;
  }
  return { on, off, tracks };
}

// ---- export ---------------------------------------------------------------
{
  const { q } = rig(140);
  q.setBars(0, 1); q.setBars(1, 2);
  q.add(0, { note: 36, vel: 110, at: 0, len: 0.25 });
  q.add(0, { note: 38, vel: 90, at: 2, len: 0.25 });
  q.add(1, { note: 60, vel: 100, at: 0, len: 1 });
  const bytes = S.toMidi(q.snapshot());
  const b = Buffer.from(bytes);
  ok(b.slice(0, 4).toString('ascii') === 'MThd', 'the export really is a MIDI file', b.slice(0, 4).toString('ascii'));
  ok(b.readUInt16BE(8) === 1, 'type 1 — one track per channel, not one flattened lump');
  // Two channels with notes, plus the tempo map.
  ok(b.readUInt16BE(10) === 3, 'so two used channels make three tracks', b.readUInt16BE(10) + '');
  const tracks = b.toString('latin1').split('MTrk').length - 1;
  ok(tracks === 3, 'and three MTrk chunks are actually present', tracks + '');
  // The tempo map must carry the tempo the app was at, not a default.
  const i = b.indexOf(Buffer.from([0xff, 0x51, 0x03]));
  const us = (b[i + 3] << 16) | (b[i + 4] << 8) | b[i + 5];
  ok(Math.abs(60000000 / us - 140) < 0.5, 'carrying the real tempo', (60000000 / us).toFixed(1) + ' bpm');
  // Every note-on must have a note-off. A file with a hanging note plays one
  // chord forever in whatever it is opened in.
  //
  // PARSED, not scanned. Counting bytes whose high nibble is 0x80 also counts
  // every VLQ continuation byte and half the delta times — the first version of
  // this check reported five note-ons and TEN note-offs for a file that was
  // perfectly balanced. A format with variable-length fields cannot be searched
  // for, only read.
  const parsed = parseMidi(b);
  ok(parsed.on > 0 && parsed.on === parsed.off, 'and every note is turned off again',
     parsed.on + ' on, ' + parsed.off + ' off');
  ok(parsed.tracks === 3, 'the parser walks every track cleanly to its end marker',
     parsed.tracks + ' tracks read');
  ok(b.length > 60, 'the file has actual content in it', b.length + ' bytes');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
