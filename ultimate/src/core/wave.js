// wave.js — the wavelength monitor.
//
// WHY A SCOPE AND NOT A SPECTRUM OR A VU METER.
// The keys are invisible by design: no on-screen keyboard, no knob moving on
// its own, no numbers changing. That is the right call, but it leaves the
// player with nothing that confirms the instrument heard them. A meter would
// only prove that sound is happening. A time-domain trace proves something much
// better — it shows the SHAPE of the sound, which is precisely what the wheels,
// the pressure and the bend are changing. You push the mod wheel and the wave
// starts to breathe. You lean on a key and it grows harmonics. You bend and the
// cycles stretch out under your finger. It is the modulation, drawn.
//
// THE PART THAT MAKES IT WORK: TRIGGERING.
// getByteTimeDomainData hands back an arbitrary window of the signal, and the
// waveform's phase inside that window shifts every frame. Drawn directly, a
// perfectly steady note looks like it is thrashing — the trace scrambles at
// 60fps and reads as noise. Every "waveform visualiser" that looks like a
// scribble has this bug.
//
// A real oscilloscope solves it with a trigger: find a rising edge through a
// threshold and start drawing from THERE. Then a steady note stands still, and
// the only thing that moves is the thing you are moving. That single step is
// the whole difference between decoration and an instrument you can read.
//
// The window is a FIXED slice of time, deliberately not normalised to the
// detected period. Normalising would hold each note's cycle at a constant width
// on screen, which sounds tidy and is exactly wrong here: it would cancel out
// pitch bend and vibrato, erasing the two gestures this display exists to show.

export function createScope(analyser) {
  let data = null, prevTrigger = 0, quiet = 0;

  // The canvas's size, OBSERVED rather than measured every frame.
  // getBoundingClientRect forces the browser to flush pending layout before it
  // can answer, so calling it inside the render loop turns a read into a
  // synchronous layout — sixty times a second, on a canvas that is inside a
  // fixed, transformed, draggable console. A ResizeObserver reports the same
  // number when it actually changes, which is almost never.
  let box = null, seen = null, ro = null, stale = 0;
  function sizeOf(cv) {
    if (seen !== cv) {
      seen = cv; box = null;
      if (ro) { ro.disconnect(); ro = null; }
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver((e) => {
          const r = e[e.length - 1].contentRect;
          if (r.width) box = { w: r.width, h: r.height };
        });
        ro.observe(cv);
      }
    }
    // No observer — an old WebView. Re-measure occasionally rather than never:
    // a cached size that can go stale forever means a rotated phone draws the
    // trace at the old width for the rest of the session.
    if (!box || (!ro && (stale = (stale + 1) % 30) === 0)) {
      const r = cv.getBoundingClientRect();
      if (r.width) box = { w: r.width, h: r.height };
    }
    return box;
  }

  // A rising crossing of the mid-line, with hysteresis so hiss cannot trigger.
  // Searching only the first half of the buffer leaves the second half to draw.
  function findTrigger(buf, half) {
    const H = 12;                              // hysteresis, in byte units
    let armed = false, best = -1;
    for (let i = 1; i < half; i++) {
      if (buf[i] < 128 - H) armed = true;
      else if (armed && buf[i] >= 128 && buf[i - 1] < 128) {
        // Of several candidate edges, prefer the one nearest last frame's. The
        // trace then stays put across frames instead of hopping a cycle at a
        // time, which reads as jitter even though every frame is "correct".
        if (best < 0 || Math.abs(i - prevTrigger) < Math.abs(best - prevTrigger)) best = i;
        armed = false;
        if (Math.abs(i - prevTrigger) < 24) break;
      }
    }
    return best;
  }

  // Returns the peak amplitude it drew, 0..1 — the caller uses it to decide
  // whether there is anything worth showing at all.
  return function draw(cv, opts) {
    if (!cv || !analyser) return 0;
    const o = opts || {};
    const r = sizeOf(cv);
    if (!r || !r.w) return 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, r.w * dpr | 0), h = Math.max(1, r.h * dpr | 0);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }

    if (!data || data.length !== analyser.fftSize) data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);

    const half = data.length >> 1;
    let peak = 0;
    for (let i = 0; i < data.length; i += 3) {
      const a = Math.abs(data[i] - 128); if (a > peak) peak = a;
    }
    peak /= 128;

    const g = cv.getContext('2d');
    g.clearRect(0, 0, w, h);

    const hue = o.hue == null ? 168 : o.hue;
    const mid = h / 2;
    // Below the floor there is no signal to stabilise, so draw the resting line
    // instead of triggering on noise and showing a fake waveform.
    if (peak < 0.006) {
      quiet++;
      g.strokeStyle = 'hsl(' + hue + ' 40% 60% / .18)';
      g.lineWidth = Math.max(1, dpr);
      g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
      return 0;
    }
    quiet = 0;

    let start = findTrigger(data, half);
    if (start < 0) start = 0;
    prevTrigger = start;

    // Amplitude is drawn with a gentle curve rather than linearly. A linear
    // trace spends most of its life as a flat line, because most of the time a
    // note is in its tail; the curve keeps a decaying note visible without
    // letting a loud one clip off the top of the strip.
    const amp = (h * 0.44) * (0.35 + Math.pow(Math.min(1, peak), 0.6) * 0.65) / Math.max(0.08, peak);
    const span = half;

    // ONE POINT PER TWO PIXELS, not one per sample. A 1024-sample half-buffer
    // drawn into a strip about 1100 device pixels wide was putting a path
    // vertex on nearly every pixel — and then stroking that path TWICE, with
    // round joins, every frame, at every altitude. Two thousand vertices per
    // frame for a picture two pixels tall in places.
    //
    // The step is derived from the actual width rather than fixed, so the trace
    // has the same visual density on a phone strip and a wide desktop one, and
    // never draws detail finer than the screen can show.
    const stride = Math.max(1, Math.round(span / Math.max(64, w / 2)));

    g.lineJoin = 'round'; g.lineCap = 'round';
    // A dim wide pass under a bright thin one. Two strokes give the trace the
    // glow of a phosphor tube for a fraction of the cost of a real blur.
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (let n = 0; n < span; n += stride) {
        const x = (n / span) * w;
        const y = mid - ((data[start + n] - 128) / 128) * amp;
        n ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.lineWidth = (pass ? 1.4 : 4.5) * dpr;
      g.strokeStyle = pass
        ? 'hsl(' + hue + ' 95% 76%)'
        : 'hsl(' + hue + ' 92% 58% / ' + (0.16 + Math.min(0.3, peak * 0.4)) + ')';
      g.stroke();
    }
    return Math.min(1, peak);
  };
}
