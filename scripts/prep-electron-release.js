// Build-time release prep for the Electron desktop app. Sets a unique, rising
// version (so electron-updater can tell "newer" from "older") and an edition
// channel so the three editions in one repo NEVER cross-serve updates — an SE
// app only ever reads latest-se.yml, VGA only latest-vga.yml, consumer latest.yml.
// Usage: node scripts/prep-electron-release.js <electron/package.json> <edition> <runNumber>
const fs = require('fs');
const [, , file, edition, run] = process.argv;
if (!file || !edition || !run) {
  console.error('usage: prep-electron-release.js <package.json> <se|consumer|vga> <runNumber>');
  process.exit(1);
}
const channel = edition === 'se' ? 'latest-se' : edition === 'vga' ? 'latest-vga' : edition === 'livex' ? 'latest-livex' : 'latest';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.version = '1.0.' + run;                 // unique rising version per build
pkg.skrimpadChannel = channel;              // read by main.js at runtime → autoUpdater.channel
pkg.build = pkg.build || {};
pkg.build.publish = [{ provider: 'github', owner: 'austinbrooks576-ui', repo: 'SKRiMPAD-M2', channel }];
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log('electron release prepped: v' + pkg.version + ' channel=' + channel + ' (' + edition + ')');
