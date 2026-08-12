// prep-android-edition.js — give each edition its own Android identity.
//
// WHY THIS HAD TO EXIST. android/app/build.gradle hard-codes
//   applicationId "com.firstriff.skrimpad.ultimate"
// and strings.xml hard-codes the label "SKRiMPAD ULTIMATE". Every APK workflow
// built from that same project, so the JP build produced an APK that ANDROID
// BELIEVED WAS ULTIMATE: installing it replaced ULTIMATE on the phone and put a
// launcher icon named SKRiMPAD ULTIMATE on the home screen that opened JP.
// Two apps, one identity, and the second one silently eats the first.
//
// Android decides all of that from the applicationId alone, so the fix is to
// set it — plus the visible label — per edition before gradle runs.
//
// Usage: node scripts/prep-android-edition.js <ultimate|jp|smk> [versionCode]
const fs = require('fs');
const path = require('path');

const EDITIONS = {
  ultimate: { id: 'com.firstriff.skrimpad.ultimate', name: 'SKRiMPAD ULTIMATE' },
  jp:       { id: 'com.firstriff.skrimpad.jp',       name: 'SKRiMPAD JP' },
  smk:      { id: 'com.firstriff.skrimpad.smk',      name: 'SKRiMPAD SMK' },
};

const [, , edition, run] = process.argv;
const e = EDITIONS[edition];
if (!e) {
  console.error('usage: prep-android-edition.js <' + Object.keys(EDITIONS).join('|') + '> [versionCode]');
  process.exit(1);
}

const root = path.join(__dirname, '..', 'android', 'app');
const gradleFile = path.join(root, 'build.gradle');
const stringsFile = path.join(root, 'src', 'main', 'res', 'values', 'strings.xml');

// Fail loudly if the pattern is not there. A silent no-op produces an APK that
// looks perfectly fine and uninstalls somebody's other edition, which is
// invisible until after it has happened.
//
// The check is on the PATTERN, not on whether the text changed. Comparing
// before and after conflates "I could not find it" with "it was already
// right" — and it is already right for exactly one edition, ULTIMATE, whose id
// is the one hard-coded in the file. So the first run of this failed the
// ULTIMATE build and passed everything else, which is the opposite of a useful
// guard.
const APP_ID = /applicationId\s+"[^"]*"/;
let gradle = fs.readFileSync(gradleFile, 'utf8');
if (!APP_ID.test(gradle)) {
  console.error('could not find applicationId in ' + gradleFile);
  process.exit(1);
}
gradle = gradle.replace(APP_ID, 'applicationId "' + e.id + '"');
// A rising versionCode, so a newer build is an UPGRADE rather than a refusal.
// Android compares this integer and nothing else.
if (run) {
  gradle = gradle.replace(/versionCode\s+\d+/, 'versionCode ' + (parseInt(run, 10) || 1));
  gradle = gradle.replace(/versionName\s+"[^"]*"/, 'versionName "1.0.' + (parseInt(run, 10) || 0) + '"');
}
fs.writeFileSync(gradleFile, gradle);

const APP_NAME = /(<string name="app_name">)[^<]*(<\/string>)/;
let strings = fs.readFileSync(stringsFile, 'utf8');
if (!APP_NAME.test(strings)) {
  console.error('could not find app_name in ' + stringsFile);
  process.exit(1);
}
strings = strings.replace(APP_NAME, '$1' + e.name + '$2');
fs.writeFileSync(stringsFile, strings);

console.log('android prepped: ' + e.name + ' (' + e.id + ')' + (run ? ' versionCode ' + run : ''));
