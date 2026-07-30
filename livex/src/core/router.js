// router.js — the input router. Maps normalized MIDI/gamepad events onto the live
// schematic: lights keys/pads, tracks A/B banks + octave/transpose, auto-follows the
// keyboard window when a note lands off-screen, and makes the on-screen board
// tap-playable (touch). Emits higher-level actions for the (future) sound/loop layer.
//
//   const r = createRouter({ container, profile, litColor, onAction, onWindow });
//   r.wire();                       // enable tap-to-play on the schematic
//   midiIO = createMidiIO({ onEvent: r.handleMidi });
//   gp = createGamepad({ onButton: r.handleGamepadButton });
//
// `container` is the element the schematic lives in (queried live, so re-renders —
// e.g. from window auto-follow — are picked up automatically).

export function createRouter({ container, profile, litColor = '#4bd6c8', onAction, onWindow } = {}) {
  const state = { knobBank: 0, padBank: 0, octave: 0, transpose: 0 };

  const q = (sel) => container.querySelector(sel);
  const keyEl = (note) => q(`[data-role="key"][data-note="${note}"]`);
  const padEl = (note) => q(`[data-role="pad"][data-note="${note}"]`);

  // ---- lighting (SVG rects) ----
  function lightOn(el) {
    if (!el || el.__lit) return;
    el.__origFill = el.getAttribute('fill');
    el.__origOp = el.getAttribute('fill-opacity');
    el.setAttribute('fill', litColor);
    el.setAttribute('fill-opacity', '0.9');
    el.__lit = true;
  }
  function lightOff(el) {
    if (!el || !el.__lit) return;
    if (el.__origFill != null) el.setAttribute('fill', el.__origFill); else el.removeAttribute('fill');
    if (el.__origOp != null) el.setAttribute('fill-opacity', el.__origOp); else el.removeAttribute('fill-opacity');
    el.__lit = false;
  }
  function flash(el, ms = 130) { if (!el) return; lightOn(el); setTimeout(() => lightOff(el), ms); }

  // ---- MIDI in ----
  function handleMidi(ev) {
    const { cmd, chan, d1, d2 } = ev;
    const noteOn = cmd === 0x90 && d2 > 0;
    const noteOff = cmd === 0x80 || (cmd === 0x90 && d2 === 0);

    if (noteOn) {
      if (chan === 9) { // drum pads
        flash(padEl(d1));
        onAction && onAction({ type: 'pad', note: d1, vel: d2, bank: state.padBank });
        return;
      }
      let el = keyEl(d1);
      if (!el && onWindow) { onWindow(d1); el = keyEl(d1); } // auto-follow: bring the note on-screen
      lightOn(el);
      onAction && onAction({ type: 'noteon', note: d1, vel: d2 });
      return;
    }
    if (noteOff) {
      lightOff(chan === 9 ? padEl(d1) : keyEl(d1));
      onAction && onAction({ type: 'noteoff', note: d1 });
      return;
    }
    if (cmd === 0xb0) { onAction && onAction({ type: 'cc', cc: d1, val: d2, bank: state.knobBank }); return; }
    if (cmd === 0xe0) { onAction && onAction({ type: 'pitch', val: (d2 << 7) | d1 }); return; }
    if (cmd === 0xd0) { onAction && onAction({ type: 'aftertouch', val: d1 }); return; }
  }

  // ---- gamepad in ----
  function handleGamepadButton(i) {
    const pads = container.querySelectorAll('[data-role="pad"]');
    if (pads.length) flash(pads[i % pads.length]);
    onAction && onAction({ type: 'gpbutton', index: i });
  }

  // ---- A/B banks (KNOB-B / PAD-B) ----
  function setBank(which /* 'knob' | 'pad' */) {
    const k = which + 'Bank';
    state[k] ^= 1;
    const btn = q(`[data-role="button"][data-name="${which}B"]`);
    if (btn) btn.setAttribute('stroke-width', state[k] ? '2.6' : '1.4'); // active shelf glows
    onAction && onAction({ type: 'bank', which, value: state[k] });
    return state[k];
  }

  // ---- tap-to-play + on-screen controls (touch board) ----
  function wire() {
    container.addEventListener('pointerdown', (e) => {
      const t = e.target.closest && e.target.closest('[data-role]');
      if (!t) return;
      const role = t.getAttribute('data-role');
      if (role === 'key' || role === 'pad') {
        flash(t);
        onAction && onAction({ type: role === 'pad' ? 'pad' : 'noteon', note: +t.getAttribute('data-note'), vel: 100, source: 'tap' });
      } else if (role === 'button' && t.getAttribute('data-bank-toggle') === '1') {
        setBank(t.getAttribute('data-name') === 'knobB' ? 'knob' : 'pad');
      } else if (role === 'transport') {
        onAction && onAction({ type: 'transport', name: t.getAttribute('data-name') });
      } else if (role === 'octnav' && t.getAttribute('data-enabled') === '1') {
        onAction && onAction({ type: 'octnav', dir: +t.getAttribute('data-dir') });
      }
    });
  }

  return { handleMidi, handleGamepadButton, setBank, wire, flash, lightOn, lightOff, state };
}
