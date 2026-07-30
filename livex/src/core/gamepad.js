// gamepad.js — Gamepad API polling with button edge-detection. Game controllers
// never appear as MIDI, so they get their own path (ported from SKRiMPAD gpLoop).

export function createGamepad({ onButton, onAxis, onConnect, onDisconnect } = {}) {
  let running = false;
  const prev = [];
  let raf = null;

  function poll() {
    if (!running) return;
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? [...navigator.getGamepads()] : [];
    const gp = pads.find((g) => g);
    if (gp) {
      gp.buttons.forEach((b, i) => {
        const was = prev[i];
        prev[i] = b.pressed;
        if (b.pressed && !was) onButton && onButton(i, gp);
      });
      if (onAxis && gp.axes) gp.axes.forEach((v, i) => { if (Math.abs(v) > 0.5) onAxis(i, v, gp); });
    }
    raf = requestAnimationFrame(poll);
  }

  function start() {
    if (running) return;
    running = true;
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => onConnect && onConnect(e.gamepad));
      window.addEventListener('gamepaddisconnected', (e) => onDisconnect && onDisconnect(e.gamepad));
    }
    poll();
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

  return { start, stop };
}
