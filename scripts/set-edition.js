// Build-time edition switch. The shared index.html ships as the Special
// Edition by default; the consumer build calls this to flip the flag so the
// packaged app hides the SE HUD (⛩ button + themed engine) and runs as the
// plain studio. Usage: node scripts/set-edition.js <index.html path> <edition>
const fs = require('fs');
const [, , file, edition] = process.argv;
if (!file || !edition) { console.error('usage: set-edition.js <file> <se|consumer>'); process.exit(1); }
let s = fs.readFileSync(file, 'utf8');
const before = s;
s = s.replace(/window\.SKRIMPAD_EDITION='[^']*';\/\*BUILD_EDITION\*\//,
              "window.SKRIMPAD_EDITION='" + edition + "';/*BUILD_EDITION*/");
if (s === before) { console.error('WARNING: edition marker not found in ' + file); process.exit(1); }
fs.writeFileSync(file, s);
console.log('edition set to "' + edition + '" in ' + file);
