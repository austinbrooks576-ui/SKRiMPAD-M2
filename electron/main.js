const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Audio must start clean and keep perfect time even when the window is
// minimized or covered — throttled timers let the sequencer fall behind the
// audio clock, and the catch-up burst on restore froze the app.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
  const MIDI_RE = /midi|korg|nanokey|microkey|nanokontrol|nanopad|keystage|smk|worlde|akai|mpk|mpd|launchkey|launchpad|arturia|keystep|keylab|novation|seaboard|roli|yamaha|casio|donner|alesis|m-?wave|m-?audio|nektar|icon/i;
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
}

app.whenReady().then(() => {
  // Grant mic (voice/hum-to-notes) AND MIDI — Chromium gates Web MIDI behind a
  // permission, so requestMIDIAccess() rejects without this and hardware
  // controllers never connect on Windows.
  const GRANTED = ['media', 'microphone', 'audioCapture', 'midi', 'midiSysex'];
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
