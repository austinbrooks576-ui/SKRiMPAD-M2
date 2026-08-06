// site.js — assemble the installable web app into ultimate/site/.
//
// WHAT THIS IS FOR. An iPad cannot install a macOS .dmg, and it cannot sideload
// an .ipa without an Apple Developer account and a signing identity. The only
// route onto an iPad that does not require paying Apple $99/year is Safari's
// "Add to Home Screen", which installs a PROGRESSIVE WEB APP: a URL that,
// once added, opens full-screen with its own icon and works with the network
// off. ULTIMATE suits that unusually well, because it bundles to one
// self-contained HTML file and synthesises every sound it makes — there is no
// asset pack to download and nothing to stream.
//
// So this produces the four-and-a-bit files a browser needs to treat the app as
// installable, and then CHECKS them, because every way a PWA fails is silent:
//   · a manifest icon that 404s installs a blank tile rather than erroring
//   · a service-worker SHELL listing a file that is not there makes addAll()
//     reject, which aborts install(), which means the app never goes offline —
//     and nothing on screen says so
//   · an apple-touch-icon that is missing gets you a screenshot of the page,
//     scaled down, as your home-screen icon
// None of those show up until someone has already installed it. They are cheap
// to catch here and expensive to catch in the wild.
//
// Run: node ultimate/tools/bundle.js && node ultimate/tools/site.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');          // ultimate/
const DIST = path.join(ROOT, 'dist');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'site');

const die = (m) => { console.error('site: ' + m); process.exit(1); };

const app = path.join(DIST, 'index.html');
if (!fs.existsSync(app)) die('dist/index.html missing — run tools/bundle.js first');
const html = fs.readFileSync(app, 'utf8');

// The same guard the desktop and APK builds use. A bundle that still points at
// ./core/*.js works when served over http and breaks over file://, so it would
// pass here and fail in Electron — catch it in every pipeline, not just one.
if (/<script[^>]+src="\.\/|<link[^>]+href="\.\/(?!icon)/.test(html)) {
  die('dist/index.html still references external files; it must be self-contained');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// ---- copy ------------------------------------------------------------------
fs.writeFileSync(path.join(OUT, 'index.html'), html);
const copied = ['index.html'];
for (const f of fs.readdirSync(WEB)) {
  fs.copyFileSync(path.join(WEB, f), path.join(OUT, f));
  copied.push(f);
}

// ---- stamp the service worker with the build's identity --------------------
// VERSION is the cache name, and activate() deletes every cache that is not the
// current one. Leaving it a hand-edited constant means a new build lands in a
// cache the browser is already treating as authoritative, and the old app keeps
// being served until someone happens to bump a string. Hashing the bundle makes
// "the app changed" and "the cache is stale" the same fact.
const swPath = path.join(OUT, 'sw.js');
const hash = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12);
let sw = fs.readFileSync(swPath, 'utf8');
const before = sw;
sw = sw.replace(/const VERSION = '[^']*';/, "const VERSION = 'skrimpad-ultimate-" + hash + "';");
if (sw === before) die('sw.js has no VERSION line to stamp');
fs.writeFileSync(swPath, sw);

// ---- verify ----------------------------------------------------------------
const here = (f) => fs.existsSync(path.join(OUT, f.replace(/^\.\//, '')));

// Every file the service worker promises to cache must exist. './' is the
// directory itself and resolves to index.html on any static host.
const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || die('sw.js has no SHELL');
const shellFiles = [...shell.matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const f of shellFiles) {
  if (f === './') continue;
  if (!here(f)) die('sw.js caches ' + f + ', which is not in the site');
}

// Every manifest icon must exist, and the manifest must parse — a browser that
// cannot parse it simply declines to offer installation, with no message.
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.webmanifest'), 'utf8'));
for (const ic of manifest.icons || []) {
  if (!here(ic.src)) die('manifest lists icon ' + ic.src + ', which is not in the site');
}
if (!(manifest.icons || []).some((i) => /\bmaskable\b/.test(i.purpose || ''))) {
  die('manifest has no maskable icon — Android will letterbox the tile');
}

// And what the page itself asks for. The links are injected by a short script
// in <head> rather than written as static tags, because this same file also
// runs over file:// inside Electron and the APK, where a static
// <link rel="manifest"> is a 404 on every launch. So the check reads the table
// that script is driven by — which is the thing that has to be right.
const inject = (html.match(/\[\['manifest'[\s\S]{0,400}?\]\]/) || [])[0];
if (!inject) die('index.html no longer injects the install links — did the head script change?');
for (const rel of ['manifest', 'apple-touch-icon', 'icon']) {
  if (!inject.includes("'" + rel + "'")) die('the install links no longer include rel=' + rel);
}
for (const f of [...inject.matchAll(/'([\w.-]+\.(?:png|webmanifest))'/g)].map((m) => m[1])) {
  if (!here(f)) die('index.html links ' + f + ', which is not in the site');
}

const bytes = copied.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log('site → ultimate/site/ (' + copied.length + ' files, ' +
            (bytes / 1024 / 1024).toFixed(2) + 'MB, cache ' + hash + ')');
console.log('  ' + copied.join(' '));
