# Bluetooth MIDI — how it works & why it failed before

Source of truth: SKRiMPAD-M2 repo commit **`7397e19` "Windows BLE MIDI: use the
driver-bridged port, don't fight it over GATT"** (github.com/austinbrooks576-ui/SKRiMPAD-M2).
That fix postdates the installed 2026-07-22 build, which still had the bug.

## What was broken

The old desktop path opened a **Web Bluetooth GATT** link to the controller. Two failures:

1. **Name filter never matched the SMK-25.** It advertises over BLE as **`SMK25V2`**,
   which didn't match the old `/midi|korg|nanokey…/` regex, so the Electron chooser
   fell through to `devices[0]` — often a nearby phone/earbuds — and the connect failed.
2. **Fighting the vendor driver.** On Windows the **KORG BLE-MIDI driver** already
   bridges the SMK-25 V2 to a normal MIDI **port**. A BLE device allows only **one GATT
   connection**, so opening Web Bluetooth GATT on top of the driver means *both* sides
   get nothing.

## The correct flow (now in LIVEx)

`midi-io.js → connectBluetooth()`:

1. Ensure Web MIDI is up (Electron pre-grants the `midi` permission in
   [electron/main.js](../electron/main.js) — without this grant, **nothing** connects).
2. **If a MIDI port already exists → use it, do NOT open GATT.** The driver/OS-bridged
   port (USB, or a KORG BLE endpoint) is hooked automatically and re-hooks on hot-plug.
3. **Only if no MIDI port exists** → open the BLE-MIDI GATT service ourselves
   (`connectBLE`), inside the click gesture, filtered by the BLE-MIDI service UUID with
   name-prefix + accept-all fallbacks, and auto-reconnect on drop.

Electron chooser ([electron/main.js](../electron/main.js)): waits for a MIDI-named device
(broad regex incl. `smk`, `worlde`, `m-vave`, `korg`, `akai`…), only falling back to the
first device after an 8 s settle — never blind-grabbing.

## ⚠️ The step people miss (likely why yours "didn't work")

On **Windows with a KORG BLE-MIDI controller**, the driver creates the MIDI port but it
stays **silent until you press CONNECT in the KORG BLE-MIDI control panel**. The port
shows up, but no notes flow until you hit CONNECT there. LIVEx now says exactly this in
the 📶 BT toast.

## Per platform

| Platform | Path |
|---|---|
| Windows | KORG BLE-MIDI driver → Web MIDI **port** (press CONNECT in KORG panel). GATT only if no driver. |
| Linux | Pair in OS Bluetooth (BlueZ exposes an ALSA seq/MIDI port) → Web MIDI, or Web Bluetooth GATT. |
| Android (.apk) | Native `MidiManager.openBluetoothDevice()` via the `window.AndroidMidi` bridge (System WebView has no Web MIDI/Bluetooth). |

## Multi-device

Web MIDI hooks **every** input port; `device-manager.js` groups ports by device signature
(the SMK-25's 3 IN ports → one board), renders a schematic per physical device, and routes
each event to its board by port id. Plug in three controllers → three live boards.
