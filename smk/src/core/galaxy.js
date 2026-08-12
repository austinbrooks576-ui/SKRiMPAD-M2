// galaxy.js — a spiral galaxy behind the instrument.
//
// PAINTED ONCE. Not animated, not a requestAnimationFrame loop, not a shader.
// This app's one job is to put a note on the audio clock at the right
// millisecond, and the scheduler that does it runs on the main thread — so
// anything else drawing on that thread is competing with the music. ULTIMATE's
// moving nebula was measured blocking the main thread for 160ms at a stretch
// on a slow machine, and twenty-five of forty-six notes were handed to the
// audio clock after it had already gone past them. That is what "crackle"
// actually is.
//
// So the galaxy is rendered to an offscreen canvas when the window size
// changes and never touched again. It costs one frame every few minutes and
// exactly nothing while you play. A still image is also the honest choice
// artistically: a galaxy does not visibly move.
//
// HOW IT IS BUILT, which is why it reads as a galaxy rather than a smear:
//   · stars are placed along LOGARITHMIC SPIRALS, r = a·e^(b·θ), which is the
//     shape real arms take, with scatter perpendicular to the arm so the edges
//     are soft instead of drawn
//   · density falls off exponentially with radius, so the core is crowded and
//     the rim is sparse without either being drawn separately
//   · young blue stars sit IN the arms and old amber ones in the bulge, which
//     is the colour gradient that makes a spiral look like a spiral
//   · dust lanes are subtracted along the inner edge of each arm — the dark
//     side is as much of the shape as the light side
//   · a scattering of far-field stars behind everything, so the frame is not
//     empty black where the galaxy is not

const TAU = Math.PI * 2;

// A deterministic generator. The galaxy must be THE SAME galaxy every time the
// window is resized — a background that reshuffles itself when you rotate a
// phone reads as a glitch, not as decoration.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
// Two uniforms into something bell-shaped. Star scatter is not uniform — a
// uniform spread makes an arm look like a painted stripe with hard sides.
function gauss(r) {
  const u = Math.max(1e-9, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

export function paintGalaxy(canvas, opts = {}) {
  const w = Math.max(1, canvas.width), h = Math.max(1, canvas.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const R = rng(opts.seed || 0x5c81a7);
  const cx = w * (opts.cx == null ? 0.30 : opts.cx);
  const cy = h * (opts.cy == null ? 0.42 : opts.cy);
  // The galaxy is drawn larger than the frame on purpose: a spiral that fits
  // neatly inside the window looks like a logo. Running off the edges reads as
  // a window onto something bigger.
  const rad = Math.max(w, h) * 0.62;
  const tilt = opts.tilt == null ? -0.42 : opts.tilt;   // radians, the viewing angle
  const squash = opts.squash == null ? 0.46 : opts.squash;  // how edge-on it is

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#04060b';
  ctx.fillRect(0, 0, w, h);

  // Far field first, in the frame's own space rather than the galaxy's, so it
  // reads as distance rather than as part of the disc.
  for (let i = 0; i < Math.round((w * h) / 5200); i++) {
    const x = R() * w, y = R() * h;
    const a = 0.06 + R() * 0.42;
    const s = R() < 0.94 ? 0.6 : 1.3;
    ctx.fillStyle = 'rgba(200,214,240,' + a.toFixed(3) + ')';
    ctx.fillRect(x, y, s, s);
  }

  // Everything from here is in the galaxy's own frame: rotate and squash once,
  // and the spiral maths below can be written as if seen face-on.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.scale(1, squash);

  // The halo — a broad, very dim glow that stops the disc looking like it was
  // cut out and pasted on.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, rad * 1.15);
  halo.addColorStop(0, 'rgba(120,150,230,0.20)');
  halo.addColorStop(0.35, 'rgba(80,100,190,0.09)');
  halo.addColorStop(1, 'rgba(30,40,90,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(0, 0, rad * 1.15, 0, TAU); ctx.fill();

  // ---- the arms ------------------------------------------------------------
  const ARMS = opts.arms || 2;
  // HOW FAR ROUND AN ARM GOES, and how tightly it winds. These two are not
  // independent, and picking them independently is how the first version came
  // out as a fuzzy blob: with b=0.30 over 3.9 radians the arm reached
  // 0.055·e^1.17 = 18% of the radius it was supposed to fill, so every star
  // landed in a smudge around the core and there was no spiral to see.
  //
  // So only ONE of them is chosen — the arm sweeps TMAX radians, a little over
  // a turn, which is what a grand-design spiral actually does — and b is then
  // solved so the arm ends exactly at the rim.
  const TMAX = 6.9;                                     // radians ≈ 1.1 turns
  const START = 0.055;                                  // where an arm leaves the core
  const b = Math.log(1 / START) / TMAX;
  const perArm = Math.round((w * h) / 900);
  ctx.globalCompositeOperation = 'lighter';

  for (let arm = 0; arm < ARMS; arm++) {
    const phase = (arm / ARMS) * TAU;
    for (let i = 0; i < perArm; i++) {
      // Bias θ towards the outside so the arms are long, then let the
      // exponential radius put most of the STARS near the middle anyway.
      const t = Math.pow(R(), 0.62) * TMAX;
      const r0 = rad * START * Math.exp(b * t);
      if (r0 > rad) continue;
      const th = t + phase;

      // Scatter perpendicular to the arm, widening outward — arms fray at the
      // rim and are tight in the core.
      const spread = rad * (0.020 + 0.055 * (r0 / rad));
      const jr = gauss(R) * spread;
      const jt = gauss(R) * (spread / Math.max(rad * 0.08, r0)) * 0.9;

      const r = r0 + jr, a = th + jt;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (!isFinite(x) || !isFinite(y)) continue;

      // Colour by where the star is, not at random. Blue in the arms, warm in
      // the bulge, with the transition doing the work.
      const f = Math.min(1, r / rad);
      const near = 1 - f;
      const hot = R() < 0.10 - 0.07 * f;           // the occasional bright one
      const cr = Math.round(120 + 135 * near + (hot ? 0 : 0));
      const cg = Math.round(150 + 80 * near);
      const cb = Math.round(255 - 40 * near);
      const alpha = (0.16 + 0.62 * Math.pow(1 - f, 1.25)) * (hot ? 2.2 : 1);
      ctx.fillStyle = 'rgba(' + cr + ',' + cg + ',' + cb + ',' + Math.min(0.9, alpha).toFixed(3) + ')';
      const size = hot ? 1.5 : (R() < 0.2 ? 1.1 : 0.7);
      ctx.fillRect(x, y, size, size);
    }
  }

  // ---- the bulge -----------------------------------------------------------
  // Drawn AFTER the arms and additively, so it sits on top of them the way a
  // real core drowns out the inner arms.
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, rad * 0.30);
  core.addColorStop(0, 'rgba(255,242,214,0.75)');
  core.addColorStop(0.18, 'rgba(255,206,150,0.38)');
  core.addColorStop(0.55, 'rgba(210,140,110,0.12)');
  core.addColorStop(1, 'rgba(120,80,90,0)');
  ctx.fillStyle = core;
  ctx.beginPath(); ctx.arc(0, 0, rad * 0.30, 0, TAU); ctx.fill();

  // ---- dust ----------------------------------------------------------------
  // Subtracted, along the inner edge of each arm. Dust is why a spiral has
  // contrast at all; without it the arms are just brighter fog.
  ctx.globalCompositeOperation = 'destination-out';
  for (let arm = 0; arm < ARMS; arm++) {
    const phase = (arm / ARMS) * TAU + 0.30;   // trailing the light by a little
    for (let i = 0; i < perArm / 3; i++) {
      const t = Math.pow(R(), 0.6) * TMAX;
      const r0 = rad * START * Math.exp(b * t);
      if (r0 > rad * 0.95 || r0 < rad * 0.10) continue;
      const spread = rad * (0.012 + 0.030 * (r0 / rad));
      const r = r0 + gauss(R) * spread;
      const a = t + phase + gauss(R) * 0.05;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.05 + R() * 0.10).toFixed(3) + ')';
      ctx.fillRect(x, y, 2.2, 2.2);
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  // A vignette, so the instrument in front of it always has contrast to sit
  // against no matter where the arms happen to fall.
  const vig = ctx.createRadialGradient(w * 0.5, h * 0.5, Math.min(w, h) * 0.25,
                                       w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
  vig.addColorStop(0, 'rgba(4,6,11,0)');
  vig.addColorStop(1, 'rgba(2,3,7,0.52)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

// Size the canvas to its box and repaint — but only when the size actually
// changed. A resize observer fires for every pixel of a drag, and repainting a
// hundred thousand stars per pixel is exactly the kind of thing that makes an
// app feel broken while you use it.
export function mountGalaxy(canvas, opts = {}) {
  let lastW = 0, lastH = 0, pending = 0;
  const draw = () => {
    pending = 0;
    // Capped device pixel ratio. At 3x on a phone this is nine times the work
    // for a difference nobody can see on a starfield.
    const dpr = Math.min(2, (window.devicePixelRatio || 1));
    const w = Math.round((canvas.clientWidth || window.innerWidth) * dpr);
    const h = Math.round((canvas.clientHeight || window.innerHeight) * dpr);
    if (!w || !h || (w === lastW && h === lastH)) return;
    lastW = w; lastH = h;
    canvas.width = w; canvas.height = h;
    try { paintGalaxy(canvas, opts); } catch (e) { /* a background is never worth an exception */ }
  };
  const schedule = () => {
    if (pending) return;
    pending = requestAnimationFrame(draw);
  };
  draw();
  window.addEventListener('resize', schedule);
  if (window.ResizeObserver) { try { new ResizeObserver(schedule).observe(canvas); } catch (e) {} }
  return { repaint: () => { lastW = 0; draw(); } };
}
