// roll.cjs — the piano roll and the timeline, checked as coordinate maths.
//
// The bug in every piano roll ever written is off-by-a-half-cell: a note that
// draws one row above where it plays, a click that lands on the black key
// beside the one you aimed at, a drag that snaps to the wrong side of the
// grid. All of those are arithmetic, and none of them are visible through a
// canvas — you cannot ask a canvas what it drew.
//
// THE ROUND TRIP IS THE CONTRACT: hitTest(rectFor(note)) must return that note,
// for every note, at every zoom. It is swept rather than sampled.
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const os = require('os');

let pass = 0, fail = 0;
const ok = (c, m, x) => { c ? (pass++, console.log('PASS ' + m + (x ? ' | ' + x : '')))
                            : (fail++, console.log('FAIL ' + m + (x ? ' | ' + x : ''))); };

const ROOT = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'skrimroll-'));
const out = path.join(TMP, 'roll.cjs');
const src = path.join(ROOT, 'smk/src/core/roll.js').split(path.sep).join('/');
execSync(`npx --yes esbuild "${src}" --bundle --format=cjs --platform=node --outfile="${out}"`, { stdio: 'inherit' });
const R = require(out);

// ---- the range asked for --------------------------------------------------
ok(R.ROLL_OCTAVES === 7 && R.ROLL_ROWS === 84, 'seven octaves, eighty-four rows',
   R.ROLL_OCTAVES + ' octaves / ' + R.ROLL_ROWS + ' rows');
ok(R.ROLL_HI - R.ROLL_LO === 83, 'spanning exactly seven octaves of notes',
   R.ROLL_LO + '..' + R.ROLL_HI);
ok(R.isBlack(61) && R.isBlack(63) && !R.isBlack(60) && !R.isBlack(64),
   'and it knows a black key from a white one', 'C#4 and D#4 black, C4 and E4 white');

// ---- the transform --------------------------------------------------------
const g = R.rollGeom({ w: 800, h: 480, bars: 4, startBeat: 0, loNote: 48, rows: 24, keyW: 34 });
ok(Math.abs(g.pxPerBeat - (800 - 34) / 16) < 1e-9, 'the grid width excludes the key gutter',
   g.pxPerBeat.toFixed(3) + 'px per beat across ' + g.gridW + 'px');
ok(R.beatToX(g, 0) === 34, 'beat zero is at the right edge of the gutter, not at zero',
   R.beatToX(g, 0) + 'px');
ok(Math.abs(R.xToBeat(g, R.beatToX(g, 7.25)) - 7.25) < 1e-9, 'beat→x→beat round-trips');

// THE FLIP. Pitch grows up, y grows down, and this is the only place that is
// true — get it wrong and every note draws one row out.
ok(R.noteToY(g, 48) === g.h - g.rowH, 'the lowest visible note sits on the bottom row',
   R.noteToY(g, 48) + 'px of ' + g.h);
ok(R.noteToY(g, 49) < R.noteToY(g, 48), 'and a higher note is higher up the screen');
ok(R.yToNote(g, R.noteToY(g, 60)) === 60, 'note→y→note round-trips on the row TOP');
ok(R.yToNote(g, R.noteToY(g, 60) + g.rowH - 0.001) === 60, '...and anywhere inside the row');
ok(R.yToNote(g, R.noteToY(g, 60) - 0.001) === 61, '...and one pixel above it is the next note up');
// SWEPT ON THE EDGES, because the centre of a row can be right while both its
// boundaries are wrong — which is exactly what happened here.
let edgeBad = [];
for (let n = 48; n < 72; n++) {
  const top = R.noteToY(g, n);
  if (R.yToNote(g, top) !== n) edgeBad.push('top of ' + n);
  if (R.yToNote(g, top + g.rowH - 1e-6) !== n) edgeBad.push('bottom of ' + n);
}
ok(edgeBad.length === 0, 'every row owns its top edge and not the row above it',
   edgeBad.length ? edgeBad.slice(0, 3).join(', ') : '24 rows, both edges each');

// ---- the round trip, SWEPT ------------------------------------------------
// Every visible note, at four zooms, with three lengths. A single example
// cannot find "correct at 4 bars, one row out at 16".
let round = 0, bad = [];
for (const bars of [1, 2, 4, 16]) {
  for (const rows of [12, 24, 84]) {
    const gg = R.rollGeom({ w: 900, h: 600, bars, startBeat: 0, loNote: 36, rows });
    for (let n = 36; n < 36 + rows; n++) {
      for (const len of [0.25, 1, 4]) {
        const ev = { note: n, at: 0.5, len };
        const r = R.rectFor(gg, ev);
        // the centre of the drawn rectangle must find the note it drew
        const i = R.hitTest([ev], gg, r.x + r.w / 2, r.y + r.h / 2);
        round++;
        if (i !== 0) bad.push('bars' + bars + ' rows' + rows + ' note' + n + ' len' + len);
      }
    }
  }
}
ok(bad.length === 0, 'every note, at every zoom, is found where it is drawn',
   round + ' round trips swept' + (bad.length ? ' — ' + bad.slice(0, 3).join(', ') : ''));

// A click OUTSIDE a note must find nothing — a roll where empty space returns
// the nearest note makes it impossible to add a note next to one.
const ev1 = { note: 60, at: 1, len: 0.5 };
const r1 = R.rectFor(g, ev1);
ok(R.hitTest([ev1], g, r1.x - 4, r1.y + 2) === -1, 'empty space to the left of a note is empty');
ok(R.hitTest([ev1], g, r1.x + r1.w + 4, r1.y + 2) === -1, 'and to the right of it');
ok(R.hitTest([ev1], g, r1.x + 2, r1.y - 4) === -1, 'and the row above it');

// OVERLAPPING NOTES: the one on top is the one you grab.
const stack = [{ note: 60, at: 1, len: 2 }, { note: 60, at: 1.5, len: 0.5 }];
const rTop = R.rectFor(g, stack[1]);
ok(R.hitTest(stack, g, rTop.x + 2, rTop.y + 2) === 1,
   'where two notes overlap, the one drawn on top is the one you hit');

// ---- resize handle --------------------------------------------------------
ok(R.onResizeEdge(g, ev1, r1.x + r1.w - 2), 'the right edge of a note is its resize handle');
ok(!R.onResizeEdge(g, ev1, r1.x + 2), 'and its left edge is not');
// A tiny note must still be draggable — a handle that eats the whole note
// means a sixteenth can be resized and never moved.
const tiny = { note: 60, at: 1, len: 0.0625 };
const rt = R.rectFor(g, tiny);
ok(!R.onResizeEdge(g, tiny, rt.x + 1), 'and on a very short note the handle does not eat the whole thing',
   'width ' + rt.w.toFixed(1) + 'px');

// ---- placing ---------------------------------------------------------------
const p1 = R.placeAt(g, R.beatToX(g, 2.34), R.noteToY(g, 55) + 3, 0.25, 16);
ok(p1.note === 55, 'placing a note lands on the row under the pointer', 'note ' + p1.note);
ok(Math.abs(p1.at - 2.25) < 1e-9, 'and snaps BACK to the grid line, not forward to the next one',
   '2.34 → ' + p1.at);
const p2 = R.placeAt(g, R.beatToX(g, 15.99), 10, 0.25, 16);
ok(p2.at < 16, 'a note placed at the very end stays inside the loop, where it will actually play',
   p2.at + ' < 16');
const p3 = R.placeAt(g, R.beatToX(g, -5), 10, 0.25, 16);
ok(p3.at === 0, 'and one dragged off the left clamps to the start', p3.at + '');
const p4 = R.placeAt(g, R.beatToX(g, 2.34), 10, 0, 16);
ok(Math.abs(p4.at - 2.34) < 1e-9, 'snapping off places it exactly where you clicked', p4.at.toFixed(2));

// ---- the arrangement timeline ---------------------------------------------
const L = R.laneGeom({ w: 1000, h: 280, bars: 8, lanes: 8, laneH: 34, headW: 92 });
ok(R.laneToY(L, 0) === 0 && R.laneToY(L, 3) === 102, 'lanes stack at a fixed height',
   '34px each — lane 3 at ' + R.laneToY(L, 3));
ok(R.yToLane(L, 105) === 3, 'and a click finds the lane it landed in');
ok(R.yToLane(L, R.laneToY(L, 5) + 1) === 5, 'for every lane', 'lane 5 round-trips');

// A two-bar part across an eight-bar view is FOUR blocks. Drawing the repeats
// is the whole point: you can see the part repeat without anyone copying it.
const b2 = R.blocksFor(L, 2, 8);
ok(b2.length === 4, 'a two-bar channel draws four blocks across eight bars', b2.length + ' blocks');
ok(b2[0].at === 0 && b2[1].at === 8 && b2[3].at === 24, 'each starting a loop-length apart',
   b2.map((x) => x.at).join(', '));
const b8 = R.blocksFor(L, 8, 8);
ok(b8.length === 1, 'and an eight-bar channel is one block', b8.length + '');
// A channel LONGER than the view is clipped, not drawn off the end.
const b32 = R.blocksFor(L, 32, 8);
ok(b32.length === 1 && Math.abs(b32[0].beats - 32) < 1e-9,
   'a channel longer than the view is one block, clipped to what is on screen',
   b32[0].beats + ' beats shown');

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
