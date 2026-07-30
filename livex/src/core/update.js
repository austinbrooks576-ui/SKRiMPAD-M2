// update.js — AUTO-UPDATE · FAIL-SAFE REVERT · GHOSTED UPDATE WINDOW.
// Ported from SKRiMPAD M2's proven engine (commit 8590e45) as an ES module.
//
// Auto-update ON (default) → the update card drives the installer directly.
// OFF → a low-profile "ghosted" card appears instead (like a sign-out-to-update
// button): translucent, dismissible, fades back, never blocks playing.
// A boot self-test records the last-known-good version and offers an automatic
// ROLL BACK if a new build repeatedly fails to start.
//
//   import { initUpdater } from './core/update.js';
//   const upd = initUpdater({ toast });          // wires everything
//   upd.check(true)                              // manual "check now"
//   upd.auto.get() / upd.auto.set(bool)          // the toggle

export function initUpdater({ toast, manifestUrl, checkEveryMs } = {}) {
  const VERSION = (typeof window !== 'undefined' && window.SKRIMPAD_VERSION) || '1.0.0';
  const EDITION = (typeof window !== 'undefined' && window.SKRIMPAD_EDITION) || 'livex';
  const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '');
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
  const platform = isElectron ? 'win' : (isAndroid ? 'apk' : 'web');
  const MANIFEST_URL = manifestUrl || (typeof window !== 'undefined' && window.SKRIMPAD_UPDATE_URL) || 'https://scrimpad.ink/api/update.json';
  const CHECK_EVERY = checkEveryMs || 6 * 60 * 60 * 1000;
  const say = (m) => { try { toast ? toast(m) : console.info('[update]', m); } catch (e) {} };

  const L = {
    get auto() { try { return localStorage.getItem('skrimpad_autoupdate') !== '0'; } catch (e) { return true; } },
    set auto(v) { try { localStorage.setItem('skrimpad_autoupdate', v ? '1' : '0'); } catch (e) {} },
    get good() { try { return localStorage.getItem('skrimpad_last_good') || VERSION; } catch (e) { return VERSION; } },
    set good(v) { try { localStorage.setItem('skrimpad_last_good', v); } catch (e) {} },
  };
  const newer = (a, b) => {
    const pa = String(a).split('.').map((n) => parseInt(n) || 0), pb = String(b).split('.').map((n) => parseInt(n) || 0);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
    return false;
  };

  // ---- GHOSTED WINDOW ------------------------------------------------------
  function ghost(o, urgent) {
    const old = document.getElementById('skrimpad-ghost'); if (old) old.remove();
    const g = document.createElement('div'); g.id = 'skrimpad-ghost';
    g.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;max-width:300px;padding:14px 16px;' +
      'border-radius:14px;font-family:system-ui,-apple-system,sans-serif;color:#eaf2ff;' +
      'background:rgba(14,16,26,' + (urgent ? '0.93' : '0.60') + ');-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);' +
      'border:1px solid rgba(' + (urgent ? '255,90,90' : '75,214,200') + ',0.5);box-shadow:0 12px 44px rgba(0,0,0,0.55);' +
      'opacity:0;transform:translateY(8px);transition:opacity .25s,transform .25s;';
    g.innerHTML = '<div style="font-size:13px;font-weight:700;margin-bottom:5px">' + o.title + '</div>' +
      '<div style="font-size:12px;opacity:.85;line-height:1.4;margin-bottom:10px">' + o.msg + '</div>' +
      '<div style="display:flex;gap:8px"><button id="sg-go" style="flex:1;padding:7px;border-radius:8px;border:0;cursor:pointer;' +
      'background:' + (urgent ? '#ff5a5a' : '#4bd6c8') + ';color:#0a0713;font-weight:700;font-size:12px">' + o.action + '</button>' +
      '<button id="sg-x" style="padding:7px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#cdd;cursor:pointer;font-size:12px">Later</button></div>';
    (document.body || document.documentElement).appendChild(g);
    requestAnimationFrame(() => { g.style.opacity = '1'; g.style.transform = 'translateY(0)'; });
    g.querySelector('#sg-go').onclick = () => { try { o.onAction && o.onAction(); } catch (e) {} };
    g.querySelector('#sg-x').onclick = () => { g.style.opacity = '0'; setTimeout(() => g.remove(), 250); };
    if (!urgent) setTimeout(() => { if (document.body.contains(g)) g.style.opacity = '0.5'; }, 12000); // fades ghosted
    return g;
  }

  // ---- FAIL-SAFE BOOT GUARD -----------------------------------------------
  function guardStart() {
    try {
      const p = JSON.parse(localStorage.getItem('skrimpad_boot_pending') || 'null');
      if (p && p.v === VERSION && (p.count || 0) >= 2 && L.good && L.good !== VERSION) {
        ghost({ title: '⚠ Update unstable', msg: 'v' + VERSION + ' failed to start cleanly. Roll back to v' + L.good + '?',
          action: 'Roll back', onAction: () => revert(L.good) }, true);
      }
      const count = (p && p.v === VERSION) ? (p.count || 0) + 1 : 1;
      localStorage.setItem('skrimpad_boot_pending', JSON.stringify({ v: VERSION, count, ts: Date.now() }));
    } catch (e) {}
  }
  function guardHealthy() { try { localStorage.removeItem('skrimpad_boot_pending'); L.good = VERSION; } catch (e) {} }
  function revert(good) {
    if (isElectron && window.skrimpadUpdater && window.skrimpadUpdater.revert) { window.skrimpadUpdater.revert(good); return; }
    try { localStorage.removeItem('skrimpad_boot_pending'); } catch (e) {}
    say('Rolling back to v' + good + '…');
    location.reload(); // web/APK: clear the bad-boot loop; binary swap is the installer's job
  }

  // ---- UPDATE CHECK --------------------------------------------------------
  async function check(manual) {
    let m;
    try { const r = await fetch(MANIFEST_URL, { cache: 'no-store' }); if (!r.ok) throw 0; m = await r.json(); }
    catch (e) { if (manual) say('Update check failed — offline?'); return; }
    if (!m || !m.version) return;
    if (!newer(m.version, VERSION)) { if (manual) say('✓ You’re on the latest — v' + VERSION); return; }
    const ed = (m.downloads && m.downloads[EDITION]) || {};
    const dl = ed[platform] || ed.win || ed.apk || '';
    const mandatory = !!m.mandatory;
    if (isElectron && window.skrimpadUpdater && window.skrimpadUpdater.check) {
      window.skrimpadUpdater.check(); // native updater downloads + stages
      if (!L.auto && !mandatory) ghost({ title: '✨ v' + m.version + ' available', msg: m.notes || 'Update when you’re ready.', action: 'Update', onAction: () => window.skrimpadUpdater.check() }, false);
      return;
    }
    if (L.auto || mandatory) {
      ghost({ title: '⬇ Update v' + m.version, msg: (m.notes || 'A new version is ready.') + (mandatory ? ' (required)' : ''),
        action: 'Install', onAction: () => { if (dl) window.open(dl, '_blank'); } }, mandatory);
    } else {
      ghost({ title: '✨ v' + m.version + ' available', msg: m.notes || 'Update when you’re ready.',
        action: 'Update', onAction: () => { if (dl) window.open(dl, '_blank'); } }, false);
    }
  }

  // native updater push events (Electron main → renderer, via preload bridge)
  if (isElectron && window.skrimpadUpdater && window.skrimpadUpdater.on) {
    window.skrimpadUpdater.on((evt, info) => {
      if (evt === 'available' && !L.auto) ghost({ title: '✨ v' + ((info && info.version) || 'new') + ' available', msg: 'Update when you’re ready.', action: 'Update', onAction: () => window.skrimpadUpdater.check() }, false);
      if (evt === 'downloaded') ghost({ title: '✅ Update ready', msg: 'v' + ((info && info.version) || '') + ' installs on restart.', action: 'Restart now', onAction: () => window.skrimpadUpdater.install() }, false);
    });
  }

  // ---- WIRE UP -------------------------------------------------------------
  guardStart();
  setTimeout(guardHealthy, 8000); // app survived 8s of runtime → this build is good
  setTimeout(() => check(false), 5000);
  setInterval(() => check(false), CHECK_EVERY);

  const api = {
    check, ghost, version: VERSION, edition: EDITION, platform,
    auto: { get: () => L.auto, set: (v) => { L.auto = v; say('Auto-update ' + (v ? 'on' : 'off')); } },
  };
  if (typeof window !== 'undefined') {
    window.skrimpadCheckUpdate = check;
    window.skrimpadAutoUpdate = api.auto;
    window.SKRIMPAD_INFO = { version: VERSION, edition: EDITION, platform };
  }
  console.info('[LIVEx] auto-update ready · v' + VERSION + ' · ' + EDITION + '/' + platform);
  return api;
}
