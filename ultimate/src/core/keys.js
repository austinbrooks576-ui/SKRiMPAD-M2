// keys.js — the invisible instrument.
//
// THE IDEA, STATED PLAINLY.
// The controller is the instrument. It already has the keys, the wheels, the
// pressure sensor and the pedal, and the person holding it already knows how
// those feel. The app's entire job is to GIVE THAT MIDI A VOICE — to be the
// sound at the end of the wire, and then get out of the way.
//
// So there is no on-screen keyboard, no MIDI-learn dialog, no routing matrix,
// no "assign CC" mode, no settings page. There is nothing to look at, because
// there is nothing to configure. You plug a thing in and you play it.
//
// Everything below is in service of that one sentence.
//
// WHAT THE HARDWARE DRIVES, AND WHY EACH ONE
//   note + velocity    pitch and effort — velocity opens the filter as well as
//                      the level, because effort reads as brightness to the ear
//   pitch bend         detune, in real semitones, at whatever range the
//                      controller says it uses (see RPN below)
//   mod wheel   CC1    vibrato depth, one shared LFO so a chord bends as a hand
//   channel AT  0xD0   pressure on every held note
//   poly AT     0xA0   pressure on ONE note — the expressive thing almost no
//                      software honours, and it costs nothing to honour
//   sustain     CC64   real pedal behaviour, including catching notes released
//                      while the pedal is already down
//   expression  CC11   level, the pedal a wind or string player reaches for
//   breath      CC2    level
//   volume      CC7    level, per channel
//   timbre      CC74   brightness — the MPE slide axis, and the standard
//                      "brightness" controller on everything else
//   all notes off CC123 / reset CC121   panic, honoured properly
//
// WHY THERE IS NO CONFIGURATION FOR ANY OF THAT.
// Those assignments are not our preferences — they are what the MIDI spec says
// those controllers mean, which is why every keyboard ever built already sends
// them and every player already expects them. A mapping UI would be asking the
// user to re-type a standard.
//
// THE ONE THING THAT GENUINELY NEEDS DECIDING, AND HOW IT IS DECIDED WITHOUT
// ASKING. A pad bank and a keyboard both send note-on, and they want opposite
// things: a pad should FIRE A CELL, a key should SOUND A PITCH. Guess wrong and
// the instrument is useless. So the port is identified rather than configured:
// its name gives an instant guess, and the way it actually behaves confirms or
// corrects that guess within the first few notes. The verdict is remembered per
// port, so a controller is only ever read wrong once, and never in a way the
// player has to go and fix.

const PORT_ROLES = 'skrimpad_ultimate_ports';

// Names are a strong first signal and cost nothing. They are only a guess —
// behaviour below gets the final say.
const KEYISH = /key|piano|synth|s49|s61|s88|mpk|launchkey|keystation|keylab|minilab|oxygen|axiom|nektar|impact|smk|micro ?key|nano ?key|k-?board|seaboard|linnstr|osmose|xkey|reface|casio|prophet|moog|hydra|deepmind|jd-?xi|jp-?\d|montage|modx|fantom|jupiter|juno/i;
// \bmpd\d*\b, not \bmpd\b: the products are called MPD218 / MPD226 / MPD232, and
// a plain word boundary after "mpd" never matches any of them.
const PADISH = /\bmpd\d*\b|\bmpc\b|maschine|launchpad|pad ?kontrol|beatstep|beat ?pad|\bspd\b|dd-?\d{2}|linn ?drum|\batom\b|blocks|trigger ?finger|\bpads?\b|drum ?pad/i;

// The General MIDI pad bank. A controller that only ever speaks inside this
// window is a pad bank; the first note outside it is a keyboard giving itself
// away. The window is widened past 51 because banked pad controllers walk up
// the scale a bank at a time and must not be mistaken for a keyboard.
const PAD_LO = 36, PAD_HI = 63;

function readRoles() {
  try {
    const raw = JSON.parse(localStorage.getItem(PORT_ROLES) || 'null');
    // JSON.parse('null') succeeds and returns null, so a truthiness check is not
    // enough — the shape has to be verified or a corrupt entry takes the app out.
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch (e) { return {}; }
}
function writeRoles(roles) {
  try { localStorage.setItem(PORT_ROLES, JSON.stringify(roles)); } catch (e) {}
}

export function guessRole(name) {
  const n = String(name || '');
  if (PADISH.test(n)) return 'pads';
  if (KEYISH.test(n)) return 'keys';
  return null;                     // unknown — behaviour will settle it
}

export function createKeys({ engine, voiceFor, onPad, onActivity, onNote, poly = 16 } = {}) {
  const roles = readRoles();
  const held = new Map();          // "ch:note" -> live voice handle
  const sustained = new Set();     // keys whose note-off is waiting on the pedal
  const order = [];                // oldest first, for stealing
  let port = '';                   // the port the current message came from
  let role = null;

  // Per-channel controller state. Per CHANNEL rather than global, because an
  // MPE controller puts every finger on its own channel — honouring that is the
  // whole difference between per-note expression and a single smeared wheel.
  const ch = [];
  for (let i = 0; i < 16; i++) {
    ch.push({
      bend: 0, range: 2, mod: 0, press: 0, timbre: 0, level: 1,
      pedal: false, rpn: -1, rpnMsb: 0,
    });
  }

  // What the player is currently doing with their hands. The monitor reads this
  // so the movement you SEE is the movement you MADE.
  const live = { bend: 0, mod: 0, press: 0, timbre: 0, notes: 0, at: 0, name: '', role: null };

  function announce() { live.at = Date.now(); onActivity && onActivity(live); }

  // Which notes are physically down, in the order they went down. The key
  // display reads this so what lights on screen is what is held on the
  // hardware — not a repaint of the messages that went past.
  const down = new Set();
  function sawNote(n, on, vel) {
    on ? down.add(n) : down.delete(n);
    onNote && onNote(n, on, vel);
  }

  function decide(name, note) {
    // A remembered verdict always wins — a controller should never be
    // re-diagnosed, and certainly never re-diagnosed differently.
    if (roles[name]) return roles[name];
    const g = guessRole(name);
    if (g) { roles[name] = g; writeRoles(roles); return g; }
    // No name to go on. Stay in the old pad behaviour, which is what every
    // existing session already does, until a note tells us otherwise.
    if (note != null && (note < PAD_LO || note > PAD_HI)) {
      roles[name] = 'keys'; writeRoles(roles); return 'keys';
    }
    return 'pads';
  }
  // A wheel or a pedal settles the question on its own: pad banks do not have
  // them, and a keyboard usually moves one before it has played four notes.
  function sawExpressive(name) {
    if (roles[name] === 'keys') return;
    roles[name] = 'keys'; writeRoles(roles); role = 'keys';
  }

  const key = (c, n) => c + ':' + n;

  function stealIfNeeded() {
    while (order.length >= poly) {
      const k = order.shift();
      const h = held.get(k);
      if (h) { h.steal(); held.delete(k); }
      sustained.delete(k);
    }
  }

  function noteOn(c, n, vel) {
    const voice = voiceFor && voiceFor();
    if (!voice) return;
    engine.resume();
    const k = key(c, n);
    // Retriggering a key that is already down: end the old one first, or the
    // two stack and every repeated note gets louder than the last.
    const prev = held.get(k);
    if (prev) {
      prev.steal(); held.delete(k);
      const j = order.indexOf(k); if (j >= 0) order.splice(j, 1);
    }
    stealIfNeeded();

    const h = engine.hold(voice, n, vel, 0);
    held.set(k, h); order.push(k);
    sustained.delete(k);

    // Hand the new note the state the controller is ALREADY in. Without this,
    // a note played while the wheel is up starts dry and only catches up on the
    // next wheel move — the classic "my vibrato disappeared" bug.
    const s = ch[c];
    h.bend(s.bend * s.range);
    h.vib(s.mod * 60);
    h.press(s.press);
    h.timbre(s.timbre);
    h.level(s.level);

    live.notes = held.size; sawNote(n, true, vel); announce();
  }

  function noteOff(c, n) {
    const k = key(c, n);
    const h = held.get(k);
    if (!h) return;
    // Pedal down: the key is released but the note is not. Remember it so the
    // pedal can let go of it later.
    // The KEY is up either way. Only the SOUND is still held by the pedal, so
    // the display must let go of the key even while the note keeps ringing —
    // otherwise a pedalled passage leaves the whole keyboard lit.
    sawNote(n, false);
    if (ch[c].pedal) { sustained.add(k); return; }
    h.off(); held.delete(k);
    const i = order.indexOf(k); if (i >= 0) order.splice(i, 1);
    live.notes = held.size; announce();
  }

  function eachOn(c, fn) {
    for (const [k, h] of held) if (+k.split(':')[0] === c) fn(h);
  }

  function allOff(c, hard) {
    for (const [k, h] of held) {
      if (c != null && +k.split(':')[0] !== c) continue;
      hard ? h.steal() : h.off();
      held.delete(k);
      sawNote(+k.split(':')[1], false);
    }
    order.length = 0; sustained.clear(); down.clear();
    live.notes = 0; announce();
  }

  function cc(c, num, val) {
    const s = ch[c], v = val / 127;
    switch (num) {
      case 1:                                     // mod wheel -> vibrato
        s.mod = v; sawExpressive(port);
        eachOn(c, (h) => h.vib(v * 60));
        live.mod = v; announce(); break;
      case 2: case 11:                            // breath / expression -> level
        s.level = v; eachOn(c, (h) => h.level(v)); announce(); break;
      case 7:                                     // channel volume
        s.level = v; eachOn(c, (h) => h.level(v)); break;
      case 64: {                                  // sustain pedal
        const down = val >= 64;
        if (down === s.pedal) break;
        s.pedal = down; sawExpressive(port);
        if (!down) {
          // Pedal up releases everything the pedal was holding — and ONLY that.
          // Keys still physically down must keep sounding, which is exactly the
          // half of pedal behaviour that naive implementations drop.
          for (const k of Array.from(sustained)) {
            if (+k.split(':')[0] !== c) continue;
            const h = held.get(k);
            if (h) { h.off(); held.delete(k); }
            sustained.delete(k);
            const i = order.indexOf(k); if (i >= 0) order.splice(i, 1);
          }
          live.notes = held.size; announce();
        }
        break;
      }
      case 74:                                    // timbre / brightness / MPE slide
        s.timbre = v; eachOn(c, (h) => h.timbre(v));
        live.timbre = v; announce(); break;
      case 121:                                   // reset all controllers
        s.bend = 0; s.mod = 0; s.press = 0; s.timbre = 0; s.level = 1; s.pedal = false;
        eachOn(c, (h) => { h.bend(0); h.vib(0); h.press(0); h.timbre(0); h.level(1); });
        live.bend = 0; live.mod = 0; live.press = 0; live.timbre = 0; announce(); break;
      case 123: case 120:                         // all notes off / all sound off
        allOff(c, num === 120); break;
      // ---- RPN 0: the controller telling us its own bend range ----------
      // This is the difference between "bend feels wrong on this keyboard" and
      // bend simply being right everywhere. A controller set to ±12 announces
      // it; assuming ±2 for everything makes a whole-step out of an octave.
      case 101: s.rpnMsb = val; s.rpn = -1; break;
      case 100: s.rpn = (s.rpnMsb === 0 && val === 0) ? 0 : -1; break;
      case 6: if (s.rpn === 0) { s.range = Math.max(1, Math.min(48, val || 2)); } break;
      case 38: if (s.rpn === 0) { s.range = Math.floor(s.range) + (val / 100); } break;
      default: break;
    }
  }

  function bend(c, lsb, msb) {
    // 14-bit, centred at 8192. Using only the MSB is the common shortcut and it
    // is why so many bends sound like stairs — 128 steps across a whole tone is
    // audibly quantised on a slow bend.
    const raw = ((msb << 7) | lsb) - 8192;
    const s = ch[c];
    s.bend = raw / (raw < 0 ? 8192 : 8191);
    sawExpressive(port);
    eachOn(c, (h) => h.bend(s.bend * s.range));
    live.bend = s.bend * s.range; announce();
  }

  return {
    get role() { return role; },
    get live() { return live; },
    get voices() { return held.size; },
    panic() { allOff(null, true); for (const s of ch) s.pedal = false; },
    // Which notes are down right now. A snapshot, not the live Set — a display
    // that could mutate the instrument's state by accident is a bug waiting.
    notesDown() { return [...down]; },
    // Forget what we learned about a controller, so the next few notes decide
    // again. Surfaced in the MIDI window: a single bad guess must be reversible
    // or a controller read wrong once is read wrong forever.
    forget(name) { delete roles[name]; writeRoles(roles); },
    // Overrule the guess outright. The port sniffing is right almost always,
    // and "almost" is the whole reason this exists — a controller that is
    // physically a keyboard but sends only pad notes has no tell, and the
    // person holding it can see what it is in a second.
    setRole(name, r) {
      if (r !== 'keys' && r !== 'pads') return;
      roles[name] = r; writeRoles(roles);
      if (name === port) role = r;
    },
    // What this port WILL do, never null. Pads is the standing assumption for a
    // controller nothing is known about yet, so that is the honest answer to
    // give — an undecided port still behaves like something.
    roleOf(name) { return roles[name] || guessRole(name) || 'pads'; },
    // Whether that answer is a decision or just the assumption. The status line
    // uses it to avoid claiming a controller is a pad bank before it knows.
    decided(name) { return !!(roles[name] || guessRole(name)); },

    handle(data, portName) {
      if (!data || data.length < 1) return;
      port = portName || port || 'midi';
      const status = data[0] & 0xf0, c = data[0] & 0x0f;
      if (status === 0xf0 || data[0] >= 0xf8) return;      // clock and sysex are not ours

      if (status === 0xb0) { cc(c, data[1], data[2]); return; }
      if (status === 0xe0) { bend(c, data[1], data[2]); return; }
      if (status === 0xd0) {                                // channel pressure
        const v = data[1] / 127; ch[c].press = v; sawExpressive(port);
        eachOn(c, (h) => h.press(v));
        live.press = v; announce(); return;
      }
      if (status === 0xa0) {                                // polyphonic pressure
        const h = held.get(key(c, data[1]));
        if (h) h.press(data[2] / 127);
        // The readout shows the last finger that moved, not a running maximum —
        // a max would climb to 127 and stay there for the rest of the session.
        live.press = data[2] / 127; announce(); return;
      }

      const on = status === 0x90 && data[2] > 0;
      const off = status === 0x80 || (status === 0x90 && data[2] === 0);
      if (!on && !off) return;

      // Channel 10 is percussion by MIDI convention, on every device ever made.
      // No amount of learning should override a standard that explicit.
      role = (c === 9) ? 'pads' : decide(port, data[1]);
      live.name = port; live.role = role;

      if (role === 'pads') {
        // A pad hit is still a note arriving, and the MIDI window is where you
        // go to find out whether the app is hearing the hardware at all. It has
        // to show pad traffic too, or a pad controller looks dead in the one
        // place built to prove it is not.
        sawNote(data[1], on, data[2]);
        if (on && onPad) onPad(data[1], data[2]);
        return;
      }
      on ? noteOn(c, data[1], data[2]) : noteOff(c, data[1]);
    },
  };
}
