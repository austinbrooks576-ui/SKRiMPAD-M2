// atlas.js — THE ALTITUDE ENGINE. This is the whole idea of ULTIMATE.
//
// Every DAW ever made solves "there is too much to show" the same way: cut the
// screen into panels, stack them in tabs, float them in windows. You end up
// managing furniture instead of making music, and on a phone it collapses
// entirely because there is no room for furniture.
//
// ULTIMATE has no panels, no tabs and no windows. There is ONE surface, and you
// move through it vertically. Pinch out, or scroll up, and you rise: the thing
// you were looking at shrinks into its context. Pinch in and you descend into
// whatever is under your finger. Five altitudes:
//
//   0 CONSTELLATION  the whole song as a field of light — every section at once
//   1 DECK           the performance surface: scenes, pads, transport
//   2 CELL           one pad or clip: its steps, its sample, its life
//   3 VOICE          the synth behind that cell: filter, envelope, shape
//   4 GRAIN          the waveform itself, sample-accurate
//
// This is SEMANTIC zoom, not a magnifying glass. The drawing does not get
// bigger — at each altitude it becomes a DIFFERENT REPRESENTATION of the same
// data. That is what makes one gesture enough to reach everything: you are
// never navigating an interface, you are only ever choosing how close to stand.
//
// Why this beats panels, concretely:
//   · Nothing to arrange, so nothing to arrange WRONG. No window ends up behind
//     another window on a phone.
//   · The same gesture works at every level, so there is exactly one thing to
//     learn. A person who has never opened a DAW can pinch.
//   · Depth is continuous, not discrete. You are allowed to sit BETWEEN two
//     altitudes, seeing both — which is where you actually work when you are
//     tweaking a filter while watching the whole song run.
//   · It costs nothing to add a sixth altitude later. Panels cost screen.
//
// The engine here owns three things and nothing else: where you are (depth),
// what you are above (the focus path), and how to get smoothly from A to B.
// Rendering is somebody else's job — altitudes register themselves.

export const ALTITUDES = ['CONSTELLATION', 'DECK', 'CELL', 'VOICE', 'GRAIN'];
export const TOP = 0, FLOOR = ALTITUDES.length - 1;

export function createAtlas({ onRender, onFocus } = {}) {
  // depth is a FLOAT. The integer part is which altitude you are on, the
  // fraction is how far you have fallen toward the next one. Keeping it
  // continuous is what makes the surface feel like a place rather than a menu.
  let depth = 1;                 // boot on DECK — hands on the instrument
  let target = 1;
  let path = [null, null, null, null, null];   // what is focused at each altitude
  let raf = 0, lastT = 0;
  const layers = new Map();      // altitude index -> { el, draw }

  // Springing to the target instead of jumping is not decoration. A cut between
  // two representations of the same data forces you to re-find yourself; a
  // continuous fall lets you keep your place because you watched it happen.
  const STIFF = 11;              // higher = snappier, lower = floatier

  function tick(t) {
    raf = 0;
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
    lastT = t;
    const d = target - depth;
    if (Math.abs(d) > 0.0004) {
      depth += d * Math.min(1, STIFF * dt);
      schedule();
    } else {
      depth = target;
    }
    paint();
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(tick); }

  // Each altitude is a layer that is scaled and faded by its DISTANCE from the
  // viewer. Above you, things blow up and dissolve outward; below you, they sit
  // small and dim, waiting. That single rule produces the whole sense of flight
  // and it is four lines of maths.
  function paint() {
    for (const [i, layer] of layers) {
      const dist = i - depth;                       // <0 above you, >0 below
      const near = Math.abs(dist);
      if (near > 1.35) {                            // far enough to be nothing
        if (layer.el.style.display !== 'none') layer.el.style.display = 'none';
        continue;
      }
      layer.el.style.display = '';
      // Above: rush past the camera (scale up, fade out).
      // Below: recede (scale down, fade out). Sitting exactly on it: 1:1.
      const scale = dist < 0 ? 1 + (-dist) * 0.85 : 1 - dist * 0.16;
      const op = Math.max(0, 1 - near * 1.05);
      layer.el.style.transform = 'scale(' + scale.toFixed(4) + ')';
      layer.el.style.opacity = op.toFixed(3);
      // Only the altitude you are actually ON should take input, or a fading
      // layer steals taps meant for the one underneath it.
      layer.el.style.pointerEvents = near < 0.5 ? 'auto' : 'none';
      if (layer.draw) layer.draw(1 - near, path[i], depth);
    }
    onRender && onRender(depth, path);
  }

  function register(i, el, draw) { layers.set(i, { el, draw }); schedule(); }

  function goTo(d, focus) {
    target = Math.max(TOP, Math.min(FLOOR, d));
    if (focus !== undefined) {
      const lvl = Math.round(target);
      if (path[lvl] !== focus) { path[lvl] = focus; onFocus && onFocus(lvl, focus); }
    }
    schedule();
  }
  // Descend INTO something. The thing you touched becomes the focus of the next
  // altitude down — which is why you never have to "select then open": touching
  // IS selecting IS opening.
  function dive(focus) { goTo(Math.round(target) + 1, focus); }
  function rise() { goTo(Math.round(target) - 1); }
  // Free-fall from a gesture: continuous, so a slow pinch parks you between two
  // altitudes on purpose.
  function nudge(delta) { target = Math.max(TOP, Math.min(FLOOR, target + delta)); schedule(); }
  function settle() { goTo(Math.round(target)); }

  return {
    register, goTo, dive, rise, nudge, settle, paint,
    get depth() { return depth; },
    get level() { return Math.round(depth); },
    get name() { return ALTITUDES[Math.round(depth)]; },
    get path() { return path.slice(); },
    focusAt(i) { return path[i]; },
    setFocus(i, v) { path[i] = v; onFocus && onFocus(i, v); schedule(); },
  };
}

// ---- GESTURES ---------------------------------------------------------------
// One input model for every altitude, on every device. Wheel/trackpad pinch,
// two-finger touch pinch, and keyboard all drive the SAME continuous depth, so
// muscle memory transfers between a phone and a laptop without relearning.
export function bindGestures(el, atlas, { onTapEmpty } = {}) {
  let pinch0 = 0, depth0 = 0, pinching = false;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  el.addEventListener('wheel', (e) => {
    // ctrl+wheel is the trackpad pinch on every desktop OS; plain wheel scrolls
    // depth too, because a mouse has no pinch and must not be a second-class
    // citizen.
    e.preventDefault();
    const k = e.ctrlKey ? 0.010 : 0.0035;
    atlas.nudge(e.deltaY * k);
    clearTimeout(el.__settle);
    el.__settle = setTimeout(() => atlas.settle(), 220);
  }, { passive: false });

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) { pinching = true; pinch0 = dist(e.touches); depth0 = atlas.depth; }
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!pinching || e.touches.length !== 2) return;
    e.preventDefault();
    const r = dist(e.touches) / (pinch0 || 1);
    // Spreading fingers = going DOWN into detail, matching every map and photo
    // app on earth. Log keeps the feel even across the whole range.
    atlas.goTo(depth0 + Math.log2(r) * 1.6);
  }, { passive: false });
  el.addEventListener('touchend', () => { if (pinching) { pinching = false; atlas.settle(); } }, { passive: true });

  window.addEventListener('keydown', (e) => {
    if (/input|textarea/i.test((e.target.tagName || ''))) return;
    if (e.key === 'ArrowUp' || e.key === 'Escape') { atlas.rise(); e.preventDefault(); }
    else if (e.key === 'ArrowDown' || e.key === 'Enter') { atlas.dive(); e.preventDefault(); }
    else if (e.key >= '1' && e.key <= '5') { atlas.goTo(+e.key - 1); e.preventDefault(); }
  });

  if (onTapEmpty) {
    el.addEventListener('pointerdown', (e) => { if (e.target === el) onTapEmpty(e); });
  }
}
