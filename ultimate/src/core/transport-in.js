// transport-in.js — making PLAY / STOP / REC on the hardware do their job.
//
// This is the single most reported failure on this class of controller, and it
// is not one bug. A transport button has no standard. The SAME UNIT sends
// something different depending on how it was set up:
//
//   1. SYSTEM REAL-TIME   FA start · FB continue · FC stop
//      What a drum machine or a sequencer sends. No record command exists in
//      this vocabulary at all, which is why some units send it and some don't.
//
//   2. MMC over SysEx     F0 7F <dev> 06 <cmd> F7
//      What the M-VAVE SMK-25 sends OUT OF THE BOX. Two things have to be true
//      for this to arrive: the browser must have been asked for SysEx
//      permission (see midi-io.js — with sysex:false it is silently dropped and
//      no amount of code downstream can help), and the decoder must not insist
//      on a particular device ID byte.
//
//   3. MACKIE CONTROL     note 5D stop · 5E play · 5F record
//      What a unit sends in "Mackie" or "DAW" mode. They are NOTES, on the same
//      wire as the keys, which is why they get mistaken for pads.
//
//   4. PLAIN CC           whatever the vendor editor was set to
//      Owners who reconfigure an SMK-25 with M-VAVE's CubeSuite app end up
//      here — CC 117 and CC 94 are both documented by users as the play
//      button. A CC is the most ambiguous of the four, because a CC is also
//      what every knob sends.
//
// So the rule is: understand all four, and NEVER let a guess beat something the
// user taught. decode() is handed a `claimed` predicate for exactly that — if
// a CC already belongs to a knob, it stays a knob, and the guess loses.

// Mackie Control transport block. Rewind and fast-forward are decoded and
// named even though nothing uses them yet: a message that is understood and
// ignored is silent, and a message that is not understood plays a note.
export const MCU_NOTES = {
  0x5b: 'rew', 0x5c: 'ff', 0x5d: 'stop', 0x5e: 'play', 0x5f: 'rec', 0x60: 'loop',
};

// CCs that owners of these units actually report their transport buttons on.
// 117/118/119 is the block the vendor editor offers; 93/94/95 mirrors the
// Mackie note numbers, which is what the same firmware does when told to send
// CCs instead of notes.
export const CC_TRANSPORT = {
  117: 'play', 118: 'stop', 119: 'rec',
  94: 'play', 93: 'stop', 95: 'rec',
};

// MMC command bytes, for the record — midi-io decodes these before the app sees
// them, but the table belongs with the others rather than buried in a decoder.
export const MMC = { 0x01: 'stop', 0x02: 'play', 0x03: 'play', 0x06: 'rec', 0x07: 'rec', 0x09: 'pause' };

// Is this message a BUTTON rather than a control? Buttons send the extremes;
// knobs and encoders send everything in between. Requiring an extreme is what
// stops a swept CC 94 from starting playback halfway through the sweep, and it
// costs nothing, because no transport button in existence sends 63.
const buttonish = (v) => v >= 126 || v <= 1;

// The whole decision, in one place.
//   e        the event from midi-io ({ cmd, chan, d1, d2, transport })
//   claimed  optional (kind, number, chan) => bool — "this already belongs to
//            something the user taught". A guess must never beat a mapping.
// Returns { name, how, down } or null. `how` is for the diagnosis panel: when
// a button still does not work, the first useful question is which of the four
// standards the unit is speaking, and this is the app's answer.
export function decode(e, claimed) {
  if (!e) return null;

  // 1 + 2. midi-io has already turned real-time and MMC into e.transport,
  // because both are decoded from the status byte before any channel routing
  // happens and there is nothing app-specific about either.
  if (e.transport) {
    return { name: e.transport, how: e.status === 0xf0 ? 'mmc' : 'realtime', down: true };
  }

  const cmd = e.cmd, d1 = e.d1, d2 = e.d2;

  // 3. Mackie notes. Note-on with velocity is a press, note-off (or velocity 0)
  // is a release — the transport acts on the press, but the release still has
  // to be CLAIMED, or it falls through and plays a note.
  if ((cmd === 0x90 || cmd === 0x80) && MCU_NOTES[d1]) {
    if (claimed && claimed('note', d1, e.chan)) return null;
    return { name: MCU_NOTES[d1], how: 'mackie', down: cmd === 0x90 && d2 > 0 };
  }

  // 4. CC, the ambiguous one, and therefore the most guarded: it must be a CC
  // this class of unit is known to use, it must be at an extreme, and it must
  // not already be somebody's knob.
  if (cmd === 0xb0 && CC_TRANSPORT[d1] && buttonish(d2)) {
    if (claimed && claimed('cc', d1, e.chan)) return null;
    return { name: CC_TRANSPORT[d1], how: 'cc', down: d2 >= 126 };
  }

  return null;
}

// Would this message be thrown away? A unit whose transport does nothing is
// sending SOMETHING, and the fastest route from "it doesn't work" to a fix is
// showing the user what arrived, in the units the learn button speaks. Anything
// that looks like a button but matched nothing is worth remembering.
export function describe(e) {
  if (!e) return '';
  if (e.transport) return e.transport.toUpperCase() + ' (' + (e.status === 0xf0 ? 'MMC SysEx' : 'real-time') + ')';
  if (e.status === 0xf0) return 'SysEx, ' + ((e.raw && e.raw.length) || 0) + ' bytes — not MMC';
  const ch = (e.chan | 0) + 1;
  if (e.cmd === 0xb0) return 'CC ' + e.d1 + ' = ' + e.d2 + ' on ch' + ch;
  if (e.cmd === 0x90) return 'note ' + e.d1 + ' on, vel ' + e.d2 + ', ch' + ch;
  if (e.cmd === 0x80) return 'note ' + e.d1 + ' off, ch' + ch;
  if (e.cmd === 0xc0) return 'program change ' + e.d1 + ' on ch' + ch;
  return 'status 0x' + (e.status || 0).toString(16) + ' ' + e.d1 + ' ' + e.d2;
}

// Why might the transport be silent? Asked of the MIDI diagnosis, answered in
// the order the causes actually occur — there is no point telling somebody to
// learn a button when the browser refused SysEx and the button is MMC.
export function whyQuiet({ sysex, ports, everSpoke, taught, seen }) {
  if (!ports) return 'No MIDI ports at all. Plug the keyboard in, or connect it over Bluetooth.';
  if (!everSpoke) return 'The port exists but has never sent a byte. On Windows a paired BLE keyboard does this until you press CONNECT in the vendor panel.';
  if (taught) return '';
  if (seen) return 'Something arrived that is not a transport message: ' + seen + '. Learn it to PLAY, STOP or REC in SETUP.';
  if (!sysex) return 'SysEx was refused by the browser, and this keyboard sends its transport as MMC SysEx. Nothing downstream can recover it — reload and allow MIDI, or set the buttons to send CC in the vendor app.';
  return 'Press a transport button. If nothing appears here, the unit is not sending one.';
}
