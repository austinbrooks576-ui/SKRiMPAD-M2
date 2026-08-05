// genres.js — thirty-four genres, and what each one actually does to a song.
//
// WHERE THIS CAME FROM. M2 shipped a genre selector with these thirty-four
// patterns in it, and it was the best thing in that app that ULTIMATE did not
// have. What arrives here is the patterns; what is new is everything around
// them, because M2's version had three limits that made every genre sound like
// the same drum machine wearing a different hat:
//
//   1. THE PATTERNS WERE BINARY. A step was on or off, and M2 then dropped 13%
//      of the hits at random to make it "human". Random dropout is not human —
//      a drummer does not delete notes, they hit some of them harder. Real
//      genre character lives almost entirely in DYNAMICS: boom bap is a loud
//      backbeat over quiet ghost notes, house is a flat unaccented pulse, and
//      the difference between them survives even if you flatten the grid. So
//      every hit here carries a velocity derived from where it sits in the bar,
//      what the role is, and how much the genre swings.
//
//   2. THEY WERE ADDRESSED BY TRACK NUMBER. Track 2 was the hats because that
//      is where the hats happened to be. Move a sound and the genre lands on
//      the wrong pad. Here a pattern names a ROLE, and roles are matched to
//      whatever cell is doing that job — which is also why a kit the user has
//      rearranged still works.
//
//   3. THEY PRODUCED ONE BAR. ULTIMATE has four scenes, which is a song, not a
//      loop. A genre now fills all four: the pattern, a variation of it, a
//      breakdown, and a bar that ends with a fill. Those are derived from the
//      main pattern by rules rather than written out, so adding a genre is
//      still adding one row.
//
// EVERYTHING IS SEEDED. Same genre + same seed = same song, every time, which
// is what makes this testable at all. A new seed gives a different song that is
// still recognisably the genre.

// ---------------------------------------------------------------------------
// THE TABLE. One row per genre.
//   l    label
//   m    mood, one line, shown under the label
//   bpm  [low, high] — the tempo range the genre actually lives in
//   sw   swing, 0 to 1 of a 16th. This is the single biggest character switch
//        in the table: 0.28 is what makes boom bap lope and 0.00 is what makes
//        techno march.
//   half half-time — the backbeat lands once a bar instead of twice. Trap,
//        drill and dubstep are written at double tempo and felt at half.
//   r    the pattern, by role, sixteen characters each.
// ---------------------------------------------------------------------------
export const GENRES = {
  afrobeats: { l: 'Afrobeats', m: 'Sunny bounce', bpm: [98, 110], sw: 0.10, r: { HAT: '0010010010010010', KICK: '1001001000100100', RIM: '0100010101000101', SNARE: '0000100000001000' } },
  amapiano: { l: 'Amapiano', m: 'Log-drum roll', bpm: [110, 115], sw: 0.12, r: { BASS: '1001001010010010', HAT: '1010101010101010', KICK: '0000100000001000', RIM: '0001000000010000' } },
  ambient: { l: 'Ambient', m: 'Weightless', bpm: [60, 80], sw: 0.00, r: { KICK: '1000000000000000', RIM: '0000001000000010' } },
  boombap: { l: 'Boom Bap', m: 'Head-nod dust', bpm: [88, 96], sw: 0.28, r: { BASS: '1000000010000000', HAT: '1010101010101010', KICK: '1000001000100000', SNARE: '0000100000001001' } },
  breakcore: { l: 'Breakcore', m: 'Chaotic', bpm: [190, 220], sw: 0.00, r: { ATMOS: '0001001000010001', HAT: '1111111111111111', KICK: '1001010010100100', SNARE: '0010100101001011', STAB: '0000000100000010' } },
  cinematic: { l: 'Cinematic', m: 'Trailer tension', bpm: [75, 95], sw: 0.00, r: { KICK: '1000000010000000', PERC: '0000000000001000', RIM: '0001000100010011', TOM: '1000000010000011' } },
  dancehall: { l: 'Dancehall', m: 'Bashment', bpm: [95, 105], sw: 0.12, r: { KICK: '1000000010100000', RIM: '0010001000100010', SNARE: '0000100100001000' } },
  dirtysouth: { l: 'Dirty South', m: 'Bouncy', bpm: [70, 85], sw: 0.14, r: { BASS: '1001000000100000', CLAP: '0000100000001000', HAT: '1111111111111111', KICK: '1001001000100100', RIDE: '0000000100000001' } },
  disco: { l: 'Disco', m: 'Four-on-floor shine', bpm: [115, 125], sw: 0.06, r: { HAT: '1011101110111011', KICK: '1000100010001000', RIDE: '0010001000100010', SNARE: '0000100000001000' } },
  drill: { l: 'Drill', m: 'Sliding menace', bpm: [138, 146], sw: 0.00, half: 1, r: { BASS: '1000001001000000', HAT: '1010110110101101', KICK: '1000001001000000', SNARE: '0001000000010000' } },
  dub: { l: 'Dub', m: 'Spacey', bpm: [70, 80], sw: 0.16, r: { HAT: '0010001000100010', KICK: '0000000010000000', RIM: '0000100000001000', STAB: '0000000100000000', SUB: '1000001000100000' } },
  dubstep: { l: 'Dubstep', m: 'Heavy', bpm: [138, 142], sw: 0.00, half: 1, r: { BASS: '1000001000010010', HAT: '0010001000100010', KICK: '1000000000000000', SNARE: '0000000010000000', STAB: '0000000000000010' } },
  funk: { l: 'Funk', m: 'Pocket groove', bpm: [100, 112], sw: 0.18, r: { HAT: '1111111111111111', KICK: '1001001001001000', RIM: '0010000100100001', SNARE: '0000100100001010' } },
  garage: { l: 'Garage', m: 'Shuffling', bpm: [130, 136], sw: 0.34, r: { CLAP: '0001000001000001', HAT: '0010011000100110', KICK: '1000000100100000', SNARE: '0000100000001000' } },
  grime: { l: 'Tampa Grime', m: 'Gritty', bpm: [138, 142], sw: 0.00, half: 1, r: { BASS: '1000000010000000', HAT: '0010001000100010', KICK: '1001000010000010', RIM: '0000000001000100', SNARE: '0000100000010000' } },
  hardcore: { l: 'Hardcore', m: 'Relentless', bpm: [160, 180], sw: 0.00, r: { KICK: '1000100010001010', PERC: '1000000000000000', RIDE: '0010001000100010', STAB: '0000000100000001' } },
  hardstep: { l: 'Hardstep', m: 'Menacing', bpm: [170, 180], sw: 0.00, r: { HAT: '1010101010101010', KICK: '1000000000100000', SNARE: '0000100000001001', STAB: '0000000000000001', SUB: '1000000000100000' } },
  house: { l: 'House', m: 'Groovy', bpm: [120, 128], sw: 0.04, r: { CLAP: '0000100000001000', KICK: '1000100010001000', PERC: '1111111111111111', RIDE: '0010001000100010', RIM: '0001000000000100' } },
  industrial: { l: 'Industrial', m: 'Machine', bpm: [120, 135], sw: 0.00, r: { ATMOS: '0010001000100010', KICK: '1000100010001010', RIDE: '1000000010000000', SNARE: '0000100000001000', STAB: '0000001000000100' } },
  jungle: { l: 'Jungle', m: 'Rolling', bpm: [165, 175], sw: 0.10, r: { HAT: '1011101011101011', KICK: '1000000000100000', PERC: '1000000000000000', SNARE: '0000100100001000', SUB: '1000000000100000' } },
  lofi: { l: 'Lofi', m: 'Cozy', bpm: [70, 90], sw: 0.24, r: { HAT: '1010101110101010', KICK: '1000001000100000', PERC: '0001000000010000', SNARE: '0000100000001000' } },
  memphis: { l: 'Memphis Rap', m: 'Menacing', bpm: [130, 140], sw: 0.00, half: 1, r: { BASS: '1000000100000000', HAT: '1010101010101111', KICK: '1000000100100000', RIM: '0000000010000010', SNARE: '0000100000001000' } },
  oldschool: { l: 'Old School', m: 'Boom bap', bpm: [95, 110], sw: 0.26, r: { HAT: '1010101010101010', KICK: '1000000010100000', SNARE: '0000100000001000', STAB: '0000000100000000' } },
  psytrance: { l: 'Psytrance', m: 'Full-power', bpm: [140, 148], sw: 0.00, r: { BASS: '0111011101110111', HAT: '0010001000100010', KICK: '1000100010001000' } },
  reggaeton: { l: 'Reggaeton', m: 'Dembow ride', bpm: [92, 100], sw: 0.06, r: { HAT: '1010101010101010', KICK: '1000100010001000', SNARE: '0001001000010010' } },
  synthwave: { l: 'Synthwave', m: 'Neon drive', bpm: [100, 115], sw: 0.00, r: { HAT: '1010101010101010', KICK: '1000000010000000', RIDE: '0000001000000010', SNARE: '0000100000001000' } },
  techno: { l: 'Techno', m: 'Warehouse pulse', bpm: [128, 136], sw: 0.00, r: { BASS: '0000000100000001', HAT: '1101110111011101', KICK: '1000100010001000', RIDE: '0010001000100010' } },
  trance: { l: 'Trance', m: 'Euphoric', bpm: [132, 140], sw: 0.00, r: { CLAP: '0000100000001000', KICK: '1000100010001000', RIDE: '1010101010101010', STAB: '0000000000000001' } },
  trap: { l: 'Trap', m: 'Rattling 808s', bpm: [130, 150], sw: 0.00, half: 1, r: { BASS: '1000000100000000', HAT: '1011101011101011', KICK: '1000000100100000', SNARE: '0000100000001000' } },
  tribal: { l: 'Tribal', m: 'Primal', bpm: [100, 124], sw: 0.08, r: { KICK: '1000100010001000', PERC: '1111111111111111', RIM: '1001001000101000', TOM: '0110011101101011' } },
  tripstep: { l: 'Tripstep', m: 'Woozy', bpm: [138, 142], sw: 0.00, half: 1, r: { ATMOS: '0000000000000010', HAT: '0010010000100100', KICK: '1000001000000000', SNARE: '0000000010000000', SUB: '1000000000010000' } },
  vaporwave: { l: 'Vaporwave', m: 'Dreamy', bpm: [60, 80], sw: 0.00, r: { KICK: '1000000010000000', RIDE: '0010001000100010', RIM: '0000000100000001', SNARE: '0000100000001000', SUB: '1000000010000000' } },
  viking: { l: 'Viking', m: 'War march', bpm: [80, 96], sw: 0.00, r: { KICK: '1000000010000000', PERC: '1000000000000000', RIM: '0011001100110011', TOM: '1010101010101111' } },
  westcoast: { l: 'West Coast', m: 'Rollin', bpm: [88, 100], sw: 0.16, r: { CLAP: '0000100000001000', HAT: '1010101010101010', KICK: '1000000100100000', RIM: '0010001000100010', SUB: '1000000100100000' } },
};

// Thirty-four names in one column is a wall. Grouped, it is five short lists
// you can read — and the groups are the ones people already think in, not
// alphabetical, which is an ordering nobody has ever wanted from a genre list.
export const FAMILIES = [
  ['Hip-hop & trap', ['boombap', 'oldschool', 'lofi', 'westcoast', 'dirtysouth', 'memphis', 'trap', 'drill', 'grime']],
  ['House & techno', ['house', 'techno', 'disco', 'trance', 'psytrance', 'industrial', 'hardcore']],
  ['Bass & breaks', ['jungle', 'dubstep', 'hardstep', 'breakcore', 'garage', 'tripstep', 'dub']],
  ['Global & groove', ['afrobeats', 'amapiano', 'dancehall', 'reggaeton', 'funk', 'tribal']],
  ['Atmosphere', ['ambient', 'cinematic', 'synthwave', 'vaporwave', 'viking']],
];

// ---------------------------------------------------------------------------
// DYNAMICS
// ---------------------------------------------------------------------------

// Where a step sits in the bar, as a weight. The downbeat is the loudest thing
// in any bar in any genre; the beats are next; the 8ths between them next; the
// 16ths are the quietest. The last step is lifted slightly because it is a
// pickup into the next bar, and a drummer leans on it.
const WEIGHT = [
  1.00, 0.34, 0.56, 0.38,
  0.88, 0.36, 0.58, 0.40,
  0.95, 0.35, 0.57, 0.39,
  0.90, 0.37, 0.60, 0.48,
];

// How loud each role is at full weight, and how much of its range the weight
// actually moves. A kick is loud and nearly flat — kicks do not have much
// dynamic range and a quiet one sounds like a mistake. A hat is quiet and very
// dynamic, which is where most of a groove's shape actually lives.
const ROLE = {
  KICK:  { peak: 1.00, span: 0.18 },
  SNARE: { peak: 0.96, span: 0.30 },
  CLAP:  { peak: 0.90, span: 0.22 },
  RIM:   { peak: 0.68, span: 0.45 },
  HAT:   { peak: 0.62, span: 0.62 },
  RIDE:  { peak: 0.60, span: 0.50 },
  PERC:  { peak: 0.66, span: 0.55 },
  TOM:   { peak: 0.80, span: 0.40 },
  SUB:   { peak: 0.94, span: 0.14 },
  BASS:  { peak: 0.88, span: 0.26 },
  STAB:  { peak: 0.80, span: 0.35 },
  ATMOS: { peak: 0.62, span: 0.30 },
  LEAD:  { peak: 0.78, span: 0.34 },
  PLUCK: { peak: 0.74, span: 0.42 },
  PAD:   { peak: 0.58, span: 0.20 },
  BELL:  { peak: 0.70, span: 0.40 },
};
const DEFAULT_ROLE = { peak: 0.75, span: 0.35 };

// Roles that can carry ghost notes — the near-silent extra hits between the
// real ones. This is the single thing that separates a played groove from a
// programmed one, and it only belongs on the instruments a hand can brush:
// you can ghost a snare or a hat, you cannot ghost a kick drum.
const GHOSTABLE = { SNARE: 0.16, HAT: 0.20, PERC: 0.18, RIM: 0.14 };

// ---------------------------------------------------------------------------

// mulberry32 — small, fast, and identical everywhere, which is the only
// property that matters here. Math.random would make every one of these
// functions untestable.
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampVel = (v) => Math.max(1, Math.min(127, Math.round(v)));

// One hit's velocity: role loudness × where it falls in the bar, then nudged.
// The nudge is ±4%, which is under a decibel — it is not audible as a change in
// level, only as the absence of the machine-gun sameness that identical
// velocities produce.
function velocity(role, step, rand, lift) {
  const r = ROLE[role] || DEFAULT_ROLE;
  const w = WEIGHT[step & 15];
  const base = r.peak * (1 - r.span + r.span * w) * (lift == null ? 1 : lift);
  return clampVel(127 * base * (0.96 + rand() * 0.08));
}

// ---------------------------------------------------------------------------
// BUILDING A BAR
// ---------------------------------------------------------------------------

// Turn one role's sixteen characters into sixteen velocities, with ghosts.
//
// Ghosts only go in when the genre swings, and that is not an arbitrary rule:
// swing and ghost notes come from the same place, a drummer playing a shuffle
// with the stick never leaving the head. A straight, quantised genre — techno,
// trance, psytrance — has no ghosts precisely because nothing between the hits
// is being touched, and adding them would be adding a groove the genre spends
// its whole existence avoiding.
function lane(pattern, role, gen, rand, opts) {
  const out = new Array(16).fill(0);
  for (let s = 0; s < 16; s++) {
    if (pattern[s] === '1') out[s] = velocity(role, s, rand, opts && opts.lift);
  }
  const ghost = GHOSTABLE[role];
  if (ghost && gen.sw >= 0.08 && !(opts && opts.noGhost)) {
    for (let s = 0; s < 16; s++) {
      if (out[s]) continue;
      if (!(s & 1)) continue;                 // ghosts live between the 8ths
      if (rand() > gen.sw * 1.6) continue;    // the more swing, the more of them
      out[s] = clampVel(127 * ghost * (0.8 + rand() * 0.4));
    }
  }
  return out;
}

// A genre's pattern names four to six roles. The other ten pads would be left
// empty, which is not a song — so the melodic and atmospheric roles get parts
// derived from what the rhythm is already doing. These are rules, not patterns:
// a PAD holds where the kick lands on a downbeat, a PLUCK answers the backbeat,
// a BELL picks out the bar's last accent. They stay out of the way of anything
// the genre defined for itself.
function dress(bar, gen, rand) {
  const has = (role) => bar[role] && bar[role].some((v) => v > 0);
  const kick = bar.KICK || [];
  const slow = gen.bpm[0] <= 100;

  // PAD — the sustained bed. On the downbeat always; on the half-bar too if the
  // genre is slow enough for a second chord to breathe.
  if (!has('PAD')) {
    const p = new Array(16).fill(0);
    p[0] = velocity('PAD', 0, rand);
    if (slow || gen.sw > 0.1) p[8] = velocity('PAD', 8, rand, 0.9);
    bar.PAD = p;
  }

  // ATMOS — one long swell per bar, placed away from the downbeat so it arrives
  // rather than announces. Skipped when the genre already uses it.
  if (!has('ATMOS')) {
    const a = new Array(16).fill(0);
    a[slow ? 8 : 12] = velocity('ATMOS', 8, rand);
    bar.ATMOS = a;
  }

  // PLUCK — answers the backbeat, on the 'and' after it. Only where there is a
  // backbeat to answer; a genre with no snare has nothing to reply to.
  if (!has('PLUCK') && (has('SNARE') || has('CLAP'))) {
    const p = new Array(16).fill(0);
    const back = bar.SNARE || bar.CLAP;
    for (let s = 0; s < 16; s++) if (back[s] && s + 2 < 16 && !kick[s + 2]) p[s + 2] = velocity('PLUCK', s + 2, rand, 0.85);
    bar.PLUCK = p;
  }

  // LEAD — the top line, and the one that most easily ruins a groove, so it is
  // the most conservative thing here: the downbeat and the last accent, nothing
  // in between. Not on genres that are about the drums.
  if (!has('LEAD') && !gen.half && gen.sw < 0.2) {
    const l = new Array(16).fill(0);
    l[0] = velocity('LEAD', 0, rand);
    l[14] = velocity('LEAD', 14, rand, 0.8);
    bar.LEAD = l;
  }

  // BELL — a single accent, high in the bar and late, for the genres that have
  // room for one. Fast, dense genres do not.
  if (!has('BELL') && gen.bpm[1] <= 140) {
    const b = new Array(16).fill(0);
    b[slow ? 12 : 6] = velocity('BELL', 12, rand, 0.85);
    bar.BELL = b;
  }
  return bar;
}

function mainBar(gen, seed) {
  const rand = rng(seed);
  const bar = {};
  Object.keys(gen.r).forEach((role) => { bar[role] = lane(gen.r[role], role, gen, rand); });
  return dress(bar, gen, rand);
}

// ---------------------------------------------------------------------------
// THE OTHER THREE SCENES
//
// A song is not four copies of a bar, and it is also not four unrelated bars.
// These are the three things that actually happen after the main groove in
// almost every record in every one of these genres: it gets busier, it drops
// away, and it comes back with a fill.
// ---------------------------------------------------------------------------

// VARIATION — the same bar, elaborated. The hats subdivide, one extra kick goes
// in where there is room, and one decorative role sits out so the busier hats
// have space. Same skeleton, so it still cuts back to the main without a seam.
function variation(bar, gen, seed) {
  const rand = rng(seed ^ 0x5EED);
  const out = {};
  Object.keys(bar).forEach((k) => { out[k] = bar[k].slice(); });

  let added = 0;
  if (out.HAT) {
    for (let s = 1; s < 16; s += 2) {
      if (!out.HAT[s] && rand() < 0.55) { out.HAT[s] = velocity('HAT', s, rand, 0.8); added++; }
    }
  }
  if (out.KICK) {
    // One extra kick, on an offbeat 16th that is not already busy and not on
    // top of the backbeat. Two would stop being a variation and start being a
    // different pattern.
    const spots = [];
    for (let s = 3; s < 16; s += 2) {
      if (!out.KICK[s] && !(out.SNARE && out.SNARE[s] > 60)) spots.push(s);
    }
    if (spots.length) {
      const s = spots[Math.floor(rand() * spots.length)];
      out.KICK[s] = velocity('KICK', s, rand, 0.88);
      added++;
    }
  }
  // Sit one decorative role out, so the busier hats have somewhere to be heard.
  // Never a rhythm-defining one — dropping the kick is not a variation, it is a
  // breakdown.
  //
  // AND ONLY IF IT COSTS LESS THAN WAS ADDED. Without that condition this can
  // remove more than it puts in, and a "variation" that is thinner than the bar
  // it varies is just a worse version of it: measured on jungle, the drop of a
  // five-hit ride against three added hats came out a net LOSS. A part rests
  // when there is something to rest behind, not unconditionally.
  const spare = ['BELL', 'LEAD', 'PLUCK', 'RIDE', 'PERC']
    .filter((k) => out[k] && out[k].some(Boolean))
    .filter((k) => out[k].filter(Boolean).length <= added);
  if (spare.length) out[spare[Math.floor(rand() * spare.length)]] = new Array(16).fill(0);
  return out;
}

// BREAKDOWN — what is left when you take the groove away. The kick keeps only
// its downbeat, the backbeat survives, everything percussive goes, and the
// atmosphere comes up to fill the hole it leaves. This is the bar that makes
// the main pattern sound like an arrival when it comes back.
function breakdown(bar, gen, seed) {
  const rand = rng(seed ^ 0xB2EA4);
  const out = {};
  const KEEP_SPARSE = { KICK: 1, SUB: 1, SNARE: 1, CLAP: 1 };
  Object.keys(bar).forEach((k) => {
    if (k === 'PAD' || k === 'ATMOS' || k === 'BELL') { out[k] = bar[k].slice(); return; }
    if (!KEEP_SPARSE[k]) { out[k] = new Array(16).fill(0); return; }
    const lane16 = new Array(16).fill(0);
    // Only the hits on beats survive; the ornament between them is the groove,
    // and the groove is the thing being removed.
    for (let s = 0; s < 16; s += 4) if (bar[k][s]) lane16[s] = bar[k][s];
    out[k] = lane16;
  });
  // The pad opens up — it is carrying the bar on its own now.
  out.PAD = out.PAD || new Array(16).fill(0);
  out.PAD[0] = velocity('PAD', 0, rand, 1.15);
  out.ATMOS = out.ATMOS || new Array(16).fill(0);
  out.ATMOS[0] = velocity('ATMOS', 0, rand, 1.1);
  out.ATMOS[8] = velocity('ATMOS', 8, rand, 0.95);
  return out;
}

// FILL — the main bar, with its last beat replaced by a run that lands on the
// next downbeat. Toms if the kit has them, snare if not, rising in velocity
// across the four steps so it pushes rather than just being louder.
function fill(bar, gen, seed) {
  const rand = rng(seed ^ 0xF111);
  const out = {};
  Object.keys(bar).forEach((k) => { out[k] = bar[k].slice(); });
  const roll = out.TOM ? 'TOM' : (out.SNARE ? 'SNARE' : 'PERC');
  out[roll] = out[roll] || new Array(16).fill(0);
  // A fill is not "more notes at the end". On a genre already playing 16ths
  // everywhere — house, breakcore, garage — there are no more notes available,
  // and measuring density there proves it: the fill came out exactly as dense
  // as the bar it was meant to be ending. What a fill actually is, is the last
  // beat handed to ONE voice: everything ornamental gets out of the way and a
  // rising run lands you on the next downbeat. So the ornaments are cleared
  // across the last beat, and the roll is the only thing left in it.
  const ORNAMENT = ['HAT', 'RIDE', 'RIM', 'PERC', 'CLAP', 'BELL', 'PLUCK', 'LEAD', 'STAB'];
  ORNAMENT.forEach((k) => {
    if (k === roll || !out[k]) return;
    for (let s = 12; s < 16; s++) out[k][s] = 0;
  });
  for (let s = 12; s < 16; s++) {
    // 0.62 → 1.00 across the four steps. A fill that does not get louder is
    // just four more notes.
    out[roll][s] = clampVel(127 * (ROLE[roll] || DEFAULT_ROLE).peak * (0.62 + (s - 12) * 0.126));
  }
  // A crash on the downbeat of the fill bar, because that is where the section
  // it is ending began.
  out.RIDE = out.RIDE || new Array(16).fill(0);
  out.RIDE[0] = velocity('RIDE', 0, rand, 1.2);
  return out;
}

// ---------------------------------------------------------------------------
// PUBLIC
// ---------------------------------------------------------------------------

export function genreList() {
  return FAMILIES.map(([family, ids]) => [family, ids.map((id) => ({
    id, label: GENRES[id].l, mood: GENRES[id].m,
    bpm: GENRES[id].bpm, swing: GENRES[id].sw, half: !!GENRES[id].half,
  }))]);
}

// The four bars a genre produces, as { ROLE: [16 velocities] } each.
export function buildScenes(id, seed = 1) {
  const gen = GENRES[id];
  if (!gen) return null;
  const main = mainBar(gen, seed);
  return [main, variation(main, gen, seed), breakdown(main, gen, seed), fill(main, gen, seed)];
}

// Tempo and swing, both derived from the seed so a genre applied twice with
// different seeds is a different take rather than the same one.
export function genreTempo(id, seed = 1) {
  const gen = GENRES[id];
  if (!gen) return null;
  const rand = rng(seed ^ 0x7E770);
  const [lo, hi] = gen.bpm;
  return {
    bpm: Math.round(lo + rand() * (hi - lo)),
    // A little variation around the genre's swing, but never across zero: a
    // straight genre must stay straight, so 0 stays 0.
    swing: gen.sw === 0 ? 0 : Math.max(0, Math.min(0.6, gen.sw + (rand() - 0.5) * 0.04)),
    half: !!gen.half,
  };
}

// Write a genre into a song. Cells are matched BY NAME, so a kit the user has
// rearranged or renamed still receives the right parts, and a role the kit does
// not have is simply not written rather than landing on pad 1.
//
// Returns what it did, because "apply a genre" is an undoable action and the
// caller has to be able to say what changed.
export function applyGenre(song, id, seed = 1) {
  const bars = buildScenes(id, seed);
  if (!bars) return null;
  const tempo = genreTempo(id, seed);
  let written = 0;
  song.scenes.forEach((scene, si) => {
    const bar = bars[si % bars.length];
    scene.cells.forEach((cell) => {
      const lane16 = bar[cell.name];
      for (let s = 0; s < cell.steps.length; s++) cell.steps[s] = (lane16 && lane16[s]) || 0;
      if (lane16 && lane16.some(Boolean)) written++;
    });
  });
  song.bpm = tempo.bpm;
  song.swing = tempo.swing;
  return { id, label: GENRES[id].l, bpm: tempo.bpm, swing: tempo.swing, lanes: written };
}
