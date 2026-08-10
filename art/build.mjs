#!/usr/bin/env node
// ============================================================================
// Builds art/1of1-studio.html by inlining the 50 skin palettes into the
// template. The result is a single self-contained file that opens from
// file:// with no server, no build step and no network — same pattern as the
// SKRiMPAD app itself.
//
//   node art/build.mjs
//
// Also enforces the contrast floor from docs/product/1OF1.md: a skin whose
// text is unreadable on its own background has no business shipping as a
// palette. Fix the skin, not the threshold.
// ============================================================================
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SKINS = join(ROOT, "skins");

const TXT_ON_BG_MIN   = 4.5;   // primary text on the page ground
const MUTE_ON_SURF_MIN = 4.0;  // secondary text on a raised surface

const REQUIRED = [
  "--bg","--surf","--surf2","--surf3","--bdr","--txt","--mute",
  "--red","--orange","--yellow","--green","--teal","--blue","--purple","--pink","--lime",
  "--kick","--snare","--hhat","--clap","--tom1","--tom2","--ride","--crash",
  "--perc1","--perc2","--bass","--fx1","--fx2","--fx3","--fx4","--fx5",
];

const hexToRgb = h => {
  h = String(h).replace("#", "");
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const chan = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
const lum  = ([r,g,b]) => 0.2126*chan(r) + 0.7152*chan(g) + 0.0722*chan(b);
const contrast = (a, b) => {
  const [l1, l2] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((x,y) => y-x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const files = readdirSync(SKINS).filter(f => f.endsWith(".json")).sort();
const palettes = {};
const failures = [];
const rows = [];

for (const f of files) {
  const name = f.replace(/^skrimpad-skin-/, "").replace(/\.json$/, "");
  let skin;
  try {
    skin = JSON.parse(readFileSync(join(SKINS, f), "utf8"));
  } catch (e) {
    failures.push(`${name}: unparseable JSON — ${e.message}`);
    continue;
  }

  const missing = REQUIRED.filter(k => !skin[k]);
  if (missing.length) failures.push(`${name}: missing ${missing.join(", ")}`);

  const cTxt  = skin["--txt"]  && skin["--bg"]   ? contrast(skin["--txt"],  skin["--bg"])   : 0;
  const cMute = skin["--mute"] && skin["--surf"] ? contrast(skin["--mute"], skin["--surf"]) : 0;

  const badTxt  = cTxt  < TXT_ON_BG_MIN;
  const badMute = cMute < MUTE_ON_SURF_MIN;
  if (badTxt)  failures.push(`${name}: --txt on --bg is ${cTxt.toFixed(2)}:1 (needs ${TXT_ON_BG_MIN})`);
  if (badMute) failures.push(`${name}: --mute on --surf is ${cMute.toFixed(2)}:1 (needs ${MUTE_ON_SURF_MIN})`);

  rows.push({ name, cTxt, cMute, badTxt, badMute });
  palettes[name] = skin;
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n  ${pad("skin", 24)} ${pad("txt/bg", 9)} mute/surf`);
console.log("  " + "-".repeat(46));
for (const r of rows) {
  console.log(
    `  ${pad(r.name, 24)} ${pad(r.cTxt.toFixed(2) + ":1" + (r.badTxt ? " !" : ""), 9)} ` +
    `${r.cMute.toFixed(2)}:1${r.badMute ? " !" : ""}`
  );
}

const template = readFileSync(join(HERE, "studio.template.html"), "utf8");
if (!template.includes("/*__PALETTES__*/")) {
  console.error("\n  ✗ template is missing the /*__PALETTES__*/ marker\n");
  process.exit(1);
}
const out = template.replace("/*__PALETTES__*/{}", JSON.stringify(palettes, null, 0));
writeFileSync(join(HERE, "1of1-studio.html"), out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`\n  ${rows.length} palettes → art/1of1-studio.html (${kb} KB)`);

if (failures.length) {
  console.error(`\n  ✗ ${failures.length} contrast/schema failure(s):`);
  for (const f of failures) console.error(`      ${f}`);
  console.error(`\n  Built anyway so you can look at it, but these must be fixed`);
  console.error(`  in skins/ before the app ships. Fix the skin, not the threshold.\n`);
  process.exit(1);
}
console.log(`  ✓ all palettes pass the contrast floor\n`);
