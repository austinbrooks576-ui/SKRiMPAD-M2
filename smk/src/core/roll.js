// roll.js — the piano roll and the arrangement timeline, as arithmetic.
//
// Both views are the same idea twice: a rectangle of screen showing a window
// onto time, with something stacked up the other axis. The piano roll stacks
// PITCH; the timeline stacks CHANNELS. So the geometry lives here once, as
// pure functions, and both views are a canvas plus a hit test.
//
// WHY NONE OF THIS TOUCHES THE DOM. A piano roll is a coordinate transform
// wearing a UI, and the bugs in one are always off-by-a-half-cell: a note that
// draws one row above where it plays, a click that lands on the black key
// beside the one you aimed at, a drag that snaps to the wrong side of the
// grid. Every one of those is checkable arithmetic, and none of it is
// checkable through a canvas — you cannot ask a canvas what it drew.
//
// THE ROUND TRIP IS THE CONTRACT: for any note, hitTest(rectFor(note)) must
// return that note. Everything else follows from it.

export const BEATS_PER_BAR = 4;

// SEVEN OCTAVES, as asked for. C0..B6 in MIDI terms is 12..95 — but the range
// is expressed as a base note and a count so the view can be scrolled without
// any other number having to agree with it.
export const ROLL_OCTAVES = 7;
export const ROLL_LO = 24;                      // C1, the bottom of the roll
export const ROLL_ROWS = ROLL_OCTAVES * 12;     // 84 rows
export const ROLL_HI = ROLL_LO + ROLL_ROWS - 1;

const BLACK = new Set([1, 3, 6, 8, 10]);
export const isBlack = (note) => BLACK.has(((note % 12) + 12) % 12);

// The transform. Everything below is derived from it, so there is exactly one
// place where a pixel becomes a beat.
//
//   w,h        the drawing area
//   bars       how many bars are in view
//   startBeat  the beat at the left edge (scroll)
//   loNote     the note at the BOTTOM row (scroll, vertically)
//   rows       how many note rows are visible
export function rollGeom({ w, h, bars = 4, startBeat = 0, loNote = 48, rows = 24, keyW = 34 }) {
  const beats = Math.max(1, bars) * BEATS_PER_BAR;
  const gridW = Math.max(1, w - keyW);
  return {
    w, h, keyW, gridW, bars, beats, startBeat, loNote, rows,
    pxPerBeat: gridW / beats,
    rowH: h / Math.max(1, rows),
  };
}

// Beat → x, and back. The keyboard gutter on the left is part of the widget
// and not part of the timeline, so it is added on one side and subtracted on
// the other — forgetting one half is the classic "everything is 34px off".
export const beatToX = (g, beat) => g.keyW + (beat - g.startBeat) * g.pxPerBeat;
export const xToBeat = (g, x) => g.startBeat + (x - g.keyW) / g.pxPerBeat;

// Note → y, and back. Y GROWS DOWNWARD and pitch grows upward, so this is the
// one place the axis is flipped. `noteToY` returns the TOP of the row, which is
// why the flip uses (note - lo + 1) — a row's top is the next note's baseline.
export const noteToY = (g, note) => g.h - (note - g.loNote + 1) * g.rowH;
// CEIL MINUS ONE, not floor. A row owns [top, top + rowH) — half-open, the same
// interval hitTest uses — and at exactly `top` the floor form returns the note
// ABOVE, because (h - top) / rowH lands precisely on the boundary. So the top
// pixel row of every note in the roll selected its neighbour, which is the
// off-by-a-half-cell that every piano roll ever written has had.
export const yToNote = (g, y) => g.loNote + Math.ceil((g.h - y) / g.rowH) - 1;

// The rectangle a note occupies. `len` is in beats and has a floor: a
// zero-length note is invisible and therefore unclickable, which makes it
// impossible to delete without a "select all" nobody has.
export function rectFor(g, ev) {
  const len = Math.max(0.0625, ev.len || 0.25);
  return {
    x: beatToX(g, ev.at),
    y: noteToY(g, ev.note),
    w: Math.max(3, len * g.pxPerBeat),
    h: g.rowH,
  };
}

// Which note is under the pointer? LAST MATCH WINS, because later events are
// drawn on top of earlier ones and the thing you can see is the thing you
// expect to grab.
export function hitTest(events, g, x, y) {
  for (let i = events.length - 1; i >= 0; i--) {
    const r = rectFor(g, events[i]);
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
  }
  return -1;
}

// Is the pointer on a note's right-hand edge? That is the resize handle, and
// it is measured in PIXELS rather than as a fraction of the note — a fraction
// makes the handle on a sixteenth note two pixels wide and the handle on a
// whole note enormous.
export function onResizeEdge(g, ev, x) {
  const r = rectFor(g, ev);
  return x >= r.x + r.w - Math.min(9, r.w * 0.45) && x < r.x + r.w;
}

// Where a click lands, snapped. `grid` is in beats; 0 means no snapping.
// Clamped into the loop so a note can never be placed past the end, where it
// would be stored, drawn, and never played.
export function placeAt(g, x, y, grid, loopBeats) {
  const raw = xToBeat(g, x);
  const snapped = grid > 0 ? Math.floor(raw / grid) * grid : raw;
  const at = Math.max(0, Math.min((loopBeats || g.beats) - 0.0625, snapped));
  return { at, note: Math.max(0, Math.min(127, yToNote(g, y))) };
}

// ---- the arrangement timeline ----------------------------------------------
// The same transform with channels up the side instead of pitch. Lanes are a
// fixed height rather than h/count, because eight lanes on a phone would be
// nine pixels each and a lane you cannot hit is a lane you do not have.
export function laneGeom({ w, h, bars = 8, startBeat = 0, lanes = 8, laneH = 34, headW = 92 }) {
  const beats = Math.max(1, bars) * BEATS_PER_BAR;
  const gridW = Math.max(1, w - headW);
  return { w, h, headW, gridW, bars, beats, startBeat, lanes, laneH,
           pxPerBeat: gridW / beats };
}
export const laneBeatToX = (g, beat) => g.headW + (beat - g.startBeat) * g.pxPerBeat;
export const laneToY = (g, i) => i * g.laneH;
export const yToLane = (g, y) => Math.floor(y / g.laneH);

// A channel's block on the timeline: where its loop starts and how far it
// repeats across the visible bars. A two-bar part under an eight-bar view is
// FOUR blocks, which is the whole point of drawing it — you can see that it
// repeats without anybody having copied it out.
export function blocksFor(g, chanBars, viewBars) {
  const len = Math.max(1, chanBars) * BEATS_PER_BAR;
  const total = Math.max(1, viewBars) * BEATS_PER_BAR;
  const out = [];
  for (let beat = 0; beat < total; beat += len) {
    out.push({ at: beat, beats: Math.min(len, total - beat),
               x: laneBeatToX(g, beat), w: Math.min(len, total - beat) * g.pxPerBeat });
  }
  return out;
}
