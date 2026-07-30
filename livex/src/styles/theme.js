// theme.js — skin loading + the "contrary color" used to make accidentals pop.
//
// Confirmed decision: the "minor" keys (sharps/flats) are drawn in a CONTRARY /
// complementary color derived from the white-key tone — a contrasting hue, NOT a
// dark inverted fill. contraryColor() computes that hue per-skin.

// Clean line-art default (single-weight strokes, paper/ink), overridable by a skin.
export const DEFAULT_THEME = Object.freeze({
  class: 'blueprint',
  bg: '#0e1116',
  ink: '#cdd6e0',        // stroke color for the schematic line-work
  paper: '#141a22',      // white-key fill
  whiteKey: '#e8edf2',   // white-key face
  accent: '#4bd6c8',
  mute: '#5b6774',
  font: "'Oswald','Arial Narrow',sans-serif",
});

// Load one of the SKRiMPAD skin JSONs (same shape as SKRiMPADM2skinpack/*.json)
// and map it onto our theme fields. Falls back to DEFAULT_THEME.
export function themeFromSkin(skin) {
  if (!skin || !skin.theme) return { ...DEFAULT_THEME };
  const t = skin.theme;
  return {
    ...DEFAULT_THEME,
    class: t.class || DEFAULT_THEME.class,
    bg: t.bg1 || DEFAULT_THEME.bg,
    ink: t.gold || t.paper || DEFAULT_THEME.ink,
    paper: t.bg2 || DEFAULT_THEME.paper,
    whiteKey: t.paper || DEFAULT_THEME.whiteKey,
    accent: t.accent || t.goldBright || DEFAULT_THEME.accent,
    font: t.font || DEFAULT_THEME.font,
  };
}

// ---- contrary color ---------------------------------------------------------
// Rotate hue ~180° from the white-key color and push lightness the other way, so
// accidentals read as a contrasting hue against the white keys in any skin.
export function contraryColor(hex, sat = 0.62) {
  const { h, s, l } = hexToHsl(hex);
  const h2 = (h + 180) % 360;
  const l2 = l > 0.5 ? clamp(l - 0.42) : clamp(l + 0.42);
  const s2 = Math.max(s, sat);
  return hslToHex(h2, s2, l2);
}

// ---- small color utils ------------------------------------------------------
function clamp(x, lo = 0, hi = 1) { return Math.min(hi, Math.max(lo, x)); }

function hexToHsl(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  h /= 360;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
