// Bridge the native auto-updater into the sandboxed renderer. contextIsolation
// is on, so window.skrimpadUpdater is the ONLY channel the page gets — it can
// ask main to check / install / roll back, and subscribe to updater events.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skrimpadUpdater', {
  check: () => ipcRenderer.invoke('updater:check'),
  install: () => ipcRenderer.invoke('updater:install'),
  revert: (good) => ipcRenderer.invoke('updater:revert', good),
  on: (cb) => ipcRenderer.on('updater:event', (_e, evt, info) => { try { cb(evt, info); } catch (e) {} }),
});
