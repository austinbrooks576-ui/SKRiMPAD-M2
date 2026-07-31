// midi-io.js — one input surface for Web MIDI, BLE-MIDI (Web Bluetooth), and the
// native Android bridge. Normalizes everything to {status,d1,d2,cmd,chan,port}.
// Ported from SKRiMPAD M2's proven handlers (hot-plug + BLE running-status parse).

const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHAR = '7772e5db-3868-4112-a1a9-f2669d106bf3';

export function createMidiIO({ onEvent, onPorts } = {}) {
  let access = null;
  let bleStatus = 0; // BLE running-status latch
  let bleName = 'BLE MIDI'; // set on GATT connect so the board titles correctly

  // Has any real MIDI byte ever arrived? This distinguishes a LIVE port from a
  // bridged-but-SILENT one — on Windows the KORG BLE-MIDI driver publishes a port
  // the moment the controller is paired, but it stays mute until you press
  // CONNECT in the KORG panel. Trusting the port's mere existence is what left
  // people staring at a dead keyboard.
  let lastDataAt = 0;
  const emit = (data, port) => {
    if (!data || data.length < 1) return;
    const [status, d1 = 0, d2 = 0] = data;
    if (status < 0x80) return;   // stray data byte
    // Drop System Real-Time / System Common (>= 0xF0): clock at 24 ppqn and
    // active sensing several times a second are pure noise to us, and letting
    // them through drove the router, the probe and the re-render loop hard
    // enough to stall the app.
    if (status >= 0xf0) return;
    lastDataAt = Date.now();
    onEvent && onEvent({ status, d1, d2, cmd: status & 0xf0, chan: status & 0x0f, port });
  };
  const hasLiveData = () => lastDataAt > 0;

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
      const nativePort = () => ({ id: 'native', name: nativeName, native: true });
      window.onNativeMIDIMessage = (bytes) => emit(Array.from(bytes), nativePort());
      // batched form — the bridge coalesces a frame's worth of packets into one
      // call so a chatty controller can't flood the WebView
      window.onNativeMIDIBatch = (list) => {
        if (!list || !list.length) return;
        const p = nativePort();
        for (let i = 0; i < list.length; i++) emit(Array.from(list[i]), p);
      };
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
  // Every connected BLE controller gets its OWN port identity and its OWN
  // running-status latch. Sharing either one means a second wireless controller
  // lands on the first one's board and corrupts its running-status stream — so
  // only one BLE device could ever really work at a time.
  function parseBLE(dv, ctx) {
    const bytes = new Uint8Array(dv.buffer);
    if (bytes.length < 3) return;
    const st = ctx || { status: 0, port: { id: 'ble', name: bleName, ble: true } };
    let i = 1; // skip BLE header byte
    while (i < bytes.length) {
      if (bytes[i] & 0x80) i++;                 // timestamp byte
      if (i >= bytes.length) break;
      if (bytes[i] & 0x80) { st.status = bytes[i]; i++; } // new status else running status
      const type = st.status & 0xf0;
      if (type < 0x80) break;
      const len = (type === 0xc0 || type === 0xd0) ? 1 : 2;
      const d = [st.status];
      for (let k = 0; k < len && i < bytes.length && !(bytes[i] & 0x80); k++) d.push(bytes[i++]);
      if (d.length >= len + 1) emit(d, st.port);
    }
  }

  function inputCount() { return access ? access.inputs.size : 0; }

  // The desktop Bluetooth flow. Two ways a wireless controller reaches us:
  //
  //   (a) the OS/vendor driver bridges it as a normal MIDI PORT. A port that is
  //       actually CARRYING DATA is the best path — use it and never also open
  //       GATT, because a BLE device allows one GATT link and a second connection
  //       fights the driver until neither side works.
  //   (b) nothing usable bridges it → we open the BLE-MIDI GATT service ourselves.
  //
  // The trap in between: Windows' KORG BLE-MIDI driver publishes a port as soon
  // as the controller is paired, but that port stays MUTE until you press CONNECT
  // in the KORG panel. Existence alone therefore proves nothing — so a port we
  // have never received a byte from is treated as NOT connected, and we take over
  // via GATT instead of sending the player off to a control panel.
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
    if (n > 0 && hasLiveData()) {
      // a port that has actually delivered MIDI — the ideal path, leave GATT alone
      onStatus && onStatus({ mode: 'port', count: n, hint: n + ' MIDI port(s) connected and live.' });
      return { mode: 'port', count: n };
    }
    // No ports, or ports that have never made a sound: connect it ourselves.
    if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      if (n > 0) {
        onStatus && onStatus({ mode: 'silent-port', count: n,
          hint: 'A MIDI port exists but has sent nothing — connecting over Bluetooth directly…' });
      }
      try {
        const dev = await connectBLE({ onStatus });
        return { mode: 'gatt', device: dev && dev.name };
      } catch (err) {
        // The one case we genuinely cannot take over: the vendor driver is holding
        // the single GATT link. Say so precisely instead of failing silently.
        if (err && /GATT|connect|Network/i.test(String(err.message || err)) && n > 0) {
          onStatus && onStatus({ mode: 'held',
            hint: 'The controller is held by its vendor driver (e.g. the KORG BLE-MIDI panel). Disconnect it there, then tap 📶 again.' });
          return { mode: 'held', count: n };
        }
        throw err;
      }
    }
    if (n > 0) {
      onStatus && onStatus({ mode: 'port', count: n, hint: n + ' MIDI port(s) found — play a key to confirm.' });
      return { mode: 'port', count: n };
    }
    onStatus && onStatus({ mode: 'none', hint: 'No MIDI device found — pair the controller, then tap 📶 again.' });
    return { mode: 'none' };
  }

  const KNOWN = ['SMK', 'SMK25', 'WORLDE', 'M-VAVE', 'MVAVE', 'M-WAVE', 'KORG', 'nanoKEY', 'microKEY', 'MPK', 'LPK', 'MPD', 'Launchkey'];
  const bound = new Set(); // devices already wired, so we never double-attach

  // Wire one BluetoothDevice: open GATT, subscribe to the BLE-MIDI characteristic,
  // and keep it alive. Controllers sleep and drop the link constantly, so a
  // disconnect schedules backing-off retries rather than giving up — that plus
  // autoReconnect() is what removes the manual reconnect step for good.
  async function attachDevice(dev, { onStatus } = {}) {
    if (dev && dev.name) bleName = dev.name;
    // one parse context per device: its own running-status latch + port identity,
    // so several wireless controllers can play at once without colliding
    const ctx = {
      status: 0,
      port: { id: 'ble:' + (dev.id || dev.name || Math.random().toString(36).slice(2)), name: dev.name || 'BLE MIDI', ble: true },
    };
    const attach = async () => {
      const server = await dev.gatt.connect();
      const svc = await server.getPrimaryService(BLE_MIDI_SERVICE);
      const ch = await svc.getCharacteristic(BLE_MIDI_CHAR);
      await ch.startNotifications();
      ch.addEventListener('characteristicvaluechanged', (e) => parseBLE(e.target.value, ctx));
      onStatus && onStatus({ mode: 'gatt', connected: true, name: dev.name });
    };
    if (!bound.has(dev)) {
      bound.add(dev);
      dev.addEventListener('gattserverdisconnected', () => {
        onStatus && onStatus({ mode: 'gatt', connected: false, name: dev.name });
        let tries = 0;
        const retry = () => {
          if (dev.gatt.connected) return;
          attach().catch(() => { if (++tries < 8) setTimeout(retry, Math.min(1000 * 2 ** tries, 20000)); });
        };
        setTimeout(retry, 600);
      });
    }
    await attach();
    return dev;
  }

  // Direct BLE-MIDI GATT via the device chooser. Tries the standard MIDI service
  // first; some units (incl. SMK25V2) don't advertise it, so it falls back to
  // known name-prefixes, then accept-all.
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
    return attachDevice(dev, { onStatus });
  }

  // AUTO-RECONNECT — the reason you only ever pair once.
  // getDevices() returns controllers this app was already granted, so at boot we
  // silently re-open them with NO chooser and NO vendor control panel. If one is
  // out of range we watch for its advertisement and connect the moment it wakes.
  async function autoReconnect({ onStatus } = {}) {
    if (typeof navigator === 'undefined' || !navigator.bluetooth || !navigator.bluetooth.getDevices) {
      return { mode: 'unsupported', devices: 0 };
    }
    let devs = [];
    try { devs = await navigator.bluetooth.getDevices(); } catch (e) { return { mode: 'none', devices: 0 }; }
    if (!devs.length) return { mode: 'none', devices: 0 };
    let connected = 0;
    for (const dev of devs) {
      try {
        await attachDevice(dev, { onStatus });
        connected++;
      } catch (e) {
        // asleep / out of range — connect it the instant it advertises
        try {
          if (!bound.has(dev)) {
            dev.addEventListener('advertisementreceived', function once() {
              dev.removeEventListener('advertisementreceived', once);
              attachDevice(dev, { onStatus }).catch(() => {});
            });
          }
          if (dev.watchAdvertisements) await dev.watchAdvertisements();
        } catch (e2) { /* advertisement watching unavailable — user can tap 📶 */ }
      }
    }
    if (connected) onStatus && onStatus({ mode: 'gatt', connected: true, auto: true, count: connected });
    return { mode: connected ? 'gatt' : 'watching', devices: devs.length, connected };
  }

  return {
    start, listInputs, inputCount, connectBluetooth, connectBLE, autoReconnect,
    hasLiveData, access: () => access, _emit: emit,
  };
}
