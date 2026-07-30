# SMK-25 II — Full Controller Reference

> **Project standard:** every supported controller gets a reference this detailed —
> every button, knob, pad, wheel, **both shelves (A/B banks)**, and every function
> modeled and made to work. This file is the template.

Device: **M-VAVE / Worlde SMK-25 II** (a.k.a. SMK25V2; sold as LEKATO/Sinco SMK-25).
25 mini keys · 8 velocity pads · 8 knobs · dual A/B banks · arpeggiator · smart
scale/chord · USB + BLE MIDI.

## Identity (verified on the owner's unit, 2026-07-23)

| Signal | Value |
|---|---|
| USB `input.name` | `SMK25` (+ `MIDIIN2 (SMK25)`, `MIDIIN3 (SMK25)` — 3 IN / 3 OUT ports) |
| USB VID/PID | `VID_4353` / `PID_4B4D` |
| BLE name | `SMK25V2` (`… (Bluetooth MIDI IN/OUT)`) via the **KORG BLE-MIDI** stack |
| Coalescing | all ports/bt collapse to signature `smk25` (see `deviceSignature`) |

Sources: [LEKATO SMK-25 manual (ManualsLib)](https://www.manualslib.com/manual/3022208/Lekato-Smk-25.html),
[M-VAVE SMK-25 II](https://manuals.plus/asin/B0F1KBTXVY),
[M-VAVE SMK-25 MINI](https://device.report/manual/17681190).

## Control map

Legend: **C** = confirmed by manual/box · **I** = inferred from hardware convention
(exact CC #s are user-assignable via M-Vave's companion app, so the app **auto-learns
the real CC/note per bank via the capability probe** at runtime).

### Keyboard (25 keys)
| Control | Function | MIDI | App model |
|---|---|---|---|
| Keys ×25 | Notes, velocity-sensitive | Note On/Off + velocity, ch.1 | `keys{count:25,firstNote:48}`; accidentals drawn in **contrary color** |
| Key double-duty | While a function button is held, the printed legend above each key sets that parameter (see **Key-shortcut legend**) | — | shortcut layer keyed off held-button state |

### Pads (8) — with **PAD-B** second bank
| Control | Function | MIDI | App model |
|---|---|---|---|
| Pads 1–8 | Trigger drums/samples, velocity-sensitive | Note On, **ch.10** (GM drum notes) | `pads{count:8,layout:[2,4],channel:10,banks:2}` |
| **PAD-B** | Toggles pads to **Bank B** → a second set of 8 notes/sounds (16 total) | different note set on ch.10 | `padBank` state 0/1; each pad holds `{A:{note,file}, B:{note,file}}` |

### Knobs (8) — with **KNOB-B** second shelf
| Control | Function | MIDI | App model |
|---|---|---|---|
| Knobs 1–8 | Assignable rotary encoders (CC / aftertouch / pitch) | CC, ch.1 | `knobs:8, knobBanks:2` |
| **KNOB-B** | Toggles knobs to **Shelf B** → a second set of 8 CC assignments (16 total) | different CC set | `knobBank` state 0/1; each knob holds `{A:cc, B:cc}` |

### Octave / Transpose
| Control | Function | App model |
|---|---|---|
| **OCT+ / OCT-** | Shift keyboard octave up/down (C) | `octave` offset; re-labels + re-notes keys live |
| **TRANSPOSE** | Hold OCT+/OCT- and rotate the Transpose knob → shift pitch **one semitone per step** (C) | `transpose` offset in semitones |

### Arpeggiator (**ARP**)
| Parameter | Values | App model |
|---|---|---|
| Enable | ARP button; hold ARP + key to edit (C) | `arp.on` |
| Modes | Up, Down, **Incl**, **Excl**, Random, **Order**, **Repeat** (C) | `arp.mode` |
| Rate (time division) | 1/4, 1/4T, 1/8, 1/8T, 1/16, 1/16T, 1/32, 1/32T (C) | `arp.rate` (tempo-synced) |
| Latch | Arp keeps playing after keys released (C) | `arp.latch` |
| Gate | Note length (C) | `arp.gate` |
| Swing / Tempo | Groove + BPM (C, printed on knobs) | shared with global **BPM/metronome** |

### Smart Scale / Chord (**SCCH**)
| Parameter | Values | App model |
|---|---|---|
| Scale root/type | Select via keys C–B; **Major / Minor** toggle (C) | `scale.root`, `scale.type` |
| Chord | **TRIAD / 7TH / 9TH** (C) | `chord.type`; one key → full chord |

### Transport / connectivity / expression
| Control | Function | MIDI | App model |
|---|---|---|---|
| **PLAY / STOP / REC** | DAW transport (C) | MMC / CC | drives LIVEx loop: Play/Stop/Record |
| **BT** | Bluetooth MIDI pairing (C) | — | mirrors `midi-io` BLE GATT / native path |
| **PITCH** strip | Pitch bend (capacitive) (C) | Pitch Bend, ch.1 | `wheels:['pitch']` |
| **MOD** strip | Modulation (capacitive) (C) | CC1, ch.1 | `wheels:['mod']` |
| **SUSTAIN** | Sustain pedal jack (C) | CC64 | `features:['sustain']` |

## Key-shortcut legend (printed above the keys, from the box)

Held-button + key shortcuts seen on the unit — model as a shortcut layer:
`CH1 · TRIAD · 7TH · 9TH · RAND · MINOR · MAJOR · OFF · SYNC · GATE- · GATE+ ·
LATCH · TAP · OCT- · OCT+ · TRANSPOSE · DOWN · UP · INCL · EXCL · ORDER · REPEAT ·
BAND · MODE · SWING · TEMPO- · TEMPO+`.

## How LIVEx reproduces it (build checklist)
- [x] Identity + regex seed (`profiles.js`), 3-port coalescing (`deviceSignature`)
- [x] Profile models keys / pads(banks:2) / knobs(banks:2) / wheels / buttons / features
- [x] Schematic draws keyboard (contrary accidentals) + pads + knobs + function buttons
- [x] **Input router** (`src/core/router.js`): note/pad lighting, A/B bank state (PAD-B/KNOB-B) with glow, tap-to-play, gamepad→pad, window auto-follow
- [x] Live I/O: `src/core/midi-io.js` (Web MIDI hot-plug + BLE GATT + native bridge), `src/core/gamepad.js`
- [ ] Octave/transpose state machine (OCT± + Transpose knob) — router tracks state; wire to note remap + hardware
- [ ] Arp engine (modes, rates, latch, gate)
- [ ] Scale/chord engine (root, major/minor, triad/7th/9th)
- [ ] Probe auto-learns the **real** CC/note map per bank on first use
- [ ] Transport binding (PLAY/STOP/REC → loop) + shared BPM/metronome
