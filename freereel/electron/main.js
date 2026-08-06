const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// The web app lives in ../app during development and is copied into
// resources/app-web by electron-builder for packaged builds.
function appIndex() {
  const packaged = path.join(process.resourcesPath || '', 'app-web', 'index.html');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'app', 'index.html');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#0a0b0f',
    autoHideMenuBar: true,
    title: 'FREEREEL',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // This app is essentially a directory of outbound links. Every one of them
  // must leave for the real browser — opening a streaming service inside an
  // Electron window breaks DRM playback and logs the user into a sandbox they
  // cannot get back out of.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const here = 'file://';
    if (url.startsWith(here)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  win.loadFile(appIndex());
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
