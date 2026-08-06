// menu.js — the drop-down, and nothing else.
//
// This file knows how to put a list of choices on screen at a point, let you
// pick one with a finger or a keyboard, and get out of the way. It knows
// NOTHING about pads, sounds, patterns or the library. Everything specific
// arrives as data, which is what makes a menu modular in the only sense that
// matters: adding an entry somewhere is adding a row to a table, not editing
// this file.
//
// An item is:
//   { label, hint, run, items, disabled, danger, on }
// `items` (or a function returning them) makes it a submenu. `run` makes it a
// command. Neither makes it a heading.
//
// WHAT THIS HAS TO GET RIGHT, because a menu that gets any of it wrong is worse
// than no menu:
//   · it must never open off-screen — it flips and clamps
//   · it must close on absolutely everything: Escape, a click anywhere else,
//     scrolling, resizing, the app moving underneath it
//   · it must be operable by keyboard, because it is a list of commands and
//     that is what lists of commands are for
//   · it must not leave a stale copy behind if opened twice in a row

let openEl = null, closeFn = null;

export function closeMenu() {
  if (closeFn) closeFn();
}

export function menuOpen() { return !!openEl; }

// A long press that is not a drag. Touch has no right-click, so this is the
// only gesture available — and it has to tell a deliberate hold apart from a
// scroll that happened to start slowly, or the menu fires while someone is
// trying to swipe. Movement cancels it; that is the whole distinction.
export function onLongPress(el, ms, fn) {
  let timer = 0, sx = 0, sy = 0, id = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = 0; } id = null; };
  el.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;          // mouse has a real menu button
    cancel();
    id = ev.pointerId; sx = ev.clientX; sy = ev.clientY;
    timer = setTimeout(() => {
      timer = 0;
      fn(ev, sx, sy);
    }, ms);
  });
  el.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== id || !timer) return;
    if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cancel();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((e) =>
    el.addEventListener(e, cancel));
  return cancel;
}

function resolve(v) { return typeof v === 'function' ? v() : v; }

export function openMenu({ x, y, items, title, onClose }) {
  closeMenu();

  const root = document.createElement('div');
  root.className = 'menu';
  root.setAttribute('role', 'menu');
  if (title) root.setAttribute('aria-label', title);

  const stack = [];                                  // open submenus, innermost last

  function build(list, host) {
    host.innerHTML = '';
    resolve(list).forEach((it) => {
      if (!it) return;
      if (it.sep) { host.appendChild(document.createElement('hr')).className = 'msep'; return; }
      if (it.head) {
        const h = document.createElement('div');
        h.className = 'mhead'; h.textContent = it.head;
        host.appendChild(h);
        return;
      }
      const b = document.createElement('button');
      b.className = 'mitem' + (it.danger ? ' danger' : '') + (it.on ? ' on' : '');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (it.disabled) b.disabled = true;
      b.innerHTML = '<span class="ml"></span>' +
        (it.hint ? '<span class="mh"></span>' : '') +
        (it.items ? '<span class="mx">›</span>' : '');
      b.querySelector('.ml').textContent = it.label;
      if (it.hint) b.querySelector('.mh').textContent = it.hint;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (it.disabled) return;
        if (it.items) { push(it); return; }
        // Close FIRST, then act. An action that opens a window or moves the
        // view would otherwise have the menu still sitting on top of it.
        closeMenu();
        if (it.run) it.run();
      });
      host.appendChild(b);
    });
  }

  // Submenus are a REPLACEMENT panel with a way back, not a second floating
  // box beside the first. Nested panels need somewhere to go, and on a phone
  // held in one hand there is nowhere for them to go.
  function push(it) {
    stack.push(it);
    render();
  }
  function pop() { stack.pop(); render(); }

  function render() {
    const cur = stack[stack.length - 1];
    root.innerHTML = '';
    if (cur) {
      const back = document.createElement('button');
      back.className = 'mitem back'; back.type = 'button';
      back.innerHTML = '<span class="ml"></span>';
      back.querySelector('.ml').textContent = '‹ ' + cur.label;
      back.addEventListener('click', (ev) => { ev.stopPropagation(); pop(); });
      root.appendChild(back);
      const body = document.createElement('div');
      root.appendChild(body);
      build(cur.items, body);
    } else {
      const body = document.createElement('div');
      root.appendChild(body);
      build(items, body);
    }
    place();
    const first = root.querySelector('.mitem:not(:disabled)');
    if (first) first.focus();
  }

  function place() {
    // Measured after it is in the document, because how tall a menu is depends
    // entirely on what is in it — and the whole point of placing it is to keep
    // it on screen.
    root.style.left = '0px'; root.style.top = '0px';
    // offsetWidth/offsetHeight, NOT getBoundingClientRect. The menu opens with
    // a scale transition, and getBoundingClientRect reports the TRANSFORMED
    // box — so measuring mid-animation returns a menu 3% smaller than the one
    // that will exist a moment later, and the clamp lands it about seven pixels
    // off the bottom-right corner. The layout box is the honest number.
    const w = root.offsetWidth, h = root.offsetHeight;
    const pad = 8;
    let px = x, py = y;
    if (px + w > innerWidth - pad) px = Math.max(pad, x - w);
    if (py + h > innerHeight - pad) py = Math.max(pad, innerHeight - h - pad);
    root.style.left = Math.max(pad, px) + 'px';
    root.style.top = Math.max(pad, py) + 'px';
  }

  document.body.appendChild(root);
  render();
  requestAnimationFrame(() => root.classList.add('open'));

  const away = (ev) => { if (!root.contains(ev.target)) closeMenu(); };
  const key = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeMenu(); return; }
    if (ev.key === 'ArrowLeft' && stack.length) { ev.preventDefault(); pop(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = [...root.querySelectorAll('.mitem:not(:disabled)')];
    if (!all.length) return;
    const i = all.indexOf(document.activeElement);
    const n = ev.key === 'ArrowDown' ? i + 1 : i - 1;
    all[(n + all.length) % all.length].focus();
  };

  // capture:true on the pointer listener, so a click lands on the menu's own
  // dismissal before it can reach whatever is underneath. Without it, closing
  // the menu by clicking a pad also PLAYS that pad.
  setTimeout(() => {
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
  }, 0);

  openEl = root;
  closeFn = () => {
    document.removeEventListener('pointerdown', away, true);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('resize', closeMenu);
    window.removeEventListener('blur', closeMenu);
    root.remove();
    openEl = null; closeFn = null;
    if (onClose) onClose();
  };
  return closeFn;
}
