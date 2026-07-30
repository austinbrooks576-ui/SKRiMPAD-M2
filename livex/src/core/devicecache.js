// devicecache.js — the app LEARNS every controller it connects to.
//
// On first connection a device is classified by regex + probe (identify.js); the
// resulting profile (plus any probe refinements and, later, user customizations)
// is REMEMBERED here keyed by its device signature. Next time the same controller
// is plugged in, recall() returns the learned profile instantly — no re-probing,
// simpler identification.
//
// The cache is a plain JSON store. clearAll() wipes it — wire that to the
// Settings "Erase learned controllers" action.

import { deviceSignature } from './profiles.js';

const STORE_KEY = 'skrimpadx.devices.v1';

// --- storage backends --------------------------------------------------------
// Default: Web/Electron localStorage. Swap in a file/Preferences adapter on
// Android (Capacitor) or Electron userData by calling setStorage().
let storage = defaultStorage();

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined') {
      return {
        read: () => localStorage.getItem(STORE_KEY),
        write: (v) => localStorage.setItem(STORE_KEY, v),
        clear: () => localStorage.removeItem(STORE_KEY),
      };
    }
  } catch (e) { /* fall through */ }
  // in-memory fallback (SSR / no DOM)
  let mem = null;
  return { read: () => mem, write: (v) => { mem = v; }, clear: () => { mem = null; } };
}

// Provide a custom backend, e.g. Electron:
//   setStorage({ read: ()=>fs.readFileSync(p,'utf8'), write:(v)=>fs.writeFileSync(p,v), clear:()=>fs.unlinkSync(p) })
// or Capacitor Preferences. Each method may be sync or async.
export function setStorage(backend) { storage = backend; }

// --- load / save -------------------------------------------------------------
async function load() {
  try { const raw = await storage.read(); return raw ? JSON.parse(raw) : {}; }
  catch (e) { return {}; }
}
async function save(db) {
  try { await storage.write(JSON.stringify(db)); return true; }
  catch (e) { return false; }
}

// --- public API --------------------------------------------------------------

// Recall a learned profile for a live input, or null if never seen.
export async function recall(input) {
  const sig = deviceSignature(input && input.name, input && input.manufacturer);
  const db = await load();
  const rec = db[sig];
  if (!rec) return null;
  rec.profile.lastSeen = Date.now?.() ? undefined : undefined; // (host stamps time; kept host-side)
  return { ...rec.profile, portName: (input && input.name) || rec.profile.portName, learned: true };
}

// Remember (or update) a device's profile. Called after identify + probe settle,
// and again whenever the user customizes the layout so edits persist.
export async function remember(input, profile, meta = {}) {
  const sig = deviceSignature(input && input.name, input && input.manufacturer);
  const db = await load();
  const prev = db[sig];
  db[sig] = {
    signature: sig,
    name: (input && input.name) || profile.portName || sig,
    manufacturer: (input && input.manufacturer) || '',
    connections: (prev ? prev.connections || 0 : 0) + 1,
    profile: { ...profile, learned: true },
    ...meta,
  };
  await save(db);
  return db[sig];
}

// List every learned controller (for the Settings screen).
export async function list() {
  const db = await load();
  return Object.values(db).sort((a, b) => (b.connections || 0) - (a.connections || 0));
}

// Forget one device (Settings → per-row remove).
export async function forget(signatureOrInput) {
  const sig = typeof signatureOrInput === 'string'
    ? signatureOrInput
    : deviceSignature(signatureOrInput && signatureOrInput.name, signatureOrInput && signatureOrInput.manufacturer);
  const db = await load();
  if (db[sig]) { delete db[sig]; await save(db); return true; }
  return false;
}

// Erase the entire learned-controller cache — the Settings "reset" action.
export async function clearAll() {
  try { await storage.clear(); return true; }
  catch (e) { return await save({}); }
}
