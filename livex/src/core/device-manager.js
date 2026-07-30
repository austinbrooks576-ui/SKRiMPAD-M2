// device-manager.js — display AND connect to ALL connected controllers at once.
//
// Web MIDI already hooks every input port; this groups those ports by PHYSICAL
// device (the SMK-25 exposes 3 IN ports → one board), identifies each, renders a
// schematic per device, and routes incoming events to the right board by port id.
// Gamepads get their own board too. Departed devices are removed on hot-unplug.

import { renderSchematic } from './schematic.js';
import { createRouter } from './router.js';
import { identifyDevice } from './identify.js';
import { deviceSignature } from './profiles.js';

const BLACK = new Set([1, 3, 6, 8, 10]);

export function createDeviceManager({ stage, litColor = '#4bd6c8', renderOpts = {}, onAction } = {}) {
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
    if (!b.router) {
      b.router = createRouter({
        container: b.body, litColor,
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

  function addBoard(sig, profile, portIds, live = true) {
    const { wrap, body } = makeContainer(sig, profile.portName || profile.id);
    const b = { sig, profile, wrap, body, router: null, startWhite: 0, ports: new Set(portIds || []), live };
    renderBoard(b);
    boards.set(sig, b);
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
      const { profile } = await identifyDevice(ports[0]);
      profile.portName = ports[0].name;
      addBoard(sig, profile, ports.map((p) => p.id));
    }
    // remove live devices that unplugged (leave demo boards alone)
    for (const sig of [...boards.keys()]) {
      const b = boards.get(sig);
      if (b.live && !bySig.has(sig)) { b.wrap.remove(); boards.delete(sig); }
    }
  }

  // Route a normalized MIDI event to the board owning its port; broadcast when the
  // port is unknown (native bridge / BLE GATT emit a generic port).
  function routeMidi(ev) {
    const pid = ev.port && ev.port.id;
    if (pid) { for (const b of boards.values()) if (b.ports.has(pid)) { b.router.handleMidi(ev); return; } }
    for (const b of boards.values()) b.router.handleMidi(ev);
  }
  function routeGamepad(i) { for (const b of boards.values()) b.router.handleGamepadButton(i); }

  // preview helper (no hardware): add a board with a synthetic port id
  function addDemoBoard(profile, portId) {
    const sig = 'demo:' + (profile.id || String(boards.size));
    return addBoard(sig, profile, [portId || sig], false);
  }
  function clear() { for (const b of boards.values()) b.wrap.remove(); boards.clear(); }

  return { syncPorts, routeMidi, routeGamepad, addDemoBoard, clear, boards, renderBoard };
}
