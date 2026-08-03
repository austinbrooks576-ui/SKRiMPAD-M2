// ble-midi.js — SKRiMPAD's OWN BLE MIDI stack. No OS MIDI subsystem involved:
// not Android's MidiManager, not Windows' winmm, not a vendor driver like KORG's
// BLE-MIDI panel. We scan, we connect GATT, we subscribe to the characteristic,
// and we decode the packets ourselves — so behaviour is identical everywhere and
// nothing can sit between the controller and the app.
//
// THE SPEC (BLE-MIDI 1.0), which is what makes "recognises all controllers" true:
//   service        03B80E5A-EDE8-4B33-A751-6CE34EC4C700
//   characteristic 7772E5DB-3868-4112-A1A9-F2669D106BF3   (notify)
// Every compliant BLE MIDI device exposes these. Plenty do NOT advertise the
// service in their scan record — so we never identify by name. A candidate is a
// MIDI controller if, after connecting, it HAS that service. That verification
// is the universal test; name lists are only used to prioritise who to try first.
//
// PACKET FORMAT (this is where naive parsers break):
//   [header] [timestampLow] [status] [d1] [d2] ( [timestampLow] [status?] ... )
//   header       = 1 0 ttttttt   (bit7 set, 6 bits of timestamp high)
//   timestampLow = 1 ttttttt     (bit7 set)
//   running status is allowed: a timestamp may be followed by data with no status
//   SysEx may SPAN packets: F0 … (timestamps interleaved) … F7
export const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
export const BLE_MIDI_CHAR = '7772e5db-3868-4112-a1a9-f2669d106bf3';

const dataLenFor = (status) => {
  const t = status & 0xf0;
  if (t === 0xc0 || t === 0xd0) return 1;          // program change / channel pressure
  if (t === 0xf0) {
    if (status === 0xf1 || status === 0xf3) return 1;
    if (status === 0xf2) return 2;
    return 0;                                       // realtime + F6/F7
  }
  return 2;
};

// Create a decoder with its own state. One per device — running status and a
// half-finished SysEx belong to that device alone, and sharing them between two
// controllers corrupts both streams.
// A real patch dump is tens of kilobytes; nothing legitimate is anywhere near
// this. The cap exists for the stream that never ends — a controller yanked
// mid-dump, or a corrupt packet that swallows an F7 — where the accumulator
// otherwise grows until the tab dies.
const SYSEX_MAX = 65536;

export function createBleDecoder(onMessage) {
  let runningStatus = 0;
  let sysex = null;                                  // accumulating F0 … F7
  let sysexLost = false;                             // over the cap: swallow to F7

  return function decode(bytes) {
    if (!bytes || bytes.length < 1) return;
    // A packet with only a header carries nothing.
    if (bytes.length < 2) return;
    let i = 1;                                       // skip header

    while (i < bytes.length) {
      const b = bytes[i];

      // Inside a SysEx, everything that is not a status byte is payload. A byte
      // with bit7 set is either the timestamp preceding F7, or F7 itself.
      if (sysex) {
        if (b & 0x80) {
          // A high byte inside a dump is a TIMESTAMP, and what follows it says
          // what it was for. This has to mirror the main branch below, because
          // a timestamp and a real-time status occupy the same 0x80-0xFF range
          // and cannot be told apart by value alone.
          i++;
          if (i >= bytes.length) break;
          const s = bytes[i];
          if (s === 0xf7) {                            // end of dump
            i++;
            // A dump that blew the cap is dropped rather than delivered short.
            // Handing a truncated patch bank to a synth as though it were whole
            // is worse than losing it.
            if (!sysexLost) { sysex.push(0xf7); onMessage(sysex); }
            sysex = null; sysexLost = false;
            continue;
          }
          // Real-time is legal ANYWHERE, including mid-dump, and used to be
          // swallowed here — so a clock tick, or the transport button someone
          // pressed while a dump was in flight, simply vanished.
          if (s >= 0xf8) { onMessage([s]); i++; continue; }
          continue;                                    // plain timestamp before payload
        }
        if (sysex.length >= SYSEX_MAX) { sysexLost = true; sysex.length = 0; }
        else sysex.push(b);
        i++; continue;
      }

      if (b & 0x80) {
        // Timestamp byte, or a real status byte. Distinguish by what follows:
        // a status byte is >= 0x80 too, so BLE-MIDI puts the timestamp FIRST and
        // the status (if any) immediately after.
        i++;                                          // consume timestamp
        if (i >= bytes.length) break;
        const s = bytes[i];
        if (s & 0x80) {                               // an actual status byte
          i++;
          if (s === 0xf0) { sysex = [0xf0]; continue; }
          if (s >= 0xf8) { onMessage([s]); continue; } // system real-time: no data
          runningStatus = s < 0xf0 ? s : 0;           // system common clears running status
          const need = dataLenFor(s);
          const msg = [s];
          for (let k = 0; k < need && i < bytes.length && !(bytes[i] & 0x80); k++) msg.push(bytes[i++]);
          if (msg.length === need + 1) onMessage(msg);
          continue;
        }
        // running status: timestamp then data bytes, no status repeated
        if (!runningStatus) { continue; }
        const need = dataLenFor(runningStatus);
        const msg = [runningStatus];
        for (let k = 0; k < need && i < bytes.length && !(bytes[i] & 0x80); k++) msg.push(bytes[i++]);
        if (msg.length === need + 1) onMessage(msg);
        continue;
      }

      // A bare data byte with no preceding timestamp — running status continued.
      if (runningStatus) {
        const need = dataLenFor(runningStatus);
        const msg = [runningStatus];
        for (let k = 0; k < need && i < bytes.length && !(bytes[i] & 0x80); k++) msg.push(bytes[i++]);
        if (msg.length === need + 1) { onMessage(msg); continue; }
      }
      i++;                                            // unparseable: skip
    }
  };
}

// Controllers we try FIRST when several unnamed devices are in range. This is a
// priority hint only — never a filter. Anything exposing the MIDI service is
// accepted regardless of what it calls itself.
export const MIDI_NAME_HINTS = [
  'midi', 'smk', 'm-vave', 'mvave', 'worlde', 'korg', 'nanokey', 'nanopad', 'nanokontrol',
  'microkey', 'keystage', 'jamjum', 'jam jum', 'jp mini', 'jp-1', 'jp1', 'akai', 'mpk', 'lpk',
  'launchkey', 'launchpad', 'arturia', 'keystep', 'minilab', 'novation', 'roli', 'seaboard',
  'yamaha', 'casio', 'roland', 'donner', 'alesis', 'nektar', 'xkey', 'cme', 'widi', 'quicco',
];
export const looksLikeMidiName = (n) => {
  const s = String(n || '').toLowerCase();
  return MIDI_NAME_HINTS.some((h) => s.includes(h));
};
