// Build-time release prep for the Electron desktop app. Sets a unique, rising
// version (so electron-updater can tell "newer" from "older") and an edition
// channel so the three editions in one repo NEVER cross-serve updates — an SE
// app only ever reads latest-se.yml, VGA only latest-vga.yml, consumer latest.yml.
// Usage: node scripts/prep-electron-release.js <electron/package.json> <edition> <runNumber>
const fs = require('fs');
const [, , file, edition, run] = process.argv;
if (!file || !edition || !run) {
  console.error('usage: prep-electron-release.js <package.json> <se|consumer|vga|ultimate> <runNumber>');
  process.exit(1);
}
const channel = edition === 'se' ? 'latest-se'
  : edition === 'vga' ? 'latest-vga'
  : edition === 'ultimate' ? 'latest-ultimate'
  : 'latest';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.version = '1.0.' + run;                 // unique rising version per build
pkg.skrimpadChannel = channel;              // read by main.js at runtime → autoUpdater.channel
pkg.build = pkg.build || {};
pkg.build.publish = [{ provider: 'github', owner: 'austinbrooks576-ui', repo: 'SKRiMPAD-M2', channel }];

// ULTIMATE is a different application, not a skin of M2, so it takes its own
// appId and product name. Sharing an appId would make the installer UPGRADE M2
// in place — someone trying ULTIMATE would silently lose the app they were
// comparing it against, which is the opposite of what installing a second
// thing should do.
if (edition === 'ultimate') {
  pkg.build.appId = 'com.firstriff.ultimate';
  pkg.build.productName = 'SKRiMPAD ULTIMATE';
  pkg.description = 'SKRiMPAD ULTIMATE — one continuous depth instead of screens';
  pkg.build.win = Object.assign({}, pkg.build.win, { icon: '../ultimate/brand/icon.ico' });
  // macOS. electron-builder renders the .icns itself from a 512 PNG, so there
  // is one mark for every platform rather than a separate hand-exported file
  // that drifts.
  //
  // identity: null means DO NOT SIGN. There is no Apple Developer account
  // behind this, and an unsigned build that says so is honest; a build config
  // that pretends to sign fails the whole job instead. Gatekeeper will ask the
  // person to confirm on first open — see the release notes.
  //
  // Both architectures: an Intel Mac and an Apple Silicon Mac need different
  // binaries, and shipping only one silently excludes half the machines.
  pkg.build.mac = Object.assign({}, pkg.build.mac, {
    icon: '../ultimate/brand/icon-512.png',
    category: 'public.app-category.music',
    identity: null,
    darkModeSupport: true,
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
  });
  pkg.build.dmg = Object.assign({}, pkg.build.dmg, { writeUpdateInfo: false });
  pkg.build.nsis = Object.assign({}, pkg.build.nsis, {
    shortcutName: 'SKRiMPAD ULTIMATE',
    uninstallDisplayName: 'SKRiMPAD ULTIMATE',
  });
  // ULTIMATE has no layout.json — that file belongs to M2's window manager, and
  // electron-builder fails the build outright on an extraResource that is not
  // there rather than quietly skipping it.
  if (Array.isArray(pkg.build.extraResources)) {
    pkg.build.extraResources = pkg.build.extraResources.filter(
      (r) => !String(r && r.from).includes('layout.json'));
  }
}

fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
console.log('electron release prepped: v' + pkg.version + ' channel=' + channel + ' (' + edition + ')');
