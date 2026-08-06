// Nothing to bridge — FREEREEL is a static app with no native dependencies.
// The preload exists only so contextIsolation stays on with a defined entry
// point, and to tag the platform for any future desktop-only affordance.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('FREEREEL_HOST', {
  platform: 'electron',
  version: process.versions.electron,
});
