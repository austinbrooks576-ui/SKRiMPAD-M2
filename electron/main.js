const { app, BrowserWindow, session, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// electron-updater is optional in dev (no dep installed) — guard the require so
// `npm start` still runs without it.
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }

const REPO_RELEASES = 'https://github.com/austinbrooks576-ui/SKRiMPAD-M2/releases';

// Audio must start clean and keep perfect time even when the window is
// minimized or covered — throttled timers let the sequencer fall behind the
// audio clock, and the catch-up burst on restore froze the app.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// WEB BLUETOOTH, THE PART THAT WAS MISSING.
// navigator.bluetooth.getDevices() — the call that lets an app silently reopen
// a controller it has already been granted — lives behind this feature flag.
// Without it the function is simply UNDEFINED, so the auto-reconnect path can
// never run on desktop and every session starts with the controller
// disconnected no matter how many times it has been paired before.
//
// The same backend is what makes a granted device PERSIST across restarts.
// Without it, "pair once" is not a thing that exists: every launch is a first
// launch, which is exactly what a Bluetooth controller that will not stay
// connected looks like from the outside.
app.commandLine.appendSwitch('enable-features', 'WebBluetoothNewPermissionsBackend');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'SKRiMPAD',
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
  });

  // F11 toggles fullscreen, Esc exits it
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    }
  });

  // Web Bluetooth needs a device chooser — without this handler
  // navigator.bluetooth.requestDevice() hangs and a Korg / BLE MIDI controller
  // never connects. The event fires repeatedly as devices are discovered, so we
  // WAIT for a MIDI-named controller rather than grabbing whatever appears first
  // (which was often a phone/headset). If none is named within a few seconds we
  // fall back to the first device found; if the list is still empty, cancel.
  const MIDI_RE = /midi|korg|nanokey|microkey|nanokontrol|nanopad|keystage|smk|worlde|akai|mpk|mpd|launchkey|launchpad|arturia|keystep|keylab|novation|seaboard|roli|yamaha|casio|donner|alesis|m-?wave|m-?audio|nektar|icon|jam\s?jum|jp-?1\b|jp-?mini|kuwee/i;
  let btCb = null, btDevs = [], btTimer = null;
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    btDevs = devices; btCb = callback;
    const midi = devices.find(d => MIDI_RE.test(d.deviceName || ''));
    if (midi) { if (btTimer) { clearTimeout(btTimer); btTimer = null; } btCb = null; callback(midi.deviceId); return; }
    // no MIDI-named device yet — keep scanning; take the first found after 8s
    if (btTimer) clearTimeout(btTimer);
    btTimer = setTimeout(() => {
      btTimer = null; if (!btCb) return;
      const cb = btCb; btCb = null;
      cb(btDevs[0] ? btDevs[0].deviceId : '');
    }, 8000);
  });

  const htmlPath = app.isPackaged
    ? path.join(process.resourcesPath, 'index.html')
    : path.join(__dirname, '../android/app/src/main/assets/index.html');

  win.loadFile(htmlPath);
  wireUpdater(win);
}

// ---- AUTO-UPDATE + FAIL-SAFE ROLLBACK --------------------------------------
// electron-updater pulls signed releases (latest.yml) from GitHub Releases,
// downloads in the background, and installs on quit. The renderer decides when
// to surface it (auto-update ON/OFF ghosted window) via the preload bridge.
function wireUpdater(win) {
  if (!autoUpdater) return;
  // Per-edition channel so the three editions in one repo never cross-serve:
  // an SE build only reads latest-se.yml, VGA latest-vga.yml, consumer latest.yml.
  try { const ch = require('./package.json').skrimpadChannel; if (ch) autoUpdater.channel = ch; } catch (e) {}
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = true;   // needed so a rollback to an older tag can install
  const send = (evt, info) => { if (win && !win.isDestroyed()) win.webContents.send('updater:event', evt, info); };
  autoUpdater.on('update-available', i => send('available', i));
  autoUpdater.on('update-not-available', i => send('none', i));
  autoUpdater.on('download-progress', p => send('progress', p));
  autoUpdater.on('update-downloaded', i => send('downloaded', i));
  autoUpdater.on('error', e => send('error', { message: String((e && e.message) || e) }));
  // one silent check shortly after launch
  setTimeout(() => { try { autoUpdater.checkForUpdates(); } catch (e) {} }, 4000);
}

ipcMain.handle('updater:check', () => { try { return autoUpdater && autoUpdater.checkForUpdates(); } catch (e) { return null; } });
ipcMain.handle('updater:install', () => { try { if (autoUpdater) autoUpdater.quitAndInstall(); } catch (e) {} });
ipcMain.handle('updater:revert', (_e, good) => {
  // Fail-safe rollback triggered when the renderer's boot self-test decides the
  // current build is bad. Prefer relaunching an archived good installer; else
  // open that version's release page so the stable build can be reinstalled.
  try {
    const local = path.join(app.getPath('userData'), 'installers', 'SKRiMPAD-' + good + '.exe');
    if (fs.existsSync(local)) {
      require('child_process').spawn(local, { detached: true, stdio: 'ignore' }).unref();
      app.quit();
      return;
    }
  } catch (e) {}
  shell.openExternal(REPO_RELEASES + '/tag/v' + good);
  app.quit();
});

app.whenReady().then(() => {
  // Grant mic (voice/hum-to-notes) AND MIDI — Chromium gates Web MIDI behind a
  // permission, so requestMIDIAccess() rejects without this and hardware
  // controllers never connect on Windows.
  // 'bluetooth' was missing, and setPermissionCheckHandler DENIES anything not
  // on this list. So navigator.bluetooth.requestDevice() was being refused
  // before the chooser could ever open — the select-bluetooth-device handler
  // below is correct and was simply never reached.
  const GRANTED = ['media', 'microphone', 'audioCapture', 'midi', 'midiSysex', 'bluetooth'];
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(GRANTED.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => GRANTED.includes(permission));
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
