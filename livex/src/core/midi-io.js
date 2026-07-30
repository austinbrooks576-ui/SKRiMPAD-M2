// midi-io.js — one input surface for Web MIDI, BLE-MIDI (Web Bluetooth), and the
// native Android bridge. Normalizes everything to {status,d1,d2,cmd,chan,port}.
// Ported from SKRiMPAD M2's proven handlers (hot-plug + BLE running-status parse).

const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHAR = '7772e5db-3868-4112-a1a9-f2669d106bf3';

export function createMidiIO({ onEvent, onPorts } = {}) {
  let access = null;
  let bleStatus = 0; // BLE running-status latch
  let bleName = 'BLE MIDI'; // set on GATT connect so the board titles correctly

  const emit = (data, port) => {
    if (!data || data.length < 1) return;
    const [status, d1 = 0, d2 = 0] = data;
    if (status < 0x80) return; // ignore stray data / clock bytes handled elsewhere
    onEvent && onEvent({ status, d1, d2, cmd: status & 0xf0, chan: status & 0x0f, port });
  };

  function listInputs() { return access ? [...access.inputs.values()] : []; }

  // --- Web MIDI (desktop Electron / Chrome) with hot-plug -------------------
  // Memoized: the app calls start() at boot, so a later connectBluetooth() never
  // re-requests access — its `await start()` resolves on an already-settled
  // promise (a single microtask), keeping the click's transient user activation
  // alive for requestDevice(). Losing that activation is exactly what broke
  // Bluetooth in SKRiMPAD M2.
  let startPromise = null;
  function start() { return (startPromise = startPromise || _start()); }

  async function _start() {
    // Android WebView has no Web MIDI → native bridge injects window.AndroidMidi.
    // CRITICAL: MainActivity.kt invokes `window.onNativeMIDIMessage(bytes)` — that
    // exact global MUST exist or the APK never hears a single MIDI byte.
    if (typeof window !== 'undefined' && window.AndroidMidi) {
      let nativeName = 'MIDI DEVICE';
      window.onNativeMIDIMessage = (bytes) => emit(Array.from(bytes), { id: 'native', name: nativeName, native: true });
      window.onNativeMIDIStatus = (txt) => {
        // status lines look like "🎹 SMK25 connected" — harvest a device name so the
        // board gets a real title instead of the generic fallback
        const m = String(txt || '').match(/[—:-]?\s*([A-Za-z0-9][\w\s()-]{2,32}?)\s*(connected|ready|attached)/i);
        if (m) nativeName = m[1].trim();
        onPorts && onPorts(listInputs()); // let the host refresh
      };
      window.__livexNativeMidi = window.onNativeMIDIMessage; // legacy alias
      try { window.AndroidMidi.enable(); } catch (e) {}
      try { window.AndroidMidi.scanBluetooth && window.AndroidMidi.scanBluetooth(); } catch (e) {}
      return { mode: 'native' };
    }
    if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
      access = await navigator.requestMIDIAccess({ sysex: false });
      const hook = () => access.inputs.forEach((inp) => { inp.onmidimessage = (e) => emit(e.data, inp); });
      hook();
      access.onstatechange = () => { hook(); onPorts && onPorts(listInputs()); };
      onPorts && onPorts(listInputs());
      return { mode: 'webmidi', access };
    }
    return { mode: 'none' };
  }

  // --- BLE-MIDI via Web Bluetooth (desktop fallback / direct connect) -------
  function parseBLE(dv) {
    const bytes = new Uint8Array(dv.buffer);
    if (bytes.length < 3) return;
    let i = 1; // skip BLE header byte
    while (i < bytes.length) {
      if (bytes[i] & 0x80) i++;                 // timestamp byte
      if (i >= bytes.length) break;
      if (bytes[i] & 0x80) { bleStatus = bytes[i]; i++; } // new status else running status
      const type = bleStatus & 0xf0;
      if (type < 0x80) break;
      const len = (type === 0xc0 || type === 0xd0) ? 1 : 2;
      const d = [bleStatus];
      for (let k = 0; k < len && i < bytes.length && !(bytes[i] & 0x80); k++) d.push(bytes[i++]);
      if (d.length >= len + 1) emit(d, { id: 'ble', name: bleName, ble: true });
    }
  }

  function inputCount() { return access ? access.inputs.size : 0; }

  // The CORRECT desktop Bluetooth flow — the hard-won fix from SKRiMPAD-M2
  // (commit 7397e19 "use the driver-bridged port, don't fight it over GATT"):
  //
  //   A wireless controller reaches us one of two ways —
  //   (a) the OS/vendor driver already bridges it as a normal MIDI PORT. On
  //       Windows the KORG BLE-MIDI driver does this for the SMK-25 V2, BUT the
  //       port stays SILENT until you press CONNECT in the KORG BLE-MIDI panel.
  //       When a port exists we MUST use it and must NOT also open Web Bluetooth
  //       GATT — a BLE device allows a single GATT link, so a second connection
  //       fights the driver and neither side gets data. (This was the bug.)
  //   (b) nothing bridges it → we open the BLE-MIDI GATT service ourselves.
  //
  // Must run inside the click gesture (requestDevice needs a live user activation;
  // a setTimeout drops it and the chooser silently never opens).
  async function connectBluetooth({ onStatus } = {}) {
    // ANDROID: the WebView has no Web Bluetooth — BLE MIDI goes through the native
    // MidiManager (pair in system Bluetooth settings first, then it attaches here).
    if (typeof window !== 'undefined' && window.AndroidMidi) {
      try { window.AndroidMidi.enable(); } catch (e) {}
      try { window.AndroidMidi.scanBluetooth && window.AndroidMidi.scanBluetooth(); } catch (e) {}
      onStatus && onStatus({ mode: 'native', hint: 'Pair the controller in Android Bluetooth settings — scanning…' });
      return { mode: 'native' };
    }
    if (!access && typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
      await start(); // Web MIDI is pre-granted in Electron → bridged ports already hooked
    }
    const n = inputCount();
    if (n > 0) { // already bridged as MIDI port(s) — use them, DO NOT touch GATT
      onStatus && onStatus({ mode: 'port', count: n,
        hint: 'Windows + KORG: open the KORG BLE-MIDI panel and press CONNECT so the port transmits.' });
      return { mode: 'port', count: n };
    }
    if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      const dev = await connectBLE({ onStatus });
      return { mode: 'gatt', device: dev && dev.name };
    }
    onStatus && onStatus({ mode: 'none',
      hint: 'No MIDI port — pair it (or open the KORG BLE-MIDI panel and CONNECT), then retry.' });
    return { mode: 'none' };
  }

  // Direct BLE-MIDI GATT (fallback only, when nothing bridges the device). Tries
  // the standard service first; some units (incl. SMK25V2) don't advertise it, so
  // it falls back to known name-prefixes, then accept-all. Auto-reconnects on drop.
  const KNOWN = ['SMK', 'SMK25', 'WORLDE', 'M-VAVE', 'MVAVE', 'M-WAVE', 'KORG', 'nanoKEY', 'microKEY', 'MPK', 'LPK', 'MPD', 'Launchkey'];
  async function connectBLE({ onStatus } = {}) {
    if (!(typeof navigator !== 'undefined' && navigator.bluetooth)) {
      throw new Error('Web Bluetooth unavailable — on Windows the controller instead appears as a MIDI port.');
    }
    let dev;
    try {
      dev = await navigator.bluetooth.requestDevice({ filters: [{ services: [BLE_MIDI_SERVICE] }], optionalServices: [BLE_MIDI_SERVICE] });
    } catch (e) {
      if (e && e.name === 'NotFoundError') {
        dev = await navigator.bluetooth.requestDevice({ filters: KNOWN.map((namePrefix) => ({ namePrefix })), optionalServices: [BLE_MIDI_SERVICE] })
          .catch(() => navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [BLE_MIDI_SERVICE] }));
      } else throw e;
    }
    if (dev && dev.name) bleName = dev.name;
    const attach = async () => {
      const server = await dev.gatt.connect();
      const svc = await server.getPrimaryService(BLE_MIDI_SERVICE);
      const ch = await svc.getCharacteristic(BLE_MIDI_CHAR);
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (e) => parseBLE(e.target.value));
      onStatus && onStatus({ mode: 'gatt', connected: true, name: dev.name });
    };
    dev.addEventListener('gattserverdisconnected', () => {
      onStatus && onStatus({ mode: 'gatt', connected: false, name: dev.name });
      attach().catch(() => {}); // controllers drop/resume BLE frequently — try once
    });
    await attach();
    return dev;
  }

  return { start, listInputs, inputCount, connectBluetooth, connectBLE, access: () => access, _emit: emit };
}
