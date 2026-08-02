// bundle.js — produce a single self-contained dist/index.html for release.
//
// The editions in the SKRiMPAD-M2 repo ship as one index.html (no external module
// files), and Electron/Android WebView can't `import` ES modules over file://.
// So we bundle src/index.html's inline module (+ all ./core, ./styles imports)
// into one IIFE and inline it back into the HTML. Run: node tools/bundle.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = path.join(__dirname, '..', 'src');
const DIST = path.join(__dirname, '..', 'dist');
fs.mkdirSync(DIST, { recursive: true });

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) throw new Error('no <script type="module"> entry found in src/index.html');

// write the inline module as an entry file inside src/ so its ./core imports resolve
const entry = path.join(SRC, '.boot.entry.js');
fs.writeFileSync(entry, m[1]);
const outJs = path.join(DIST, 'boot.js');
try {
  execSync(`npx --yes esbuild "${entry}" --bundle --format=iife --platform=browser --target=es2019 --outfile="${outJs}"`,
    { stdio: 'inherit' });
} finally {
  fs.unlinkSync(entry);
}

const boot = fs.readFileSync(outJs, 'utf8');
const bundledHtml = html.replace(/<script type="module">[\s\S]*?<\/script>/, () => '<script>\n' + boot + '\n</script>');
fs.writeFileSync(path.join(DIST, 'index.html'), bundledHtml);
fs.unlinkSync(outJs);
console.log('bundled → dist/index.html (' + bundledHtml.length + ' bytes, self-contained)');
