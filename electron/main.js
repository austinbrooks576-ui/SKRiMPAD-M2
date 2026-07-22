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
