// License issuance + validation. Keys are HMAC-signed so they can be verified
// offline by the app, AND recorded in a store so they can be revoked / counted.
//
// Key format:  SKRM-<EDITION>-<BASE32 PAYLOAD>-<SIG8>
//   payload = base32(edition|epochDays|nonce)   sig8 = first 8 of HMAC(payload)
//
// The store is a tiny pluggable interface. The default is a JSON file so this
// runs with zero infra; swap `FileStore` for a Postgres/Redis-backed store in
// production by passing your own {get,put,all} object to createLicenses().
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EDITIONS = { consumer: 'C', vga: 'V', se: 'S', live: 'L' };
const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function toB32(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) { val = (val << 8) | byte; bits += 8;
    while (bits >= 5) { out += b32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += b32[(val << (5 - bits)) & 31];
  return out;
}

class FileStore {
  constructor(file) { this.file = file; this._load(); }
  _load() { try { this.db = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { this.db = {}; } }
  _save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.db, null, 2)); }
  get(key) { return this.db[key] || null; }
  put(key, rec) { this.db[key] = rec; this._save(); }
  all() { return Object.values(this.db); }
}

function createLicenses(opts) {
  const secret = opts.secret;
  if (!secret || secret.length < 16) throw new Error('LICENSE_SIGNING_SECRET missing or too short');
  const store = opts.store || new FileStore(opts.file || path.join(__dirname, '..', 'data', 'licenses.json'));
  const sign = payload => crypto.createHmac('sha256', secret).update(payload).digest('hex');

  function issue({ edition, email, source, ref }) {
    const ed = EDITIONS[edition];
    if (!ed) throw new Error('unknown edition: ' + edition);
    const epochDays = Math.floor(Date.now() / 86400000);
    const nonce = crypto.randomBytes(5);
    const raw = Buffer.concat([Buffer.from([ed.charCodeAt(0)]), Buffer.from([(epochDays >> 8) & 255, epochDays & 255]), nonce]);
    const payload = toB32(raw);
    const sig = sign(payload).slice(0, 8).toUpperCase();
    const key = `SKRM-${ed}-${payload}-${sig}`;
    const rec = { key, edition, email: email || null, source: source || 'unknown', ref: ref || null,
      issuedAt: new Date().toISOString(), status: 'active', activations: 0 };
    store.put(key, rec);
    return rec;
  }

  // Verify signature (offline-checkable) AND, if we have a record, that it's active.
  function validate(key) {
    if (typeof key !== 'string') return { valid: false, reason: 'no-key' };
    const m = key.trim().toUpperCase().match(/^SKRM-([CVSL])-([A-Z2-7]+)-([A-Z0-9]{8})$/);
    if (!m) return { valid: false, reason: 'malformed' };
    const [, ed, payload, sig] = m;
    if (sign(payload).slice(0, 8).toUpperCase() !== sig) return { valid: false, reason: 'bad-signature' };
    const edition = Object.keys(EDITIONS).find(k => EDITIONS[k] === ed);
    const rec = store.get(key);
    if (rec && rec.status !== 'active') return { valid: false, reason: rec.status, edition };
    return { valid: true, edition, record: rec || null };
  }

  function revoke(key, reason) { const rec = store.get(key); if (rec) { rec.status = 'revoked'; rec.revokedReason = reason || null; store.put(key, rec); return true; } return false; }
  function recordActivation(key) { const rec = store.get(key); if (rec) { rec.activations = (rec.activations || 0) + 1; rec.lastActivation = new Date().toISOString(); store.put(key, rec); } }

  return { issue, validate, revoke, recordActivation, store };
}

module.exports = { createLicenses, FileStore, EDITIONS };
