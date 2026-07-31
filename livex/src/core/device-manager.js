// device-manager.js — display AND connect to ALL connected controllers at once.
//
// Web MIDI already hooks every input port; this groups those ports by PHYSICAL
// device (the SMK-25 exposes 3 IN ports → one board), identifies each, renders a
// schematic per device, and routes incoming events to the right board by port id.
//
// RESEARCH → FACE pipeline (the core of LIVEx):
//   connect → recall learned profile (instant) OR regex-classify + open a live
//   capability PROBE. Every MIDI event feeds the probe; when the window closes
//   the profile is refined (pads/keys/wheels/knobs discovered from what the
//   device actually sent), REMEMBERED for next time, and the schematic face is
//   RE-RENDERED to match. Sources with no port list (native Android bridge, BLE
//   GATT) get an AD-HOC board created from their very first event — so "plug in
//   and it draws itself" holds on every platform, not just desktop Web MIDI.
// Gamepads get their own board too. Departed devices are removed on hot-unplug.

import { renderSchematic, fitHint } from './schematic.js';
import { createRouter } from './router.js';
import { identifyDevice, identifyMidiInput, identifyGamepad, createProbe, setPadMapFromPresses } from './identify.js';
import { deviceSignature, CLASSES } from './profiles.js';
import { remember } from './devicecache.js';

const BLACK = new Set([1, 3, 6, 8, 10]);
const PROBE_MS = 4000;

export function createDeviceManager({ stage, litColor = '#4bd6c8', renderOpts = {}, onAction, onBoards, onFit } = {}) {
  const boards = new Map(); // signature -> board

  function makeContainer(sig, title) {
    const wrap = document.createElement('div');
    wrap.className = 'board'; wrap.dataset.sig = sig;
    const head = document.createElement('div'); head.className = 'board-h'; head.textContent = title || sig;
    const body = document.createElement('div'); body.className = 'board-b';
    wrap.appendChild(head); wrap.appendChild(body);
    stage.appendChild(wrap);
    return { wrap, body };
  }

  function renderBoard(b) {
    b.body.innerHTML = '';
    b.lastSvg = renderSchematic(b.profile, { ...renderOpts, startWhite: b.startWhite });
    b.body.appendChild(b.lastSvg);
    const head = b.wrap.querySelector('.board-h');
    if (head) head.textContent = b.profile.portName || b.profile.id || b.sig;
    // ARCHITECTURE rule: re-fit orientation/scale on EVERY new input — a wide
    // 61/88-key board wants landscape, a compact pad bank fits portrait. CSS does
    // the scaling; this publishes the hint and locks rotation where supported.
    b.fit = fitHint(b.lastSvg);
    b.wrap.dataset.fit = b.fit.orientation;
    if (onFit) onFit(b.fit, b);
    if (!b.router) {
      b.router = createRouter({
        container: b.body, litColor, profile: b.profile,
        onWindow: (note) => followWindow(b, note),
        onAction: (a) => onAction && onAction(b, a),
      });
      b.router.wire();
    }
  }

  function followWindow(b, note) {
    const kb = b.lastSvg && b.lastSvg.__keyboard;
    if (!kb || !kb.windowed || !b.profile.keys) return;
    const f = b.profile.keys.firstNote; let wi = 0;
    for (let n = f; n < note; n++) if (!BLACK.has(n % 12)) wi++;
    b.startWhite = Math.max(0, Math.min(wi - Math.floor(kb.visibleWhites / 2), kb.whiteTotal - kb.visibleWhites));
    renderBoard(b);
  }

  // Open a probe window on a board: every event refines the face; on close the
  // (upgraded) profile is persisted so next plug-in identifies instantly.
  function armProbe(b, inputLike) {
    b.probe = createProbe(b.profile, {});
    b.probeSnap = JSON.stringify(strip(b.profile));
    if (b.probeTimer) clearTimeout(b.probeTimer);
    b.probeTimer = setTimeout(async () => {
      b.probeTimer = null;
      probeApply(b);                                   // final refinement
      try { await remember(inputLike || { name: b.profile.portName }, b.profile); } catch (e) {}
      b.probe = null;
    }, PROBE_MS);
  }
  // Fold observations in and redraw only when the face actually changed. Called
  // live (debounced) so an unrecognised controller stops looking like a blank
  // control surface within a second of being played, instead of after the whole
  // probe window has elapsed.
  function probeApply(b) {
    if (!b.probe) return;
    b.probe.refine();
    const now = JSON.stringify(strip(b.profile));
    if (now !== b.probeSnap) { b.probeSnap = now; renderBoard(b); }
  }
  function probeFeed(b, ev) {
    if (!b.probe) return;
    b.probe.feed(ev.status, ev.d1, ev.d2);
    if (b.liveTimer) return;
    b.liveTimer = setTimeout(() => { b.liveTimer = null; probeApply(b); }, 300);
  }
  const strip = (p) => ({ c: p.class, k: p.keys, pd: p.pads, w: p.wheels, kn: p.knobs });

  function addBoard(sig, profile, portIds, live = true) {
    const { wrap, body } = makeContainer(sig, profile.portName || profile.id);
    const b = { sig, profile, wrap, body, router: null, startWhite: 0, ports: new Set(portIds || []), live, probe: null, probeTimer: null };
    renderBoard(b);
    boards.set(sig, b);
    onBoards && onBoards(boards);
    return b;
  }

  // Called on Web MIDI port changes — connect + display ALL devices, one board
  // per physical device (ports coalesced by signature).
  async function syncPorts(inputs) {
    const bySig = new Map();
    for (const inp of inputs) {
      const sig = deviceSignature(inp.name, inp.manufacturer);
      if (!bySig.has(sig)) bySig.set(sig, []);
      bySig.get(sig).push(inp);
    }
    for (const [sig, ports] of bySig) {
      if (boards.has(sig)) { boards.get(sig).ports = new Set(ports.map((p) => p.id)); continue; }
      const { profile, learned } = await identifyDevice(ports[0]);
      profile.portName = ports[0].name;
      const b = addBoard(sig, profile, ports.map((p) => p.id));
      if (!learned) armProbe(b, ports[0]); // open the research window on first meeting
    }
    // remove live devices that unplugged (leave demo + adhoc + gamepad boards alone)
    for (const sig of [...boards.keys()]) {
      const b = boards.get(sig);
      if (b.live && !b.adhoc && b.profile.class !== CLASSES.GAMEPAD && !bySig.has(sig)) {
        if (b.probeTimer) clearTimeout(b.probeTimer);
        if (b.liveTimer) clearTimeout(b.liveTimer);
        b.wrap.remove(); boards.delete(sig);
        onBoards && onBoards(boards);
      }
    }
  }

  // Sources without a port list (native Android bridge / BLE GATT): first event
  // creates the board, the probe fleshes out the face from the live stream.
  function ensureAdhocBoard(ev) {
    const name = (ev.port && ev.port.name) || 'MIDI DEVICE';
    const sig = 'adhoc:' + deviceSignature(name);
    let b = boards.get(sig);
    if (!b) {
      const profile = identifyMidiInput({ name });
      profile.portName = name;
      profile.source = ev.port && ev.port.ble ? 'ble' : (ev.port && ev.port.native ? 'midi' : profile.source);
      b = addBoard(sig, profile, [ev.port && ev.port.id].filter(Boolean));
      b.adhoc = true;
      armProbe(b, { name });
    }
    return b;
  }

  // A board built before its device had a name — the Android bridge can deliver
  // bytes a beat before the device list, and BLE controllers often report no name
  // at first — would otherwise stay an unidentified 4-pad control surface forever,
  // because identification only ran at creation. So when a real name turns up later
  // on a board that never got one, identify AGAIN and redraw, carrying across
  // whatever the probe has already learned about the grid.
  const GENERIC_NAME = /^(midi\s*device|midi|device|ble\s*midi|unknown)?$/i;
  function relabelBoard(b, name) {
    if (!name || GENERIC_NAME.test(String(name).trim())) return false;
    const cur = String(b.profile.portName || '');
    if (cur === name) return false;
    // only upgrade a board that is still unidentified — never overwrite a match
    if (b.profile.id && !GENERIC_NAME.test(cur.trim())) return false;
    const learned = b.profile.pads;
    const upgraded = identifyMidiInput({ name });
    upgraded.portName = name;
    upgraded.source = b.profile.source;
    // carry the learned grid across so nothing the device already taught us is lost
    if (learned && learned.learned && upgraded.pads) {
      upgraded.pads.notes = learned.notes;
      upgraded.pads.noteMap = learned.noteMap;
      upgraded.pads.learned = true;
    }
    b.profile = upgraded;
    if (b.probe) b.probe = createProbe(b.profile, {});
    b.router = null;                       // rebuilt by renderBoard against the new profile
    renderBoard(b);
    onBoards && onBoards(boards);
    return true;
  }

  // ---- TEACH THE PAD MAP ----------------------------------------------------
  // Auto-learn orders pads by ascending note. That is the usual convention but it
  // is ONLY a convention — a unit configured any other way ends up with pad 9
  // firing pad 13 on screen. This removes the guess entirely: press pad 1, 2,
  // 3 … and the grid binds to exactly what you pressed, in the order you pressed
  // it. Nothing is inferred, so nothing can be inferred wrong.
  let padTeach = null;   // { board, notes:[], onProgress, onDone }
  const nextPadCountLocal = (n) => [4, 8, 12, 16, 25, 32, 64].find((x) => n <= x) || 64;

  function beginPadMap({ onProgress, onDone } = {}) {
    padTeach = { board: null, notes: [], onProgress, onDone };
    return true;
  }
  function cancelPadMap() { const was = !!padTeach; padTeach = null; return was; }
  function padMapActive() { return !!padTeach; }

  // Returns true when the event was consumed by teaching (so it must not play).
  function teachFeed(b, ev) {
    if (!padTeach) return false;
    const cmd = ev.status & 0xf0;
    const isNoteOn = cmd === 0x90 && ev.d2 > 0;
    const isNoteOff = cmd === 0x80 || (cmd === 0x90 && ev.d2 === 0);
    if (!isNoteOn && !isNoteOff) return false;   // let CC/transport through as normal
    if (isNoteOff) return true;                  // swallow the matching release
    if (!padTeach.board) padTeach.board = b;
    else if (padTeach.board !== b) return true;  // ignore other controllers mid-teach
    if (padTeach.notes.indexOf(ev.d1) >= 0) return true;  // double-hit on the same pad
    padTeach.notes.push(ev.d1);
    const total = (b.profile.pads && b.profile.pads.count) || 16;
    padTeach.onProgress && padTeach.onProgress(padTeach.notes.length, total, ev.d1);
    if (padTeach.notes.length >= total) finishPadMap();
    return true;
  }

  function finishPadMap() {
    if (!padTeach || !padTeach.board || !padTeach.notes.length) { padTeach = null; return; }
    const b = padTeach.board, notes = padTeach.notes, done = padTeach.onDone;
    padTeach = null;
    if (!b.profile.pads) {
      b.profile.pads = { count: nextPadCountLocal(notes.length), layout: null, channel: 10 };
    }
    setPadMapFromPresses(b.profile.pads, notes);
    if (b.probeTimer) { clearTimeout(b.probeTimer); b.probeTimer = null; }
    b.probe = null;                              // a taught map supersedes inference
    renderBoard(b);
    remember({ name: b.profile.portName }, b.profile).catch(() => {});
    done && done(b, notes);
  }

  // Route a normalized MIDI event to the board owning its port; unknown ports from
  // the native/BLE bridges materialize their own board on the first event.
  function routeMidi(ev) {
    const pid = ev.port && ev.port.id;
    if (pid) {
      for (const b of boards.values()) {
        if (b.ports.has(pid)) {
          if (ev.port.name) relabelBoard(b, ev.port.name);
          if (teachFeed(b, ev)) return;
          probeFeed(b, ev);
          b.router.handleMidi(ev);
          return;
        }
      }
    }
    if (ev.port && (ev.port.native || ev.port.ble)) {
      const b = ensureAdhocBoard(ev);
      if (ev.port.name) relabelBoard(b, ev.port.name);
      if (teachFeed(b, ev)) return;
      probeFeed(b, ev);
      b.router.handleMidi(ev);
      return;
    }
    // truly unknown origin — broadcast (keeps demo boards playable from tests)
    for (const b of boards.values()) {
      if (teachFeed(b, ev)) return;
      probeFeed(b, ev);
      b.router.handleMidi(ev);
    }
  }

  // ---- gamepads: their own boards + targeted routing ----
  function addGamepadBoard(gp) {
    const sig = 'gp:' + (gp.index != null ? gp.index : 0);
    if (boards.has(sig)) return boards.get(sig);
    const profile = identifyGamepad(gp);
    const b = addBoard(sig, profile, [sig]);
    b.gamepad = true;
    return b;
  }
  function removeGamepadBoard(gp) {
    const sig = 'gp:' + (gp.index != null ? gp.index : 0);
    const b = boards.get(sig);
    if (b) { b.wrap.remove(); boards.delete(sig); onBoards && onBoards(boards); }
  }
  function routeGamepad(i, gp) {
    if (gp) addGamepadBoard(gp); // first press materializes the board
    let hit = false;
    for (const b of boards.values()) if (b.gamepad) { b.router.handleGamepadButton(i); hit = true; }
    if (!hit) for (const b of boards.values()) b.router.handleGamepadButton(i);
  }

  // preview helper (no hardware): add a board with a synthetic port id
  function addDemoBoard(profile, portId) {
    const sig = 'demo:' + (profile.id || String(boards.size));
    return addBoard(sig, profile, [portId || sig], false);
  }
  function clear() {
    for (const b of boards.values()) { if (b.probeTimer) clearTimeout(b.probeTimer); if (b.liveTimer) clearTimeout(b.liveTimer); b.wrap.remove(); }
    boards.clear();
    onBoards && onBoards(boards);
  }

  return {
    syncPorts, routeMidi, routeGamepad, addGamepadBoard, removeGamepadBoard,
    addDemoBoard, clear, boards, renderBoard,
    beginPadMap, cancelPadMap, padMapActive, finishPadMap,
  };
}
