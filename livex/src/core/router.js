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

// CC numbers controllers commonly put PLAY / STOP / REC on. 116-118 is the
// widely used trio; 114/115 show up on some M-Vave / Worlde firmware.
const TRANSPORT_CC = { 116: 'play', 117: 'stop', 118: 'rec', 114: 'play', 115: 'stop' };

export function createRouter({ container, profile, litColor = '#4bd6c8', onAction, onWindow } = {}) {
  const learnedCC = {};   // cc -> 'play'|'stop'|'rec', taught by MIDI-learn
  const state = { knobBank: 0, padBank: 0, octave: 0, transpose: 0 };

  const q = (sel) => container.querySelector(sel);
  const keyEl = (note) => q(`[data-role="key"][data-note="${note}"]`);

  // A pad-only controller has no keybed, so every note it sends is a pad — the
  // JamJum JP-1 / JP mini and other 4x4 grids ship freely reassignable, often on
  // channel 1 rather than 10, so a channel-10-only rule leaves their pads dead.
  const padOnly = () => !!(profile && profile.pads && !(profile.keys && profile.keys.count));
  // Resolve a note to its drawn pad. Prefers the LEARNED map (identify.js builds
  // note -> pad index from what the hardware actually played, across all banks),
  // so a pad keeps working after a bank switch changes the note it sends.
  const padIndexOf = (note) => {
    const m = profile && profile.pads && profile.pads.noteMap;
    return m && m[note] != null ? m[note] : null;
  };
  const padEl = (note) => {
    const i = padIndexOf(note);
    if (i != null) {
      const byIndex = q(`[data-role="pad"][data-index="${i}"]`);
      if (byIndex) return byIndex;
    }
    return q(`[data-role="pad"][data-note="${note}"]`);
  };

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

    // Transport reported out-of-band (MMC SysEx / MIDI Start-Stop-Continue).
    // Flash the matching drawn button so you can see the board respond.
    if (ev.transport) {
      const el = q('[data-role="transport"][data-name="' + ev.transport + '"]');
      if (el) flash(el, 180);
      onAction && onAction({ type: 'transport', name: ev.transport, source: 'midi' });
      return;
    }
    const noteOn = cmd === 0x90 && d2 > 0;
    const noteOff = cmd === 0x80 || (cmd === 0x90 && d2 === 0);

    if (noteOn) {
      // Pad when: the drum channel, a pad-only board, or a note the grid has
      // already been learned to own (a hybrid whose pads sit off channel 10).
      const pi = padIndexOf(d1);
      if (chan === 9 || padOnly() || pi != null) {
        const el = padEl(d1);
        flash(el);
        onAction && onAction({
          type: 'pad', note: d1, vel: d2, bank: state.padBank,
          index: pi != null ? pi : (el ? +el.getAttribute('data-index') : null),
        });
        return;
      }
      let el = keyEl(d1);
      if (!el && onWindow) { onWindow(d1); el = keyEl(d1); } // auto-follow: bring the note on-screen
      lightOn(el);
      onAction && onAction({ type: 'noteon', note: d1, vel: d2 });
      return;
    }
    if (noteOff) {
      lightOff(chan === 9 || padOnly() || padIndexOf(d1) != null ? padEl(d1) : keyEl(d1));
      onAction && onAction({ type: 'noteoff', note: d1 });
      return;
    }
    if (cmd === 0xb0) {
      // Channel-mode messages every controller and DAW sends. Ignoring these is a
      // classic source of hung notes — 123 is literally "All Notes Off".
      if (d1 === 120 || d1 === 123) {       // All Sound Off / All Notes Off
        unlightAll();
        onAction && onAction({ type: 'allnotesoff' });
        return;
      }
      // CC transport — the other common way PLAY/STOP/REC report. Standard-ish
      // assignments plus anything the user has learned onto a transport button.
      const tname = TRANSPORT_CC[d1] || learnedCC[d1];
      if (tname && d2 > 0) {
        const el = q('[data-role="transport"][data-name="' + tname + '"]');
        if (el) flash(el, 180);
        onAction && onAction({ type: 'transport', name: tname, source: 'cc' });
        return;
      }
      onAction && onAction({ type: 'cc', cc: d1, val: d2, bank: state.knobBank });
      return;
    }
    if (cmd === 0xe0) { onAction && onAction({ type: 'pitch', val: (d2 << 7) | d1 }); return; }
    // Channel pressure — one value for the whole board.
    if (cmd === 0xd0) { onAction && onAction({ type: 'aftertouch', val: d1 }); return; }
    // Polyphonic key pressure — the JP-1's pads send this PER PAD while held, so
    // it carries a pad index and can modulate that pad's voice on its own.
    if (cmd === 0xa0) {
      const pi = padIndexOf(d1);
      onAction && onAction({ type: 'aftertouch', note: d1, val: d2, poly: true, index: pi });
      return;
    }
    // Program Change — the JP mini's documented way of stepping banks/kits.
    if (cmd === 0xc0) {
      const banks = (profile && profile.pads && profile.pads.banks) || 1;
      if (banks > 1) setBank('pad', d1 % banks);
      onAction && onAction({ type: 'program', value: d1 });
      return;
    }
  }

  // ---- gamepad in ----
  function handleGamepadButton(i) {
    const pads = container.querySelectorAll('[data-role="pad"]');
    if (pads.length) flash(pads[i % pads.length]);
    onAction && onAction({ type: 'gpbutton', index: i });
  }

  // ---- banks (KNOB-B / PAD-B) ----
  // Not a plain A/B toggle: the SMK-25 has 2 pad banks, the JamJum JP-1 has 3
  // pad banks (16x3 = the 48 pads it advertises) AND 3 knob banks (8x3 = 24),
  // so the stepper cycles however many the profile declares.
  function bankCount(which) {
    if (which === 'pad') return (profile && profile.pads && profile.pads.banks) || 2;
    return (profile && profile.knobBanks) || 2;
  }
  function setBank(which /* 'knob' | 'pad' */, to) {
    const k = which + 'Bank';
    const n = Math.max(1, bankCount(which));
    state[k] = to != null ? ((to % n) + n) % n : (state[k] + 1) % n;
    const btn = q(`[data-role="button"][data-name="${which}B"]`);
    if (btn) {
      btn.setAttribute('stroke-width', state[k] ? '2.6' : '1.4'); // active shelf glows
      // name the live bank on the button so 3-way cycling is readable at a glance
      const lbl = btn.parentNode && btn.parentNode.querySelector('text');
      if (lbl && n > 2) lbl.textContent = (which === 'pad' ? 'PAD ' : 'KNOB ') + 'ABCDEFGH'[state[k]];
    }
    onAction && onAction({ type: 'bank', which, value: state[k], of: n });
    return state[k];
  }

  // ---- tap-to-play + on-screen controls (touch board) ----
  // A tapped key is a HELD note, exactly like a MIDI key: press sounds it, release
  // stops it. Tracked per pointerId so multi-touch chords work and so a finger that
  // slides off the board, or a pointer the OS cancels, still releases its note —
  // pressing without ever releasing is what left notes ringing forever.
  const tapNotes = new Map(); // pointerId -> note
  let drag = null, dragId = null; // active knob/wheel drag
  function releaseTap(id) {
    if (!tapNotes.has(id)) return;
    const note = tapNotes.get(id);
    tapNotes.delete(id);
    lightOff(keyEl(note));
    onAction && onAction({ type: 'noteoff', note, source: 'tap' });
  }
  function releaseAllTaps() { for (const id of [...tapNotes.keys()]) releaseTap(id); }

  function wire() {
    container.addEventListener('pointerdown', (e) => {
      const t = e.target.closest && e.target.closest('[data-role]');
      if (!t) return;
      const role = t.getAttribute('data-role');
      if (role === 'key') {
        const note = +t.getAttribute('data-note');
        releaseTap(e.pointerId);            // re-press without a release (shouldn't happen, but never leak)
        tapNotes.set(e.pointerId, note);
        lightOn(t);
        try { t.setPointerCapture && t.setPointerCapture(e.pointerId); } catch (err) {}
        onAction && onAction({ type: 'noteon', note, vel: 100, source: 'tap' });
      } else if (role === 'pad') {
        flash(t);                            // pads are one-shots — no release needed
        onAction && onAction({
          type: 'pad', note: +t.getAttribute('data-note'), index: +t.getAttribute('data-index'),
          vel: 100, bank: state.padBank, source: 'tap',
        });
      } else if (role === 'knob' || role === 'wheel') {
        // vertical drag: grab the pointer so it keeps tracking off the control
        const isKnob = role === 'knob';
        const key = isKnob ? +t.getAttribute('data-index') : t.getAttribute('data-name');
        const start = (isKnob ? knobVals : wheelVals).get(key);
        drag = { el: t, isKnob, y: e.clientY, v: start != null ? start : (key === 'pitch' ? 0.5 : 0.5) };
        try { t.setPointerCapture && t.setPointerCapture(e.pointerId); } catch (err) {}
        dragId = e.pointerId;
        e.preventDefault();
      } else if (role === 'button') {
        if (t.getAttribute('data-bank-toggle') === '1') {
          setBank(t.getAttribute('data-name') === 'knobB' ? 'knob' : 'pad');
        } else {
          // every other printed button (ARP / SC-CH / BT / OCT± ) is live too
          const name = t.getAttribute('data-name');
          t.setAttribute('stroke-width', '2.6');
          setTimeout(() => t.setAttribute('stroke-width', '1.4'), 160);
          if (name === 'oct-' || name === 'oct+') onAction && onAction({ type: 'octnav', dir: name === 'oct+' ? 1 : -1, source: 'button' });
          else onAction && onAction({ type: 'button', name });
        }
      } else if (role === 'transport') {
        onAction && onAction({ type: 'transport', name: t.getAttribute('data-name') });
      } else if (role === 'octnav' && t.getAttribute('data-enabled') === '1') {
        onAction && onAction({ type: 'octnav', dir: +t.getAttribute('data-dir') });
      }
    });

    // knob / wheel drag tracking
    const move = (e) => {
      if (!drag || e.pointerId !== dragId) return;
      const dv = (drag.y - e.clientY) / 140;          // ~140px = full sweep
      const v = Math.max(0, Math.min(1, drag.v + dv));
      if (drag.isKnob) setKnob(drag.el, v); else setWheel(drag.el, v);
      e.preventDefault();
    };
    const dragEnd = (e) => {
      if (!drag || e.pointerId !== dragId) return;
      // the pitch strip springs back to centre, exactly like the hardware
      if (!drag.isKnob && drag.el.getAttribute('data-name') === 'pitch') setWheel(drag.el, 0.5);
      drag = null; dragId = null;
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', dragEnd);
      window.addEventListener('pointercancel', dragEnd);
    }
    // Release on every way a press can end — including pointers that end outside
    // the board, which is why these listen on the window, not the container.
    const end = (e) => releaseTap(e.pointerId);
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('blur', releaseAllTaps);
    }
  }

  // Kill every lit element on this board — used by panic / all-notes-off so the
  // schematic can never be left glowing after the sound has stopped.
  function unlightAll() {
    container.querySelectorAll('[data-role="key"],[data-role="pad"]').forEach(lightOff);
    tapNotes.clear();
  }

  // ---- KNOBS + WHEELS: drag with the mouse ---------------------------------
  // Every control on the drawing is live, not decoration. Knobs and wheels are
  // vertical drags (up = increase), the pitch wheel springs back to centre on
  // release like the real strip, and each one emits the same event its hardware
  // counterpart would, so nothing downstream needs to care where it came from.
  const knobVals = new Map();   // index -> 0..1
  const wheelVals = new Map();  // name  -> 0..1

  function paintKnob(el, v) {
    const line = el.parentNode && el.parentNode.querySelector('line');
    if (!line) return;
    const cx = +el.getAttribute('cx'), cy = +el.getAttribute('cy'), r = +el.getAttribute('r');
    const a = (-135 + v * 270) * Math.PI / 180;
    line.setAttribute('x2', cx + Math.sin(a) * r * 0.7);
    line.setAttribute('y2', cy - Math.cos(a) * r * 0.7);
  }
  function paintWheel(el, v) {
    const line = el.parentNode && el.parentNode.querySelector('line');
    if (!line) return;
    const y = +el.getAttribute('y'), h = +el.getAttribute('height');
    const py = y + h - v * h;
    line.setAttribute('y1', py); line.setAttribute('y2', py);
  }
  // knob index -> CC: knob 1 is volume (CC7), knob 2 tone (CC1), rest are free
  const knobCC = (i) => (i === 0 ? 7 : i === 1 ? 1 : 20 + i);

  function setKnob(el, v) {
    const i = +el.getAttribute('data-index');
    v = Math.max(0, Math.min(1, v));
    knobVals.set(i, v); paintKnob(el, v);
    onAction && onAction({ type: 'cc', cc: knobCC(i), val: Math.round(v * 127), bank: state.knobBank, source: 'knob', index: i });
  }
  function setWheel(el, v) {
    const name = el.getAttribute('data-name');
    v = Math.max(0, Math.min(1, v));
    wheelVals.set(name, v); paintWheel(el, v);
    if (name === 'pitch') onAction && onAction({ type: 'pitch', val: Math.round(v * 16383), source: 'wheel' });
    else onAction && onAction({ type: 'cc', cc: 1, val: Math.round(v * 127), source: 'wheel' });
  }

  // ---- COMPUTER KEYBOARD ---------------------------------------------------
  // Play the board with no hardware attached at all. Two chromatic octaves on the
  // letter rows (the layout trackers and DAWs have used for decades), pads on the
  // number row, and transport where your thumb already is.
  const KEY_SEMITONE = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
    KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    KeyQ: 12, KeyW: 14, KeyE: 16, KeyR: 17, KeyT: 19, KeyY: 21, KeyU: 23,
    KeyI: 24, KeyO: 26, KeyP: 28,
  };
  // On a board WITH keys the letter rows are notes, so pads live on the number
  // row. On a pad-only board (JamJum JP-1 / JP mini and every other 4x4 grid)
  // there are no notes to protect, so the whole 4x4 QWERTY block becomes the
  // grid — same shape as the hardware, top row to bottom row.
  const PAD_KEYS_ROW = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];
  const PAD_KEYS_GRID = [
    'Digit1', 'Digit2', 'Digit3', 'Digit4',
    'KeyQ', 'KeyW', 'KeyE', 'KeyR',
    'KeyA', 'KeyS', 'KeyD', 'KeyF',
    'KeyZ', 'KeyX', 'KeyC', 'KeyV',
  ];
  const padKeys = () => (padOnly() ? PAD_KEYS_GRID : PAD_KEYS_ROW);
  const kbHeld = new Map(); // code -> note
  let kbOctave = 0;

  function kbBaseNote() {
    const first = (profile && profile.keys && profile.keys.firstNote);
    const el = container.querySelector('[data-role="key"]');
    const base = first != null ? first : (el ? +el.getAttribute('data-note') : 60);
    return base + kbOctave * 12;
  }

  // Returns true when the key was consumed, so the host can preventDefault.
  function handleComputerKey(code, down) {
    if (code === 'Minus' || code === 'BracketLeft') { if (down) { kbOctave--; onAction && onAction({ type: 'kboctave', octave: kbOctave }); } return true; }
    if (code === 'Equal' || code === 'BracketRight') { if (down) { kbOctave++; onAction && onAction({ type: 'kboctave', octave: kbOctave }); } return true; }

    const padIdx = padKeys().indexOf(code);
    if (padIdx >= 0) {
      const pads = container.querySelectorAll('[data-role="pad"]');
      if (!pads.length) return false;
      if (down && !kbHeld.has(code)) {
        kbHeld.set(code, -1);
        const el = pads[padIdx % pads.length];
        flash(el);
        onAction && onAction({ type: 'pad', note: +el.getAttribute('data-note'), index: +el.getAttribute('data-index'), vel: 110, bank: state.padBank, source: 'kb' });
      } else if (!down) kbHeld.delete(code);
      return true;
    }

    const semi = KEY_SEMITONE[code];
    if (semi === undefined) return false;
    if (!container.querySelector('[data-role="key"]')) return false;   // pad-only board
    if (down) {
      if (kbHeld.has(code)) return true;                                // ignore auto-repeat
      const note = kbBaseNote() + semi;
      kbHeld.set(code, note);
      let el = keyEl(note);
      if (!el && onWindow) { onWindow(note); el = keyEl(note); }         // scroll it into view
      lightOn(el);
      onAction && onAction({ type: 'noteon', note, vel: 100, source: 'kb' });
    } else {
      if (!kbHeld.has(code)) return true;
      const note = kbHeld.get(code);
      kbHeld.delete(code);
      lightOff(keyEl(note));
      onAction && onAction({ type: 'noteoff', note, source: 'kb' });
    }
    return true;
  }
  function releaseAllKeyboard() {
    for (const [code, note] of [...kbHeld]) {
      kbHeld.delete(code);
      if (note >= 0) { lightOff(keyEl(note)); onAction && onAction({ type: 'noteoff', note, source: 'kb' }); }
    }
  }

  return {
    handleMidi, handleGamepadButton, setBank, wire, flash, lightOn, lightOff,
    unlightAll, releaseAllTaps, handleComputerKey, releaseAllKeyboard,
    setKnob, setWheel, state,
  };
}
