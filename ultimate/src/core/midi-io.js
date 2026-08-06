// midi-io.js — one input surface for Web MIDI, BLE-MIDI (Web Bluetooth), and the
// native Android bridge. Normalizes everything to {status,d1,d2,cmd,chan,port}.
// Ported from SKRiMPAD M2's proven handlers (hot-plug + BLE running-status parse).

import { BLE_MIDI_SERVICE, BLE_MIDI_CHAR, createBleDecoder, looksLikeMidiName } from './ble-midi.js';

export function createMidiIO({ onEvent, onPorts, onGone } = {}) {
  let access = null;
  let bleStatus = 0; // BLE running-status latch

  // WHY THIS RECORDS ITS OWN STATE.
  // "no controller yet" was the app's answer to four completely different
  // situations: Web MIDI missing entirely, access refused, access granted but
  // zero ports, and — the one that actually bites on Windows — a port that
  // exists and has never sent a single byte because the vendor's panel has not
  // been told to connect it. Those need four different things done about them,
  // and the app said the same sentence for all four. Nobody can act on that.
  const diag = { mode: 'starting', err: '', tried: 0, sysex: false,
                 inputs: 0, outputs: 0, bytes: 0, at: 0, ble: 0, auto: '', lost: '' };
  let bleName = 'BLE MIDI'; // set on GATT connect so the board titles correctly

  // Has any real MIDI byte ever arrived? This distinguishes a LIVE port from a
  // bridged-but-SILENT one — on Windows the KORG BLE-MIDI driver publishes a port
  // the moment the controller is paired, but it stays mute until you press
  // CONNECT in the KORG panel. Trusting the port's mere existence is what left
  // people staring at a dead keyboard.
  let lastDataAt = 0;
  // PER PORT, not just globally. "Is a port live?" decides whether we leave a
  // bridged controller alone or take it over via GATT, and one global flag
  // answers that question for the wrong port the moment there are two: a live
  // USB keyboard would vouch for a mute KORG bridge sitting beside it, and the
  // Bluetooth takeover that fixes the mute one would never run.
  const liveAt = new Map();
  const portKey = (p) => (p && (p.id || p.name)) || 'unknown';
  const emit = (data, port) => {
    if (!data || data.length < 1) return;
    const [status, d1 = 0, d2 = 0] = data;
    if (status < 0x80) return;   // stray data byte

    // Only the FLOOD is noise: clock at 24 ppqn, active sensing several times a
    // second, reset, and the undefined slots. Everything else at 0xF0+ is real
    // control data — dropping the lot also threw away the transport messages the
    // PLAY / STOP / REC buttons send, which is why they never did anything.
    if (status === 0xf8 || status === 0xf9 || status === 0xfd || status === 0xfe || status === 0xff) return;

    const fire = (e) => { lastDataAt = Date.now(); liveAt.set(portKey(port), lastDataAt); diag.bytes++; diag.at = lastDataAt; onEvent && onEvent(Object.assign({ status, d1, d2, cmd: status & 0xf0, chan: status & 0x0f, port, raw: data }, e)); };

    // System Real-Time transport: Start / Continue / Stop
    if (status === 0xfa || status === 0xfb) { fire({ transport: 'play' }); return; }
    if (status === 0xfc) { fire({ transport: 'stop' }); return; }

    // MMC over SysEx — how most transport buttons actually report:
    //   F0 7F <dev> 06 <cmd> F7   ·  01 stop · 02 play · 03 deferred play · 06 record
    if (status === 0xf0) {
      if (data.length >= 5 && data[1] === 0x7f && data[3] === 0x06) {
        const c = data[4];
        const name = c === 0x01 ? 'stop' : (c === 0x02 || c === 0x03) ? 'play' : (c === 0x06 || c === 0x07) ? 'rec' : null;
        if (name) fire({ transport: name });
      }
      return;
    }
    if (status >= 0xf1 && status <= 0xf7) return;   // other System Common: not playable

    fire();
  };
  const hasLiveData = () => lastDataAt > 0;
  // Has THIS port ever sent a byte? A port that exists and has never spoken is
  // the Windows KORG trap: the driver publishes it the moment the controller is
  // paired and it stays mute until you press CONNECT in the vendor panel.
  const portLive = (p) => (liveAt.get(portKey(p)) || 0) > 0;
  const liveInputs = () => listInputs().filter(portLive);

  // A controller has gone — unplugged, switched off, out of range, asleep. Its
  // note-offs are never coming, so anything it was holding would ring until
  // PANIC. This is the single most common way a wireless keyboard ruins a take,
  // and nothing was listening for it.
  const gone = (port, why) => {
    if (!port) return;
    liveAt.delete(portKey(port));
    diag.lost = (port.name || 'a controller') + ' — ' + (why || 'disconnected');
    onGone && onGone(port, why);
  };

  // RAW BLE packets from our own Android GATT stack. They go through the very
  // same decoder the desktop Web Bluetooth path uses — one implementation of
  // the BLE-MIDI packet format for every platform, with per-device state so
  // several wireless controllers can play at once.
  const bleCtx = new Map();
// The device list from the native bridge. Reported as ports so the SAME
  // board-building path runs as on desktop — a controller that is plugged in
  // but not yet played still draws itself.
  window.onNativeMIDIDevices = (list) => {
    // `props` is every property Android holds for the device. It is not used for
    // matching — it exists so the in-app MIDI monitor can show ground truth when
    // a controller still fails to identify.
    nativeDevices = (list || []).map((d) => ({
      id: d.id, name: d.name, manufacturer: d.manufacturer || '', props: d.props || '',
    }));
    if (nativeDevices.length && typeof nativeName !== 'undefined') { try { nativeName = nativeDevices[0].name; } catch (e) {} }
    onPorts && onPorts(nativeDevices);
  };

    window.onNativeBLEPackets = (packets, addr, name) => {
    if (!packets || !packets.length) return;
    let ctx = bleCtx.get(addr);
    if (!ctx) {
      ctx = { port: { id: 'ble:' + addr, name: name || 'BLE MIDI', ble: true } };
      ctx.decode = createBleDecoder((msg) => emit(msg, ctx.port));
      bleCtx.set(addr, ctx);
    }
    for (let i = 0; i < packets.length; i++) ctx.decode(Uint8Array.from(packets[i]));
  };

  // NATIVE MIDI hooks — registered UNCONDITIONALLY, not inside the
  // `if (window.AndroidMidi)` branch of _start(). MainActivity.kt calls these
  // exact globals; if the bridge is injected even a moment after boot (a WebView
  // reload, a late addJavascriptInterface), a branch-scoped registration means
  // the globals never exist and the APK hears nothing at all. Defining them up
  // front costs nothing on desktop and removes the whole failure mode.
  let nativeName = 'MIDI DEVICE';
  // The bridge tells us WHICH device a batch came from. That identity is what
  // joins the incoming bytes to the named device published by the device list —
  // without it every packet landed on one synthetic "MIDI DEVICE" port, so the
  // named board received nothing and a nameless one owned all the traffic.
  const nativePort = (id, name) => ({
    id: id || 'native',
    name: name || nativeName,
    native: true,
  });
  window.onNativeMIDIMessage = (bytes, id, name) => emit(Array.from(bytes), nativePort(id, name));
  // batched form — the bridge coalesces a frame's worth of packets into one call
  // so a chatty controller can't flood the WebView
  window.onNativeMIDIBatch = (list, id, name) => {
    if (!list || !list.length) return;
    const p = nativePort(id, name);
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

  let nativeDevices = [];   // devices reported by the Android bridge
  let nativeMode = false;
  function listInputs() {
    if (access) return [...access.inputs.values()];
    return nativeDevices;
  }

  // --- Web MIDI (desktop Electron / Chrome) with hot-plug -------------------
  // Memoized: the app calls start() at boot, so a later connectBluetooth() never
  // re-requests access — its `await start()` resolves on an already-settled
  // promise (a single microtask), keeping the click's transient user activation
  // alive for requestDevice(). Losing that activation is exactly what broke
  // Bluetooth in SKRiMPAD M2.
  let startPromise = null;
  // Memoising start() forever was the bug that made a controller "not register".
  // The Android bridge is injected by the WebView AFTER this module runs, so if
  // start() happened to be called first, the native branch was skipped and the
  // {mode:'none'} result was cached for the life of the app. Only a run that
  // actually FOUND a path is worth keeping; anything else must be retryable.
  function start() {
    if (startPromise) return startPromise;
    startPromise = _start().then((r) => {
      if (!r || r.mode === 'none') startPromise = null;   // nothing found — stay retryable
      return r;
    }, (e) => { startPromise = null; throw e; });
    return startPromise;
  }

  // Keep asking until something answers. Android enumerates USB-OTG and BLE
  // endpoints asynchronously and the list is routinely empty for the first few
  // seconds, so a single look is not a connection attempt — it is a coin flip.
  let sweepTimer = 0, sweeps = 0, sweeping = false;
  function sweep() {
    if (typeof window !== 'undefined' && window.AndroidMidi) {
      nativeMode = true;
      try { window.AndroidMidi.enable(); } catch (e) {}
      try { window.AndroidMidi.scanBluetooth && window.AndroidMidi.scanBluetooth(); } catch (e) {}
    }
    // Re-assert handlers every sweep: a port that appeared between sweeps is
    // otherwise sitting there with nothing listening to it.
    if (access) { try { access.inputs.forEach((inp) => { inp.onmidimessage = (e) => emit(e.data, inp); }); } catch (e) {} }
    start().catch(() => {});
    onPorts && onPorts(listInputs());
  }
  function keepLooking() {
    if (sweeping) return;
    sweeping = true;
    const tick = () => {
      sweeps++;
      sweep();
      const found = inputCount() > 0 || (typeof window !== 'undefined' && window.AndroidMidi);
      // ease off once something is attached, but never stop entirely — unplugging
      // and re-plugging has to be noticed too
      const wait = found ? 8000 : Math.min(1200 * Math.pow(1.6, Math.min(sweeps, 6)), 12000);
      clearTimeout(sweepTimer); sweepTimer = setTimeout(tick, wait);
    };
    tick();
  }
  // Coming back to the app is the strongest possible signal that the user just
  // paired a controller in system Bluetooth settings. Re-scan on the spot.
  function rescan() { sweeps = 0; sweep(); }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) rescan(); });
  }
  if (typeof window !== 'undefined') window.addEventListener('focus', () => rescan());

  async function _start() {
    // Android WebView has no Web MIDI → native bridge injects window.AndroidMidi.
    // The onNative* globals MainActivity.kt calls are registered above, outside
    // this branch, so they exist no matter when the bridge shows up. All that is
    // left here is turning the bridge on.
    if (typeof window !== 'undefined' && window.AndroidMidi) {
      nativeMode = true;
      try { window.AndroidMidi.enable(); } catch (e) {}
      try { window.AndroidMidi.scanBluetooth && window.AndroidMidi.scanBluetooth(); } catch (e) {}
      diag.mode = 'native';
      return { mode: 'native' };
    }
    diag.tried++;
    if ((typeof navigator === 'undefined' || !navigator.requestMIDIAccess)
        && !(typeof window !== 'undefined' && window.AndroidMidi)) {
      // Not transient: this build has no Web MIDI at all. Say so rather than
      // sweeping forever and reporting "no controller yet".
      diag.mode = 'unsupported';
      diag.err = 'navigator.requestMIDIAccess is not available in this build';
    }
    if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
      // SysEx MUST be requested: MMC (F0 7F .. 06 ..) is how most PLAY/STOP/REC
      // buttons report, and with sysex:false the browser silently drops it, so
      // those buttons could never work no matter what we did downstream.
      try {
        access = await navigator.requestMIDIAccess({ sysex: true });
        diag.sysex = true;
      } catch (e) {
        // Losing SysEx costs the MMC transport messages and nothing else, so it
        // is right to carry on without it — but it has to be RECORDED, because
        // "my transport buttons do nothing" and "sysex was refused" are the
        // same fact, and the app knew it all along.
        diag.sysex = false;
        diag.err = 'sysex refused: ' + ((e && e.message) || e);
        try {
          access = await navigator.requestMIDIAccess({ sysex: false });
        } catch (e2) {
          diag.mode = 'denied';
          diag.err = 'MIDI access refused: ' + ((e2 && e2.message) || e2);
          throw e2;
        }
      }
      const hook = () => access.inputs.forEach((inp) => { inp.onmidimessage = (e) => emit(e.data, inp); });
      hook();
      access.onstatechange = (ev) => {
        // A USB cable pulled out mid-chord is the wired version of a Bluetooth
        // drop: the note-offs are not coming. Release what that port was
        // holding before rebuilding the list.
        const p = ev && ev.port;
        if (p && p.type === 'input' && p.state === 'disconnected') gone(p, 'unplugged');
        hook(); onPorts && onPorts(listInputs());
      };
      onPorts && onPorts(listInputs());
      // Belt and braces: some Windows/driver combinations never fire
      // onstatechange, leaving a controller plugged in but invisible. Re-hook and
      // re-report whenever the set of ports actually changes.
      let seen = new Map([...access.inputs].map(([k, v]) => [k, v]));
      setInterval(() => {
        if (!access) return;
        const now = new Map([...access.inputs].map(([k, v]) => [k, v]));
        let changed = now.size !== seen.size;
        // Ports that were there and are not any more. onstatechange is supposed
        // to report these and on several Windows driver stacks simply does not,
        // which is the whole reason this poll exists — so the release has to
        // happen here too, or an unplug that the event missed leaves a note on.
        for (const [k, v] of seen) if (!now.has(k)) { changed = true; gone(v, 'unplugged'); }
        for (const k of now.keys()) if (!seen.has(k)) changed = true;
        seen = now;
        hook();                       // cheap: re-assert handlers either way
        if (changed) onPorts && onPorts(listInputs());
      }, 3000);
      diag.mode = 'webmidi';
      return { mode: 'webmidi', access };
    }
    return { mode: 'none' };
  }

  // --- BLE-MIDI via Web Bluetooth (desktop fallback / direct connect) -------
  // Every connected BLE controller gets its OWN port identity and its OWN
  // running-status latch. Sharing either one means a second wireless controller
  // lands on the first one's board and corrupts its running-status stream — so
  // only one BLE device could ever really work at a time.
  // Each device decodes with its OWN state (running status + any half-received
  // SysEx). Sharing that between controllers corrupts both streams, which is why
  // only one wireless device ever really worked before.
  function parseBLE(dv, ctx) {
    const bytes = new Uint8Array(dv.buffer || dv);
    if (!ctx.decode) ctx.decode = createBleDecoder((msg) => emit(msg, ctx.port));
    ctx.decode(bytes);
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
    // PER PORT. The question is not "has any MIDI arrived" but "is every port we
    // can see actually carrying data" — a live USB keyboard next to a mute KORG
    // bridge used to vouch for the bridge, so the takeover that fixes the mute
    // one never ran and the wireless controller stayed dead with a green light.
    const liveN = liveInputs().length;
    if (n > 0 && liveN >= n) {
      onStatus && onStatus({ mode: 'port', count: n, hint: n + ' MIDI port(s) connected and live.' });
      return { mode: 'port', count: n };
    }
    // No ports, or ports that have never made a sound: connect it ourselves.
    if (typeof navigator !== 'undefined' && navigator.bluetooth) {
      if (n > 0) {
        const mute = listInputs().filter((p) => !portLive(p)).map((p) => p.name || '?');
        onStatus && onStatus({ mode: 'silent-port', count: n, silent: mute,
          hint: (mute.length === 1 ? mute[0] + ' exists but has sent nothing'
                                   : mute.length + ' MIDI ports exist but have sent nothing')
                + ' — connecting over Bluetooth directly…' });
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

  // Name prefixes for the Bluetooth chooser, used only when a controller does
  // not advertise the standard BLE-MIDI service — which is common, and is why
  // an accept-all fallback sits behind this.
  //
  // JamJum's pad controllers are here because they are Bluetooth-first: the
  // JP-1 and the JP mini are both 4x4 pad grids on BLE with no keybed, and a
  // real JP mini reports its OEM rather than its product ("KUWEE Technology
  // JP-Mini"), so the maker name has to be matched as well or the unit never
  // appears in the chooser at all.
  const KNOWN = ['SMK', 'SMK25', 'WORLDE', 'M-VAVE', 'MVAVE', 'M-WAVE', 'KORG',
                 'nanoKEY', 'microKEY', 'MPK', 'LPK', 'MPD', 'Launchkey',
                 'JamJum', 'JAM JUM', 'JP-1', 'JP1', 'JP-Mini', 'JP Mini', 'KUWEE'];
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
    // ONE handler per device, created once and reused. attach() runs again on
    // every reconnect, and addEventListener with a fresh arrow each time is
    // additive: after five reconnects every incoming packet was decoded five
    // times, so every note played five times, each one stealing the last. A
    // controller that drops a lot — which is every wireless controller — got
    // audibly worse the longer you used it.
    ctx.onValue = ctx.onValue || ((e) => parseBLE(e.target.value, ctx));
    const attach = async () => {
      const server = await dev.gatt.connect();
      const svc = await server.getPrimaryService(BLE_MIDI_SERVICE);
      const ch = await svc.getCharacteristic(BLE_MIDI_CHAR);
      await ch.startNotifications();
      // Remove from whatever we were subscribed to before — the same object on
      // a re-subscribe, a new one after a reconnect. Removing a listener that
      // was never added is a no-op, so this is safe on the first attach.
      if (ctx.char) { try { ctx.char.removeEventListener('characteristicvaluechanged', ctx.onValue); } catch (e) {} }
      ch.addEventListener('characteristicvaluechanged', ctx.onValue);
      ctx.char = ch;
      ctx.retrying = false;
      onStatus && onStatus({ mode: 'gatt', connected: true, name: dev.name });
    };
    if (!bound.has(dev)) {
      bound.add(dev);
      dev.addEventListener('gattserverdisconnected', () => {
        onStatus && onStatus({ mode: 'gatt', connected: false, name: dev.name });
        // Whatever it was holding is never getting a note-off. Release it here
        // rather than leaving a chord ringing over the next twenty minutes.
        gone(ctx.port, 'bluetooth link dropped');
        // ONE retry chain. A controller that flaps — and they all flap — used to
        // start a fresh chain on every disconnect, so a device that dropped six
        // times had six chains racing to reconnect it, each adding its own
        // backoff and its own listener.
        if (ctx.retrying) return;
        ctx.retrying = true;
        let tries = 0;
        const retry = () => {
          if (!ctx.retrying) return;
          if (dev.gatt && dev.gatt.connected) { ctx.retrying = false; return; }
          attach().catch(() => {
            if (++tries < 8) setTimeout(retry, Math.min(1000 * 2 ** tries, 20000));
            else ctx.retrying = false;
          });
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
      diag.auto = 'this build cannot reopen paired devices';
      return { mode: 'unsupported', devices: 0 };
    }
    let devs = [];
    try { devs = await navigator.bluetooth.getDevices(); }
    catch (e) { diag.auto = 'getDevices failed'; return { mode: 'none', devices: 0 }; }
    if (!devs.length) { diag.auto = 'nothing paired with this app yet'; return { mode: 'none', devices: 0 }; }
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
    diag.auto = connected + ' of ' + devs.length + ' reopened';
    if (connected) onStatus && onStatus({ mode: 'gatt', connected: true, auto: true, count: connected });
    return { mode: connected ? 'gatt' : 'watching', devices: devs.length, connected };
  }

  return {
    start, keepLooking, rescan, listInputs, inputCount, connectBluetooth, connectBLE, autoReconnect,
    hasLiveData, portLive, liveInputs, access: () => access, _emit: emit,
    // Test seam: pretend a port vanished, so the note-release path can be
    // exercised without unplugging real hardware.
    _gone: gone,
    // Everything the app knows about why MIDI is or is not working. Read by the
    // MIDI window, so a controller that will not connect produces a specific
    // sentence instead of a shrug.
    diagnostics() {
      const ins = listInputs();
      diag.inputs = ins.length;
      diag.outputs = access ? access.outputs.size : 0;
      diag.ble = bleCtx.size;
      return Object.assign({}, diag, {
        names: ins.map((p) => p.name || '?'),
        live: lastDataAt > 0,
        liveNames: liveInputs().map((p) => p.name || '?'),
        silentNames: listInputs().filter((p) => !portLive(p)).map((p) => p.name || '?'),
        webBluetooth: !!(typeof navigator !== 'undefined' && navigator.bluetooth),
        canReopen: !!(typeof navigator !== 'undefined' && navigator.bluetooth
                      && navigator.bluetooth.getDevices),
      });
    },
    // devices reported by the native bridge, with their raw Android properties —
    // read by the MIDI monitor so an unidentified controller can be diagnosed
    devices: () => nativeDevices,
  };
}
