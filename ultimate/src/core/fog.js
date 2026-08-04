// fog.js — volumetric-looking gas on a 2D canvas.
//
// The deep-field photographs everyone has in their head are not smooth
// gradients. They are FILAMENTS: gas that has been stirred, so bright threads
// wander through darker pockets and the colour changes along the thread rather
// than across the frame. A radial gradient cannot do that, which is why every
// "nebula background" built out of gradients reads as a lens flare.
//
// What does do it, cheaply, is DOMAIN WARPING: sample noise, then use that
// noise to displace where you sample the noise again. One extra lookup turns
// smooth blobs into exactly those stirred filaments. Two rounds is plenty.
//
// THE COST PROBLEM, AND THE THREE THINGS THAT FIX IT.
//   1. Render small. Gas has no edges, so a buffer about a sixth of the canvas
//      loses nothing once it is scaled back up with smoothing on — and it is
//      thirty-six times less work.
//   2. Render seldom. The cloud drifts over tens of seconds. Repainting it
//      every frame is spending sixty frames a second on something that changes
//      meaningfully about twelve times a second.
//   3. Never do colour maths per pixel. Converting a hue to RGB for every
//      pixel of every frame is the whole budget on its own. The palette is
//      baked into a small lookup table when the colours change, and the inner
//      loop does one array read.
//
// Dark by construction. The buffer is drawn ADDITIVELY over the void, so a
// density of zero contributes nothing at all and the black stays black. Fog
// that starts from white and darkens is how you get the washed-out grey that
// makes a space scene look like weather.

// A small deterministic generator, so the same seed is the same cloud every
// time. A scene that looked different on every visit would be decoration; one
// that is always itself is something you recognise.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 128;                     // noise lattice, power of two so wrap is a mask
const MASK = N - 1;

function makeLattice(seed) {
  const rnd = mulberry32(seed >>> 0);
  const d = new Float32Array(N * N);
  for (let i = 0; i < d.length; i++) d[i] = rnd();
  return d;
}

// Value noise with a smoothstep on the interpolant. Plain bilinear leaves
// visible creases along the lattice lines — the derivative is discontinuous at
// every integer, and on a smooth cloud that reads as a faint grid.
function value(d, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = xi & MASK, y0 = yi & MASK;
  const x1 = (xi + 1) & MASK, y1 = (yi + 1) & MASK;
  const a = d[y0 * N + x0], b = d[y0 * N + x1];
  const c = d[y1 * N + x0], e = d[y1 * N + x1];
  return (a + (b - a) * fx) + ((c + (e - c) * fx) - (a + (b - a) * fx)) * fy;
}

// Normalised to 0..1. The three octave weights sum to 0.875, so the raw sum
// peaks below one and sits around 0.44 — every threshold downstream would then
// be calibrated against a number with no obvious meaning, which is how a
// density map ends up tuned by trial and error instead of by intent.
const FBM_NORM = 1 / 0.875;
function fbm(d, x, y) {
  // Three octaves. A fourth is real work and, at a sixth resolution, lands
  // below one buffer pixel — detail nobody can see, paid for every frame.
  return (value(d, x, y) * 0.5 +
          value(d, x * 2.03, y * 2.03) * 0.25 +
          value(d, x * 4.07, y * 4.07) * 0.125) * FBM_NORM;
}

// HSL to RGB, used only when the palette is rebuilt — a few hundred times a
// minute at the very most, never per pixel.
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const LUT = 64;

export function createFog(seed) {
  const lattice = makeLattice(seed);
  let cv = null, cx = null, img = null, buf = null;
  let LW = 0, LH = 0;
  let lut = new Uint8Array(LUT * 3);
  let lutKey = '';
  let last = -1e9;

  // The palette runs ACROSS the cloud rather than over time, which is what
  // makes the colour follow the filaments instead of washing the whole frame
  // one shade at a time. Three stops, because two is a gradient and four is
  // mud once they are all smeared together.
  function palette(hues, drift) {
    const key = hues.join(',') + '|' + (drift | 0);
    if (key === lutKey) return;
    lutKey = key;
    const stops = [];
    for (let i = 0; i < 3; i++) {
      const h = (hues[i % hues.length] || 190) + drift;
      // Deep and saturated at the edges of the ramp, hot and pale in the
      // middle: gas is brightest where it is densest, and that is where the
      // colour washes out toward white in every real exposure.
      stops.push(hsl(h, 0.85, i === 1 ? 0.62 : 0.34));
    }
    for (let k = 0; k < LUT; k++) {
      const t = k / (LUT - 1) * 2;          // 0..2 across three stops
      const i = Math.min(1, Math.floor(t)), f = t - i;
      const a = stops[i], b = stops[i + 1];
      lut[k * 3] = a[0] + (b[0] - a[0]) * f;
      lut[k * 3 + 1] = a[1] + (b[1] - a[1]) * f;
      lut[k * 3 + 2] = a[2] + (b[2] - a[2]) * f;
    }
  }

  function fit(W, H) {
    // A sixth of the canvas, floored at something that still has structure in
    // it and capped so a 4K window does not quietly become a per-pixel job.
    const w = Math.max(48, Math.min(168, Math.round(W / 7)));
    const h = Math.max(32, Math.round(w * H / W));
    if (w === LW && h === LH && cv) return;
    LW = w; LH = h;
    cv = document.createElement('canvas');
    cv.width = LW; cv.height = LH;
    cx = cv.getContext('2d');
    img = cx.createImageData(LW, LH);
    buf = img.data;
    last = -1e9;                            // force a repaint at the new size
  }

  // Repaint the low-resolution buffer. `t` is seconds; `energy` lifts the whole
  // cloud when the music is loud, which is the one thing here that has to be
  // live rather than drifting.
  function paint(t, hues, energy) {
    palette(hues, Math.round(t * 2.2));
    // Coordinates in units of the canvas WIDTH, so the cloud is not stretched
    // on a tall window, and low enough that the biggest features span a third
    // of the frame. The first version ran at roughly fifty lattice cells across
    // the width; every feature then landed inside a single buffer pixel and the
    // result was speckle — technically noise, visually static. Gas is LOW
    // frequency with fine structure warped into it, not the other way round.
    const s = 1 / LW;
    const asp = LH / LW;
    const dx = t * 0.017, dy = t * 0.011;
    const lift = 0.06 + energy * 0.30;
    let p = 0;
    for (let y = 0; y < LH; y++) {
      const v = y * s;
      // Vignette. Without it the cloud stops dead at the edge of the canvas in
      // a straight line, and a straight edge is the one thing no photograph of
      // gas has ever had.
      const vy = (v / asp - 0.5) * 2;
      for (let x = 0; x < LW; x++) {
        const u = x * s;
        const vx = (u - 0.5) * 2;
        let edge = 1 - (vx * vx * 0.50 + vy * vy * 0.66);
        if (edge <= 0) { buf[p + 3] = 0; p += 4; continue; }
        if (edge > 1) edge = 1;
        edge *= edge;
        // Domain warp: two offset fields displace where the third is sampled.
        // That displacement is what stirs round blobs into wandering filaments,
        // and it is the whole difference between this and a blurred gradient.
        const q1 = fbm(lattice, (u + dx) * 3.0, (v + dy) * 3.0);
        const q2 = fbm(lattice, (u + 5.2) * 3.0, (v + 1.3 - dy) * 3.0);
        let r = fbm(lattice, (u * 5.2 + q1 * 3.0), (v * 5.2 + q2 * 3.0));
        // Centred on the mean and stretched, so most of the frame is thin gas
        // and the filaments are what survive. Thresholding well above the mean
        // instead just deletes the cloud, which is what the first pass at these
        // numbers did.
        r = (r - 0.37) * 2.30 + lift;
        if (r <= 0) { buf[p + 3] = 0; p += 4; continue; }
        if (r > 1) r = 1;
        // Colour runs across the cloud with the DIFFERENCE of the two warp
        // fields, so hue changes along a filament's length and neighbouring
        // filaments differ. Tinting by density instead gives every bright patch
        // the same colour, which is what makes fake nebulae read as smoke.
        let kk = (q1 - q2) * 1.9 + 0.5;
        if (kk < 0) kk = 0; else if (kk > 1) kk = 1;
        const k3 = (kk * (LUT - 1) | 0) * 3;
        // Gas thins much faster than it feels like it should. A linear ramp
        // gives an even haze with no depth in it; squaring it goes too far and
        // leaves only a few hot threads.
        const a = r * r * (0.45 + 0.55 * r) * edge * 1.15;
        const aa = a > 1 ? 1 : a;
        buf[p] = lut[k3] * aa;
        buf[p + 1] = lut[k3 + 1] * aa;
        buf[p + 2] = lut[k3 + 2] * aa;
        buf[p + 3] = 255 * aa;
        p += 4;
      }
    }
    cx.putImageData(img, 0, 0);
  }

  // THE UPSCALE WAS THE EXPENSIVE PART, NOT THE NOISE.
  // Blowing a 176-pixel-wide buffer up to a 2368-pixel canvas with smoothing on
  // is a resample of three million destination pixels. Done inside the render
  // loop it cost about 22ms of EVERY frame — measured as 38ms per frame in this
  // view against 16ms in the others, with no occasional spikes. A flat cost on
  // every frame, not a stall, which is what pointed at a fixed per-frame draw
  // rather than at the noise loop that only runs twelve times a second.
  //
  // So the resample happens on the same schedule as the noise, into a canvas
  // that is already the right size, and the render loop does a 1:1 blit — which
  // is the one thing a compositor is genuinely fast at.
  let full = null, fctx = null, fw = 0, fh = 0;
  function resample(W, H) {
    if (fw !== W || fh !== H || !full) {
      fw = W; fh = H;
      full = document.createElement('canvas');
      full.width = W; full.height = H;
      fctx = full.getContext('2d');
    }
    fctx.clearRect(0, 0, W, H);
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';
    fctx.drawImage(cv, 0, 0, W, H);
  }

  return {
    // Composite the cloud onto a destination context.
    draw(ctx, W, H, { t = 0, hues = [190], energy = 0, alpha = 1, now = 0 } = {}) {
      fit(W, H);
      if (now - last > 110 || fw !== W || fh !== H) {
        paint(t, hues, energy);
        resample(W, H);
        last = now;
      }
      ctx.save();
      // Additive over the void. Zero density adds nothing, so black stays
      // black instead of going grey.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha;
      ctx.drawImage(full, 0, 0);
      ctx.restore();
    },
    get size() { return [LW, LH]; },
  };
}

// A fixed field of stars for a given seed. Not animated per-frame: a starfield
// that twinkles on every frame is a screensaver, and this one has a job — it
// gives the gas something to sit in front of so the depth reads.
export function makeStars(seed, count) {
  const rnd = mulberry32((seed >>> 0) ^ 0x9E3779B9);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: rnd(), y: rnd(),
      r: 0.35 + rnd() * rnd() * 1.5,        // squared, so most are faint specks
      a: 0.18 + rnd() * 0.55,
      p: rnd() * 6.283,                     // phase, for a very slow breath
    });
  }
  return out;
}
