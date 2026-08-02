// schematic.js — render a profile as a clean, top-down line-art schematic of the
// controller (the M-Wave SMK-25 box aesthetic). Framework-free SVG.
//
//   const svg = renderSchematic(profile, { theme });
//   host.appendChild(svg);
//
// Every playable element carries dataset hooks so the other modules can bind to
// it without re-querying geometry:
//   data-role   = key | pad | knob | transport | wheel
//   data-index  = 0-based index within its group
//   data-note   = MIDI note (keys/pads)   data-name = transport/wheel name
//   data-drop   = "1" on drop targets (keys + pads) for the library sidebar
//   data-hold   = "1" on elements that open the 6s hold menu (apk)

import { DEFAULT_THEME, contraryColor } from '../styles/theme.js';
import { padNumberAt } from './identify.js';

const SVG = 'http://www.w3.org/2000/svg';
const BLACK_PCS = new Set([1, 3, 6, 8, 10]); // semitone classes that are accidentals

// geometry
const P = 26;            // outer padding
const GAP = 18;          // gap between regions
const WKEY_W = 26, WKEY_H = 104, BKEY_W = 15, BKEY_H = 64;
const PAD = 48, PAD_GAP = 9;
const KNOB_R = 17, KNOB_GAP = 12;
const TR_W = 42, TR_H = 30, TR_GAP = 8;
const WHEEL_W = 22, WHEEL_H = 100, WHEEL_GAP = 10;

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function g(parent, x = 0, y = 0) { return el('g', { transform: `translate(${x},${y})` }, parent); }
function label(parent, x, y, text, fill, size = 9) {
  const t = el('text', {
    x, y, fill, 'font-size': size, 'font-weight': 800,
    'letter-spacing': '.12em', 'text-anchor': 'middle',
    'font-family': "'Oswald','Arial Narrow',sans-serif",
  }, parent);
  t.textContent = text;
  return t;
}

// ---- region renderers (each returns {w,h}) ---------------------------------

function drawWheels(parent, wheels, theme) {
  let x = 0;
  wheels.forEach((name, i) => {
    const gr = g(parent, x, 0);
    el('rect', {
      x: 0, y: 0, width: WHEEL_W, height: WHEEL_H, rx: 6,
      fill: 'none', stroke: theme.ink, 'stroke-width': 1.5,
      'data-role': 'wheel', 'data-index': i, 'data-name': name,
    }, gr);
    el('line', { x1: 3, y1: WHEEL_H / 2, x2: WHEEL_W - 3, y2: WHEEL_H / 2, stroke: theme.mute, 'stroke-width': 1 }, gr);
    label(gr, WHEEL_W / 2, WHEEL_H + 12, name.toUpperCase(), theme.mute, 8);
    x += WHEEL_W + WHEEL_GAP;
  });
  return { w: Math.max(0, x - WHEEL_GAP), h: WHEEL_H + 14 };
}

function drawTransport(parent, transport, theme) {
  const glyph = { play: '▶', stop: '■', rec: '●' };
  let x = 0;
  transport.forEach((name, i) => {
    const gr = g(parent, x, 0);
    el('rect', {
      x: 0, y: 0, width: TR_W, height: TR_H, rx: 5,
      fill: 'none', stroke: theme.ink, 'stroke-width': 1.5,
      'data-role': 'transport', 'data-index': i, 'data-name': name,
      'data-hold': '1',
    }, gr);
    const t = label(gr, TR_W / 2, TR_H / 2 + 4, glyph[name] || name, name === 'rec' ? theme.accent : theme.ink, 13);
    t.setAttribute('letter-spacing', '0');
    x += TR_W + TR_GAP;
  });
  return { w: Math.max(0, x - TR_GAP), h: TR_H + 12 };
}

const BTN_LABEL = {
  arp: 'ARP', scch: 'SCCH', bt: 'BT', knobB: 'KNOB-B', padB: 'PAD-B',
  'oct-': 'OCT−', 'oct+': 'OCT+',
  // JamJum JP-1: six printed buttons, each with a short and a long press action
  b1: 'B1', b2: 'B2', b3: 'B3', b4: 'B4', b5: 'B5', b6: 'B6',
};
function drawButtons(parent, buttons, theme) {
  const BW = 52, BH = 22, BG = 7, PER = 4;
  let x = 0, y = 0, col = 0, maxX = 0;
  buttons.forEach((name, i) => {
    const gr = g(parent, x, y);
    const isBank = name === 'knobB' || name === 'padB';
    el('rect', {
      x: 0, y: 0, width: BW, height: BH, rx: 4,
      fill: 'none', stroke: isBank ? theme.accent : theme.ink, 'stroke-width': 1.4,
      'data-role': 'button', 'data-index': i, 'data-name': name,
      'data-bank-toggle': isBank ? '1' : null, 'data-hold': '1',
    }, gr);
    const t = label(gr, BW / 2, BH / 2 + 3, BTN_LABEL[name] || name.toUpperCase(), isBank ? theme.accent : theme.ink, 8);
    t.setAttribute('letter-spacing', '.06em');
    maxX = Math.max(maxX, x + BW);
    col++; x += BW + BG;
    if (col >= PER) { col = 0; x = 0; y += BH + BG; }
  });
  return { w: maxX, h: y + (col ? BH : 0) };
}

// Each knob is LABELLED with the job it does. A bare row of circles tells you
// nothing about what turning one will change — and until now most of them
// changed nothing at all, which the drawing had no way of showing either.
// The printed caption and the engine's parameter name are NOT the same string —
// "VOL" reads better on a 34px knob than "volume". Keep both, and publish the
// real parameter name in data-param so anything reading the drawing addresses
// the engine correctly rather than guessing from the caption.
const KNOB_LABELS = ['VOL', 'TONE', 'CUTOFF', 'RES', 'ATTACK', 'RELEASE', 'SPACE', 'DRUMS'];
const KNOB_PARAMS = ['volume', 'tone', 'cutoff', 'resonance', 'attack', 'release', 'space', 'drums'];
function drawKnobs(parent, count, theme) {
  const perRow = Math.min(count, 4);
  const ROW_H = KNOB_R * 2 + KNOB_GAP + 9;      // room for the caption under each
  let x = 0, y = KNOB_R, maxX = 0, row = 0, col = 0;
  for (let i = 0; i < count; i++) {
    const cx = x + KNOB_R, cy = y;
    const gr = g(parent, 0, 0);
    const job = KNOB_LABELS[i % KNOB_LABELS.length];
    // A flat outlined circle reads as a hole in the panel, not a control you
    // can grab. Build it the way the rest of the app builds raised surfaces:
    // one light source above-left, so the body shades along that axis, the
    // specular lands where the light would actually hit, and the shadow falls
    // opposite. The value track is a recessed groove the fill rides in.
    const uid = 'kn' + i + '_' + Math.round(cx) + '_' + Math.round(cy);
    const defs = el('defs', {}, gr);
    const bg = el('radialGradient', { id: uid + 'b', cx: '34%', cy: '26%', r: '78%' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#4a5163' }, bg);
    el('stop', { offset: '52%', 'stop-color': '#2b303c' }, bg);
    el('stop', { offset: '100%', 'stop-color': '#171a22' }, bg);
    const rim = el('linearGradient', { id: uid + 'r', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#7b8399' }, rim);
    el('stop', { offset: '45%', 'stop-color': '#333a49' }, rim);
    el('stop', { offset: '100%', 'stop-color': '#0d0f14' }, rim);
    const spc = el('linearGradient', { id: uid + 's', x1: 0, y1: 0, x2: 0.4, y2: 1 }, defs);
    el('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': '.30' }, spc);
    el('stop', { offset: '60%', 'stop-color': '#fff', 'stop-opacity': '0' }, spc);

    const AR = KNOB_R + 3.2, A0 = 220, SW = 280;
    const arcP = (a0, a1) => {
      const pt = (a) => [cx + AR * Math.cos(a * Math.PI / 180), cy + AR * Math.sin(a * Math.PI / 180)];
      const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
      return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + AR + ' ' + AR + ' 0 ' +
        (Math.abs(a1 - a0) > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2);
    };
    el('path', { d: arcP(A0, A0 + SW), fill: 'none', stroke: '#0b0d12', 'stroke-width': 3, 'stroke-linecap': 'round' }, gr);
    el('path', { d: arcP(A0, A0 + SW * 0.5), fill: 'none', stroke: theme.accent, 'stroke-width': 2.4,
      'stroke-linecap': 'round', 'stroke-opacity': '.9', 'data-role': 'knobarc', 'data-index': i }, gr);
    el('ellipse', { cx, cy: cy + 1.6, rx: KNOB_R - 0.8, ry: KNOB_R - 2, fill: '#000', opacity: '.45' }, gr);
    el('circle', { cx, cy, r: KNOB_R, fill: 'url(#' + uid + 'r)' }, gr);
    // the hit target keeps its role hooks and stays the element the router binds
    el('circle', {
      cx, cy, r: KNOB_R - 0.8, fill: 'url(#' + uid + 'b)', stroke: '#000', 'stroke-opacity': '.55', 'stroke-width': 1,
      'data-role': 'knob', 'data-index': i, 'data-hold': '1',
      'data-param': KNOB_PARAMS[i % KNOB_PARAMS.length],
    }, gr);
    el('ellipse', { cx: cx - KNOB_R * 0.24, cy: cy - KNOB_R * 0.34, rx: KNOB_R * 0.48, ry: KNOB_R * 0.29,
      fill: 'url(#' + uid + 's)', transform: 'rotate(-28 ' + (cx - KNOB_R * 0.24) + ' ' + (cy - KNOB_R * 0.34) + ')' }, gr);
    // pointer tick at ~ -45°
    el('line', { x1: cx - KNOB_R * 0.22, y1: cy - KNOB_R * 0.22, x2: cx - KNOB_R * 0.66, y2: cy - KNOB_R * 0.66,
      stroke: '#eef3ff', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, gr);
    el('circle', { cx, cy, r: KNOB_R * 0.2, fill: '#20242f', stroke: '#000', 'stroke-opacity': '.6', 'stroke-width': .7 }, gr);
    const cap = label(gr, cx, cy + KNOB_R + 8, job, theme.mute, 7.2);
    cap.setAttribute('letter-spacing', '.06em');
    maxX = Math.max(maxX, cx + KNOB_R);
    col++; x += KNOB_R * 2 + KNOB_GAP;
    if (col >= perRow) { col = 0; row++; x = 0; y += ROW_H; }
  }
  return { w: maxX, h: (row + (col ? 1 : 0)) * ROW_H };
}

function drawPads(parent, pads, theme) {
  const [rows, cols] = pads.layout && pads.layout[0] ? pads.layout : squareish(pads.count);
  // Learned note per pad wins over the GM default — see learnPadGrid() in
  // identify.js. Pads not yet played keep the GM note so the board is playable
  // by touch from the first frame.
  // GM fallback follows the same hardware numbering, so the default kick lands on
  // pad 1 at the bottom-left rather than wherever the draw order happens to start.
  const noteFor = (i) => (pads.notes && pads.notes[i] != null
    ? pads.notes[i]
    : gmDrumNote(padNumberAt(i, rows, cols) - 1));
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && i < pads.count; c++, i++) {
      const x = c * (PAD + PAD_GAP), y = r * (PAD + PAD_GAP);
      const gr = g(parent, x, y);
      const learned = !!(pads.notes && pads.notes[i] != null);
      // Pads are numbered from the BOTTOM-LEFT going right then up — pad 1 at the
      // bottom-left, pad 16 at the top-right — matching the hardware. We draw
      // top-down, so the printed number is not the draw index.
      const padNo = padNumberAt(i, rows, cols);
      el('rect', {
        x: 0, y: 0, width: PAD, height: PAD, rx: 7,
        fill: 'none', stroke: learned ? theme.accent : theme.ink, 'stroke-width': learned ? 1.8 : 1.5,
        'data-role': 'pad', 'data-index': i, 'data-pad': padNo, 'data-note': noteFor(i),
        'data-drop': '1', 'data-hold': '1',
      }, gr);
      label(gr, PAD / 2, PAD / 2 + 3, 'PAD ' + padNo, theme.mute, 8);
    }
  }
  return { w: cols * (PAD + PAD_GAP) - PAD_GAP, h: rows * (PAD + PAD_GAP) - PAD_GAP };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LEGEND_H = 38; // space above the keybed for the printed label rows
// Legend baselines. Labels sit at EVERY key centre — white and black centres are
// only half a key apart, so a single baseline makes wide words ("SWING+", "TEMPO-")
// collide. Staggering accidentals onto their own baseline gives each row a full
// key-width of space and keeps the printed legend readable at any board size.
const LEG_TOP_W = 10, LEG_TOP_B = 17.5, LEG_BOT_W = 27, LEG_BOT_B = 34.5;

function octOf(note) { return Math.floor(note / 12) - 1; } // MIDI: C4=60 → octave 4

// Keyboard renderer with AUTO-WINDOWING. If the full board would force keys below a
// playable minimum width (`minKeyW`), it renders an abridged span of `visibleWhites`
// white keys and adds OCTAVE paging (◀8VE / 8VE▶) plus a range map — instead of
// squashing 60+ keys illegibly. On a wide surface it shows the whole board.
// Legend (note-names / SC-CH / ARP rows) renders for whichever keys are visible.
function drawKeyboard(parent, keys, theme, targetWidth, opts = {}) {
  const first = keys.firstNote ?? 48;
  const count = keys.count;
  const acc = contraryColor(theme.whiteKey);
  const legend = keys.legend || {};
  const arp = legend.arp || [], scch = legend.scch || {};
  const minKeyW = opts.minKeyW || 24;

  // full note list + white index
  const notes = [];
  for (let n = 0; n < count; n++) { const note = first + n; notes.push({ note, i: n, black: BLACK_PCS.has(note % 12) }); }
  const whites = notes.filter((x) => !x.black);
  const whiteTotal = whites.length;

  // decide full vs windowed
  const fitsFull = whiteTotal * minKeyW <= targetWidth + 0.5;
  let visibleWhites = whiteTotal, startWhite = 0, windowed = false;
  if (!fitsFull) {
    windowed = true;
    visibleWhites = Math.max(7, Math.min(whiteTotal, Math.floor(targetWidth / minKeyW)));
    startWhite = Math.max(0, Math.min(opts.startWhite | 0, whiteTotal - visibleWhites));
  }
  const startIdx = notes.indexOf(whites[startWhite]);
  const endIdx = notes.indexOf(whites[startWhite + visibleWhites - 1]);
  const vis = notes.slice(startIdx, endIdx + 1);

  const wkW = targetWidth / visibleWhites;
  const wkH = Math.max(88, Math.min(WKEY_H, wkW * 3.1));
  const bkW = wkW * 0.58, bkH = wkH * 0.62;

  // place visible keys + legend anchors
  let wi = 0; const vw = [], vb = [], labels = [];
  for (const nd of vis) {
    let cx;
    if (nd.black) { const x = wi * wkW - bkW / 2; vb.push({ ...nd, x }); cx = x + bkW / 2; }
    else { const x = wi * wkW; vw.push({ ...nd, x }); cx = x + wkW / 2; wi++; }
    labels.push({ cx, black: nd.black, top: nd.i < 12 ? NOTE_NAMES[nd.note % 12] : (scch[nd.i] || ''), bot: arp[nd.i] || '' });
  }
  // Font scales with key width so long words still fit; accidentals drop to their
  // own baseline so neighbouring labels can never overlap.
  const legFont = Math.max(4.6, Math.min(6.6, wkW * 0.2));
  // A legend rendered below ~5.5 units is a grey smear, not information — it
  // measured 4px on screen on a narrow board. Past that point drop the printed
  // ARP / SC-CH rows and keep only the note names, which are short enough to
  // stay readable. Better to show less than to show something unreadable.
  const legible = legFont >= 5.5;
  labels.forEach((l) => {
    if (l.top && (legible || l.top.length <= 2)) {
      const t = label(parent, l.cx, l.black ? LEG_TOP_B : LEG_TOP_W, l.top, l.black ? acc : theme.ink, Math.max(5.2, legFont));
      t.setAttribute('letter-spacing', '0');
    }
    if (l.bot && legible) {
      const t = label(parent, l.cx, l.black ? LEG_BOT_B : LEG_BOT_W, l.bot, theme.mute, legFont);
      t.setAttribute('letter-spacing', '0');
    }
  });
  vw.forEach((k) => el('rect', {
    x: k.x, y: LEGEND_H, width: wkW, height: wkH, rx: 3,
    fill: theme.whiteKey, 'fill-opacity': 0.06, stroke: theme.ink, 'stroke-width': 1.3,
    'data-role': 'key', 'data-index': k.i, 'data-note': k.note, 'data-drop': '1', 'data-hold': '1',
  }, parent));
  vb.forEach((k) => el('rect', {
    x: k.x, y: LEGEND_H, width: bkW, height: bkH, rx: 2.5,
    fill: acc, stroke: theme.ink, 'stroke-width': 1,
    'data-role': 'key', 'data-index': k.i, 'data-note': k.note,
    'data-accidental': '1', 'data-drop': '1', 'data-hold': '1',
  }, parent));

  let h = LEGEND_H + wkH;
  if (windowed) {
    // octave paging (shift the window by one octave = 7 white keys) + range map
    const y = h + 5;
    const canL = startWhite > 0, canR = startWhite + visibleWhites < whiteTotal;
    const navBtn = (x, dir, txt, on) => {
      const gr = g(parent, x, y);
      el('rect', { x: 0, y: 0, width: 46, height: 15, rx: 3, fill: 'none', stroke: on ? theme.accent : theme.mute, 'stroke-width': 1.2, 'data-role': 'octnav', 'data-dir': dir, 'data-enabled': on ? '1' : '0' }, gr);
      const t = label(gr, 23, 10.5, txt, on ? theme.accent : theme.mute, 7); t.setAttribute('letter-spacing', '.04em');
    };
    navBtn(0, '-1', '◀ 8VE', canL);
    navBtn(targetWidth - 46, '1', '8VE ▶', canR);
    // range map: full compass with the visible window highlighted
    const barX = 54, barW = targetWidth - 108, barY = y + 6;
    el('rect', { x: barX, y: barY, width: barW, height: 4, rx: 2, fill: 'none', stroke: theme.mute, 'stroke-width': 1 }, parent);
    el('rect', { x: barX + barW * (startWhite / whiteTotal), y: barY, width: barW * (visibleWhites / whiteTotal), height: 4, rx: 2, fill: theme.accent }, parent);
    const lo = label(parent, barX, barY - 3, NOTE_NAMES[first % 12] + octOf(first), theme.mute, 6); lo.setAttribute('text-anchor', 'start');
    const last = first + count - 1;
    const hi = label(parent, barX + barW, barY - 3, NOTE_NAMES[last % 12] + octOf(last), theme.mute, 6); hi.setAttribute('text-anchor', 'end');
    h = y + 16;
  }

  return { w: targetWidth, h, windowed, startWhite, visibleWhites, whiteTotal };
}

// ---- top-level assembly -----------------------------------------------------
export function renderSchematic(profile, { theme = DEFAULT_THEME, minKeyW, startWhite, maxWidth = 900 } = {}) {
  // --- build a detached scratch group for measuring, then place regions ---
  const svg = el('svg', { xmlns: SVG, 'font-family': theme.font });
  const root = g(svg, 0, 0);

  // frame + title band — height is settled once the badge is known (below), since
  // on a narrow board the status badge has to drop under the title instead of
  // colliding with it.
  let titleH = 26;

  // The width the drawing itself may occupy, in the same units it is drawn in.
  // `maxWidth` is the real on-screen width the board will get, so authoring
  // inside it means the SVG is displayed at ~1:1 instead of being scaled down —
  // an 8-unit caption stays an 8px caption instead of becoming a 4px smudge.
  const inner = Math.max(150, maxWidth - P * 2);

  // top deck: wheels | transport+knobs | pads  (left→right, like the box)
  const deck = g(root, 0, 0);
  const regions = [];   // { gr, w, h } — placed after measuring, so the deck can wrap

  if (profile.wheels && profile.wheels.length) {
    const gr = g(deck, 0, 0); const s = drawWheels(gr, profile.wheels, theme);
    regions.push({ gr, w: s.w, h: s.h });
  }
  if ((profile.transport && profile.transport.length) || profile.knobs || (profile.buttons && profile.buttons.length)) {
    const cluster = g(deck, 0, 0); let cy = 0, cw = 0, pad = 0;
    if (profile.transport && profile.transport.length) {
      const gr = g(cluster, 0, cy); const s = drawTransport(gr, profile.transport, theme);
      cy += s.h + 6; cw = Math.max(cw, s.w);
    }
    if (profile.buttons && profile.buttons.length) {
      const gr = g(cluster, 0, cy); const s = drawButtons(gr, profile.buttons, theme);
      cy += s.h + 8; cw = Math.max(cw, s.w);
    }
    if (profile.knobs) {
      const gr = g(cluster, 0, cy); const s = drawKnobs(gr, profile.knobs, theme);
      cy += s.h; cw = Math.max(cw, s.w);
      // the bank tag hangs off the right edge — count it, or the next region
      // in the row lands on top of it
      if (profile.knobBanks > 1) { const t = label(cluster, s.w + 2, cy - s.h / 2, 'B×' + profile.knobBanks, theme.accent, 8); t.setAttribute('text-anchor', 'start'); pad = 26; }
    }
    regions.push({ gr: cluster, w: cw + pad, h: cy });
  }
  if (profile.pads && profile.pads.count) {
    const gr = g(deck, 0, 0); const s = drawPads(gr, profile.pads, theme);
    if (profile.pads.banks > 1) { const t = label(gr, s.w, -6, 'PAD-B ×' + profile.pads.banks, theme.accent, 8); t.setAttribute('text-anchor', 'end'); }
    regions.push({ gr, w: s.w, h: s.h });
  }

  // Flow the deck like a line of text: regions sit side by side while they fit
  // the width the board actually has, and wrap onto a new row when they don't.
  // Reflowing keeps every control at full size; scaling the whole picture down
  // to fit a phone is what makes the captions unreadable.
  const widest = regions.reduce((a, r) => Math.max(a, r.w), 0);
  const avail = Math.max(widest, inner);
  let rx = 0, ry = 0, rowH = 0, deckW = 0;
  for (const r of regions) {
    if (rx > 0 && rx + r.w > avail + 0.5) { rx = 0; ry += rowH + GAP; rowH = 0; }
    r.gr.setAttribute('transform', `translate(${rx},${ry})`);
    rx += r.w + GAP; rowH = Math.max(rowH, r.h);
    deckW = Math.max(deckW, rx - GAP);
  }
  const deckH = regions.length ? ry + rowH : 0;

  // keyboard row below the deck — stretched to the board width, or auto-windowed
  // (with octave paging) when that would make keys too small to play.
  let kb = { w: 0, h: 0 };
  const kbY = (deckH ? deckH + GAP : 0);
  if (profile.keys && profile.keys.count) {
    let whiteTotal = 0; const f = profile.keys.firstNote ?? 48;
    for (let n = 0; n < profile.keys.count; n++) if (!BLACK_PCS.has((f + n) % 12)) whiteTotal++;
    const ideal = Math.max(deckW, whiteTotal * 34);          // full-size key ideal
    const targetWidth = Math.max(Math.min(deckW, inner), Math.min(ideal, inner)); // capped by screen
    const gr = g(root, 0, kbY); kb = drawKeyboard(gr, profile.keys, theme, targetWidth, { minKeyW, startWhite });
  }

  // Say plainly where the pad map stands. A half-learned grid is a guess in
  // progress, and silently drawing it as final is what makes a wrong pad look
  // like a bug rather than an unfinished pass.
  const pd = profile.pads;
  const titleText = (profile.portName || profile.id || 'CONTROLLER').toUpperCase();
  let badgeText = profile.learned ? '★ LEARNED' : '';
  if (pd && pd.taught) badgeText = '✓ PADS MAPPED';
  else if (pd && pd.provisional) badgeText = 'LEARNING PADS ' + (pd.seen || 0) + '/' + pd.count + ' — ⌗ MAP PADS to set';
  else if (pd && pd.learned) badgeText = '★ PADS LEARNED';

  // final sizing
  const contentW = Math.max(deckW, kb.w);
  const contentH = kbY + kb.h;
  const W = contentW + P * 2;
  // Oswald is condensed; ~.58em advance plus the tracking each label carries.
  const runW = (s, size, track) => s.length * size * (0.58 + track);
  const twoLine = badgeText && (runW(titleText, 12, 0.22) + runW(badgeText, 8, 0.12) + 24 > W - P * 2);
  if (twoLine) titleH = 40;
  const H = contentH + P * 2 + titleH;

  // position ALL content inside padding + under the title band by offsetting the
  // shared root group (deck stays at 0,0 and keyboard stays at 0,kbY within it).
  root.setAttribute('transform', `translate(${P},${P + titleH})`);

  // background + frame + title (prepended so they sit behind)
  const bg = el('rect', { x: 0, y: 0, width: W, height: H, fill: theme.bg }, null);
  const frame = el('rect', {
    x: 8, y: 8, width: W - 16, height: H - 16, rx: 10,
    fill: 'none', stroke: theme.ink, 'stroke-width': 1.5, 'stroke-opacity': 0.55,
  }, null);
  svg.insertBefore(frame, root);
  svg.insertBefore(bg, frame);
  const title = label(svg, W / 2, P + 6, titleText, theme.accent, 12);
  title.setAttribute('letter-spacing', '.22em');
  if (badgeText) {
    const badge = twoLine
      ? label(svg, W / 2, P + 20, badgeText, pd && pd.provisional ? theme.accent : theme.mute, 8)
      : label(svg, W - P - 6, P + 6, badgeText, pd && pd.provisional ? theme.accent : theme.mute, 8);
    if (!twoLine) badge.setAttribute('text-anchor', 'end');
  }

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('data-profile-id', profile.id || '');
  // expose keyboard window state so the host can drive octave paging (re-render
  // with a new startWhite) and know whether windowing is active.
  svg.__keyboard = kb.windowed
    ? { windowed: true, startWhite: kb.startWhite, visibleWhites: kb.visibleWhites, whiteTotal: kb.whiteTotal }
    : { windowed: false, whiteTotal: kb.whiteTotal || 0 };
  return svg;
}

// Android fit hint — call on EVERY new input. Returns the schematic's natural
// aspect and the orientation that fits it best, so the Capacitor shell can
// re-lock ScreenOrientation and rescale per controller (a 61-key board wants
// landscape; an 8-pad grid fits portrait). CSS (max-width:100%/height:auto)
// handles the scaling; this picks the rotation.
export function fitHint(svg) {
  const w = +svg.getAttribute('width') || svg.viewBox?.baseVal?.width || 1;
  const h = +svg.getAttribute('height') || svg.viewBox?.baseVal?.height || 1;
  const aspect = w / h;
  return {
    w, h, aspect,
    orientation: aspect >= 1.15 ? 'landscape' : 'portrait',
    // ScreenOrientation plugin lock value the Android shell should apply
    lock: aspect >= 1.15 ? 'landscape' : 'portrait',
  };
}

// ---- helpers ----------------------------------------------------------------
function squareish(n) { const c = Math.ceil(Math.sqrt(n)); return [Math.ceil(n / c), c]; }
// GM drum notes for the first 8 pads (kick, snare, hats…) — channel 10.
function gmDrumNote(i) { return [36, 38, 42, 46, 37, 39, 49, 51][i] ?? (36 + i); }
