# SKRiMPAD — $50K Creative Direction

Same eight disciplines as doc 01, applied to the product that already exists in
this repo. This is deliberately **not** the same design system in different
colours — SIDECHAIN is an engineer's void; SKRiMPAD is a machine you can touch.
Where the two docs make opposite decisions, that's the point.

Everything below is grounded in what's actually here: 20 pads, a 20×16 step
sequencer, 14 onboard voices, a dual-oscillator synth, a 6-mode keyboard, an FX
chain, a 4-track looper, an AI composer, a resizable studio layout, **50 skin
files at 32 tokens each**, and four editions at $0 / $3 / $6 / $9 shipping to
Android, Windows and the browser.

---

## 00 — The premise in one line

**SKRiMPAD is a machine, and the website should let you play it before it asks
you for anything.**

Not a video of the app. Not a carousel of screenshots. The hero is a 3D
groovebox, rendered like it costs $1,200, wired to the real audio engine that
already lives in `android/app/src/main/assets/index.html`. You hit a pad with
your mouse and you hear the actual product. Nobody in this category does that,
because most of them can't — their engine is a native binary. Yours is already
a web app. **Your biggest competitive advantage is that your product runs in
the page it's being sold on.**

Everything in this document is built on that one fact.

---

## 01 — Creative Direction

### 01.1 The positioning problem, stated plainly

I'd be a bad creative director if I designed around this instead of saying it.

**$9 for the flagship is a pricing problem masquerading as a value proposition.**
You have a DAW, a synth, a sequencer, an AI composer, MIDI + BLE, 50 skins, and
three platforms. At $9 one-time, the price *is* the review: it tells a buyer
this is a hobby project before they've heard a sound. No amount of art direction
fixes a price that undercuts its own product.

Two ways up, and either works with the direction below:

- **Keep it one-time, raise it.** $0 / $19 / $34 / $49. Same tiers, same
  content, same page. This is the smaller change and it will very likely make
  you more money at lower volume with better-behaved customers.
- **Split it.** Free forever on the browser, then **$8/mo or $59/yr** for
  everything, and a **$99 lifetime** for the people who hate subscriptions.
  Recurring revenue is what turns this from a project into a business, and the
  auto-update system you already built is the justification for it.

Two things that do not change either way: **Live stays genuinely free, in the
browser, with no account**, and the free tier has to be good enough to be
somebody's actual daily driver. That's the funnel.

> The rest of this document assumes the higher price points. If you keep $3/$6/$9,
> everything still applies except §01.7 — but the site will always look more
> expensive than the thing it's selling, which is its own kind of wrong.

### 01.2 Positioning

- **Category:** groovebox. Not "beat maker app," not "music software." A
  groovebox is a specific, respected, tactile thing with a 30-year lineage, and
  that word does more positioning work than a paragraph would.
- **For:** the person who has an idea *right now* and no patience for a session
  template. On the bus, at work, at 2am.
- **Against:** the DAW. A DAW asks you to set up. SKRiMPAD asks you to play.
- **The promise:** *Boots in a second. Sounds like you meant it.*
- **The tagline:** **"First riff, not first setup."** — you're already using
  "First Riff Method" in the footer; that's a better line than anything on the
  page above it. Promote it.

### 01.3 Brand voice

SIDECHAIN speaks like an engineer. SKRiMPAD speaks like a **musician who's been
up too late** — short, physical, slightly impatient, funny without trying.

| Say | Never say |
| --- | --- |
| "Hit something." | "Explore our intuitive interface." |
| "Twenty pads. Bank A, B, C." | "A comprehensive suite of tools." |
| "It boots in a second because we didn't put a splash screen on it." | "Optimized for performance." |
| "Fifty skins. Yes, fifty." | "Extensive customization options." |

The register is confident and slightly dry. Never exclamation marks. Never
"unleash your creativity."

### 01.4 Sitemap

```
/                         The machine. One-page scroll.
  #hero                     Play it
  #sound                    What it actually sounds like
  #machine                  Exploded view → the four editions
  #skins                    The wall of 50
  #anywhere                 Phone → desktop, same session
  #ai                       The console
  #pricing
  #faq
/app                      Live edition. Free, no account, instant.
/editions                 Standalone comparison table (ad traffic)
/skins                    Full gallery + "make your own" JSON docs
/docs                     MIDI mapping, skin schema, file formats
/changelog                Ship log — you release often; show it
/thanks                   Post-purchase: key + downloads (exists, needs a redesign)
```

`/skins` and `/docs` are quiet SEO and trust assets. A documented, importable
JSON skin format is a *developer-grade* signal in a consumer category, and it
costs you nothing because the schema already exists.

### 01.5 Typography

| Role | Family | Why |
| --- | --- | --- |
| Display | **Archivo** (variable, `wght` 400–900, `wdth` 62–125) | Wide, heavy, industrial. Reads as a machine legend, not a SaaS header. Free, Google Fonts, variable. |
| Panel / data | **Martian Mono** (variable) | Actual hardware-legend energy. Used for BPM, step numbers, pad labels, prices, filenames. |

**The rule that makes it ownable:** Archivo has a real **width axis**, and this
is a music product — so **the display type widens on the beat.** At the current
BPM, `font-variation-settings: 'wdth'` oscillates between 108 and 116 on beat 1
of each bar. It's a 7% change; nobody will consciously see it; everybody will
feel that the headline is breathing in time with the machine.

That's a genuinely distinctive idea that costs one line of CSS and a
`requestAnimationFrame`, and no template has it.

```css
--t-display: clamp(3rem, 9vw, 9rem);      /* hero wordmark / headline       */
--t-h1:      clamp(2.25rem, 5vw, 4rem);
--t-h2:      clamp(1.5rem, 2.8vw, 2.25rem);
--t-body:    clamp(1.0625rem, 1.1vw, 1.1875rem);   /* 17–19px               */
--t-legend:  0.6875rem;                   /* Martian Mono, 0.18em tracked   */
```

Display: `wght 800`, `wdth 112`, `letter-spacing -0.03em`, `line-height 0.9`.
Panel legends: `UPPERCASE`, `0.18em`, `--mute`.

> The current site uses `font: 15px/1.6 system-ui` for everything
> (`site/index.html:23`). 15px system-ui is the single biggest reason that page
> reads as a template. Fixing just this line and the measure is worth more than
> any effect below.

### 01.6 Colour — the site runs on the product's own skins

This is the idea.

You have **50 skin files, 32 tokens each, already checked in.** They are a
complete, coherent, hand-built design-token system that you built for the app —
and the marketing site should consume them directly. Same files, no fork.

```
skins/skrimpad-skin-*.json   →   :root { --bg, --surf, --surf2, --surf3,
                                          --bdr, --txt, --mute, --red …
                                          --kick, --snare, --hhat, --clap … }
```

**What this buys you:**
1. A **skin switcher in the site's nav** that recolours the entire page *and the
   3D machine* live, from the real product files. Not a mockup — the actual
   thing the app does.
2. The `#skins` section stops being a screenshot gallery and becomes the most
   convincing feature demo on the page, because the visitor is standing inside
   it.
3. Zero design-token maintenance. Ship a new skin to the app and the site
   inherits it.
4. Anyone who spends 30 seconds clicking through skins has just experienced the
   product's headline feature and doesn't know it. That's the conversion event.

**Default skin: `black-gold`.** It's the most expensive-looking file you have,
and it sets the register for everything else:

```
--bg    #0C0A06     --txt    #F5EFE0     --red    #FFD700
--surf  #161511     --mute   #877E64     --teal   #FFE87C
--surf2 #21201C     --bdr    #464441     --purple #FFD024
--surf3 #2E2C28                          --kick   #C9A227
```

Warm near-black, bone text, brass. Nothing on the page is `#FFFFFF` or `#000000`.

**Rules on top of the skin system:**
1. The site defines **no colours of its own.** Every colour is a skin token. If
   a design needs a colour the schema doesn't have, the schema gets the token —
   and the app gets it too. One source of truth.
2. **Contrast is enforced in code, not by eye.** 50 skins is 50 chances to ship
   an unreadable page. Write a build-time check that computes contrast for
   `--txt` on `--bg` and `--mute` on `--surf` for every file and fails the build
   under 4.5:1 and 4.0:1 respectively. You've already done this work once in the
   app ("put a floor under readability" — commit `02fc80a`); reuse it.
3. The skin choice **persists** to `localStorage` and carries into `/app`, so
   the app boots in the skin they picked on the marketing page. That handoff is
   a tiny thing that feels enormous.
4. Skin transitions are **250ms on every token at once**, not a per-element
   stagger. The machine changes livery in one move, like a car wrap.

### 01.7 Conversion strategy

1. **Playing the hero is the top-of-funnel event, and it's free and instant.**
   No modal, no email, no "start free trial." Track it — % of visitors who hit
   a pad is your single most important metric, and it should be above 40%.
2. **The free Live edition is one click from the hero, and it is genuinely
   free.** `/app`, no account. The gap between "I made a noise on the website"
   and "I'm in the actual app" should be zero friction and under 1.5 seconds.
3. **Sell the upgrade inside the free app, not only on the site.** The site's
   job is to get them into `/app`. The app's job is to sell. A locked panel in
   the free tier that shows what it *would* do, with a price on it, converts
   far better than any pricing table — you already have the tiered feature
   gating to do this.
4. **The editions table has to make the middle tier obvious.** Four tiers is
   one more than most people can compare. Present them as `FREE` + a
   three-column paid table with the middle one visually dominant, and label
   the tiers by *what they are* rather than by internal codenames:

   | | **LIVE** | **STUDIO** | **VGA** | **SE** |
   | --- | --- | --- | --- | --- |
   | | Free | The one to get | The retro one | Everything |
   | | Browser | + DAW, banks, MIDI | + chiptune library, pixel world | + themed HUD, all 50 skins |

   "VGA" and "SE" mean nothing to a first-time visitor. The subtitle does the
   work the name can't.
5. **Show the platforms as a fact, not a badge row.** One line under the CTA:
   `Android · Windows 10/11 · any browser — one purchase covers all three.`
   That last clause is a real differentiator and it's currently buried in the
   FAQ (`site/index.html:250`).
6. **Fix the failure state.** `startCheckout()` currently ends in an
   `alert()` reading "isn't connected yet" (`site/index.html:312`). If a real
   visitor ever sees a browser alert dialog on a $50K site, the whole illusion
   is gone. Replace with an in-page inline state in the tier card itself, and
   make sure the backend is wired before launch so it never fires.

### 01.8 Storytelling spine

1. **Touch it.** (hero — you play the machine)
2. **Hear what's in it.** (the engine — 14 voices, real audio)
3. **See what it's made of.** (exploded view → the editions)
4. **Make it yours.** (50 skins, live)
5. **Take it anywhere.** (phone → desktop, same session)
6. **Ask it for a beat.** (AI console)
7. **Get it.** (pricing)

---

## 02 — The Cinematic Hero

### 02.1 Copy

```
                        POCKET TO DESKTOP · ONE ENGINE

                First riff,
                not first setup.

     Twenty pads, a sequencer, a synth and a DAW that boot in one second.
     Go ahead — hit something.

              [ ▸ Open the free studio ]     [ See the editions ]

   ◀ BANK A ▶        BPM ▚ 96 ▚        ●REC        Android · Windows · Browser
```

- "Go ahead — hit something." sits directly under the machine and is the only
  instruction on the page. It converts because it's an order, not an offer.
- The bottom row is a **real, working transport bar** — bank switcher, a BPM
  knob you can actually drag, and a record button that captures whatever you
  play and offers it back as a WAV. A visitor who exports a 4-bar loop from
  your homepage is a customer.

### 02.2 The 3D centrepiece — "The Machine"

A groovebox that does not exist, built as if it were being photographed for a
product launch.

**Form.** A single milled aluminium slab, ~360×240×34mm in world units, sitting
at a 22° tilt as if propped on a desk. Chamfered edges with a bright
diamond-cut highlight on the chamfer — that highlight is what makes CAD-looking
geometry read as a real manufactured object, and it's the detail most 3D web
heroes miss.

**Layout on the face** — matched to the real product, because it has to be:
- **20 pads** in a 5×4 arrangement, silicone, slightly proud of the surface,
  each with a subtle dome and a matte micro-texture.
- **Four rotary knobs**, knurled aluminium with a white indicator line —
  you already built real rotary knobs in the app (commit `a22c2c9`); these are
  their physical ancestors.
- **A 16-step LED strip** across the bottom, running the sequencer.
- **A small inset display** showing the current bank and BPM in Martian Mono,
  rendered as a live `CanvasTexture` so it actually updates.
- Screws. Four of them, real, in the corners. Recessed, with a slot. Nobody
  will notice them consciously and everybody will notice their absence.

**The behaviour that sells it:** **the pads light and depress under the
cursor, and they make the real sound.** Hover raises a pad 0.4mm and lifts its
emissive 15%. Click depresses it 1.2mm over 60ms and triggers the actual voice
from your engine. The pad's emissive follows the note's amplitude envelope, so
it **glows and decays exactly in time with the sound it made**. A kick's pad
flashes hard and dies fast; a pad's pad swells and hangs.

That coupling — light following the real envelope — is the single most
expensive-looking thing in this entire document, and it's essentially free
because your audio engine already exposes the envelope.

**Idle.** If nobody touches it for 6 seconds, the machine **plays itself**: a
16-step pattern runs, pads light in sequence, the LED strip chases. It stops
the instant the cursor enters the canvas. The site demonstrates the product to
an empty room, then hands over the moment somebody arrives.

### 02.3 Environment

Opposite decision to SIDECHAIN, deliberately. SIDECHAIN floats in a void;
SKRiMPAD **sits on something**.

- An infinite dark surface, roughness 0.9, with a very soft contact shadow and a
  faint reflection of the machine's underside. The surface is the skin's
  `--bg`; the machine sits in `--surf`/`--surf2`.
- No walls, no horizon line. The surface fades to fog at ~6 units.
- **A single practical light source off-frame upper-left**, warm, which the
  chamfer catches.
- **No particles.** A groovebox on a desk does not have dust motes orbiting it.
  This is where the SIDECHAIN direction would be wrong here — the restraint is
  the art direction.

### 02.4 Lighting

| Light | Type | Colour | Job |
| --- | --- | --- | --- |
| Key | Rect area 4×3, upper-left, 35° | `#FFF6E8` warm | The main form. Catches the chamfer. |
| Fill | Rect area 3×2, lower-right, very soft | `--surf3` tinted | Lifts the shadow side so the slab doesn't go black |
| Rim | Spot, hard, behind-left, narrow cone | skin `--red` accent at 30% | Separates the machine from the ground plane |
| Pads | **20 emissive materials, no lights** | per-pad skin token | Each pad's own glow. Emissive, not point lights — 20 point lights would destroy the frame budget for no visual gain. |

Shadows: one shadow-casting light only (Key), 1024² map, `PCFSoft`, tight
frustum around the machine. Everything else is unshadowed.

Environment: a 512px custom equirect with a bright soft rectangle upper-left and
a dim warm one lower-right. The reflection of that rectangle sliding across the
brushed top surface as the camera moves is 80% of the perceived render quality.

### 02.5 Materials

```
CHASSIS       MeshPhysicalMaterial
              base --surf2 · metalness 0.9 · roughness 0.34
              anisotropy 0.75, rotation 0 (brushed along the long axis)
              clearcoat 0.25
              128px brushed-normal map, tiled 8×1

CHAMFER       same, roughness 0.08 — a polished cut on a brushed face.
              This one value does more than any other in the scene.

PADS          MeshPhysicalMaterial
              base --surf3 · metalness 0.0 · roughness 0.62
              sheen 0.3, sheenColor --mute       (silicone reads as sheen)
              emissive = pad's skin token, intensity 0.05 idle → 2.4 on hit
              subtle 64px noise roughness map — silicone is never perfectly smooth

KNOBS         metalness 0.95 · roughness 0.22, knurl as a normal map not geometry
              indicator line: unlit --txt

DISPLAY       MeshBasicMaterial + CanvasTexture, 256×64
              + a 3% scanline overlay and 0.5px chromatic offset. Sells "screen."

GROUND        MeshStandardMaterial, --bg, roughness 0.92, metalness 0
```

### 02.6 Camera

- `fov: 28`. Even longer than SIDECHAIN's. Product photography, not gameplay.
- Resting: three-quarter view, slightly above, machine occupying ~52% of the
  frame width, offset **right of centre** on desktop so the headline owns the
  left third. Never centre a hero object under a centred headline — that's the
  template composition.
- **Idle:** 20s orbit of ±6° in yaw, ±2° in pitch. Just enough for the
  reflection to travel across the top surface. That travelling highlight is the
  whole reason for the idle move.
- **Mouse:** 0.08 parallax, 0.09 lerp. Slightly stronger than SIDECHAIN's
  because a physical object *should* respond to you more than an abstract one.
- **Do not** let the user free-orbit. Free orbit means they will find the
  unfinished back of the machine and the ugly angle. Constrain to ±18° yaw,
  −4°/+12° pitch, spring-limited at the edges.

### 02.7 Entrance (1.8s)

| t (ms) | Event |
| --- | --- |
| 0 | Black. |
| 0–300 | Ground plane fades up. Nothing else. |
| 200 | Machine drops in from +0.6 units, `--ease-drop` (a real spring — it has mass, it lands, it settles). Contact shadow tightens as it lands. |
| 500 | **It lands.** 3px screen-shake for 80ms. One low `--ease-drop` bounce. |
| 560 | Display flickers on: two frames of noise, then the boot legend `SKRiMPAD M2`. |
| 620 | Pads illuminate in a 5×4 sweep, 18ms apart, top-left to bottom-right — 360ms total. |
| 700 | Headline line 1, masked reveal per line. |
| 820 | Headline line 2. |
| 980 | LED strip runs one full 16-step chase and stops on step 1. |
| 1100 | Sub-copy + CTAs. |
| 1400 | Transport bar slides up from the bottom edge. |
| 1800 | Idle orbit begins. After 6s of no input, self-play starts. |

The whole entrance is a device booting. That's the concept and it earns the 1.8
seconds because it's also covering your shader compile.

### 02.8 Mouse interaction

- **Pads.** Raycast per pad. Hover: +0.4mm, emissive +15%, cursor becomes a
  ring with the voice name in Martian Mono (`KICK 01`). Click: depress 1.2mm /
  60ms, fire the real voice, emissive tracks the envelope.
- **Knobs.** Click-drag vertically to turn. They actually change something you
  can hear — put FILTER, DECAY, DRIVE and BPM on them. A visitor who turns a
  filter knob on your homepage and hears it sweep has been sold to more
  effectively than by any paragraph.
- **The LED strip is a step sequencer.** Click any of the 16 steps to toggle it
  for the currently selected pad. It plays. **The homepage is a working
  16-step sequencer**, and that sentence is the entire marketing campaign.
- **Cursor:** three states — default 8px dot; over the machine, a fine
  crosshair with a mono label; over a UI target, a 40px ring. Never a trailing
  blob.

### 02.9 Scroll transition out of the hero

The camera **descends to table height and pushes in on the machine's left
edge**, until the chassis fills the frame and the metal goes from object to
surface. That surface becomes the background of §02. You don't leave the hero;
you get closer to it than is comfortable.

Then, through the rest of the page, **the machine stays in the scene** and the
camera treats it as a set: sections are camera positions around and inside one
object. There is never a second 3D scene. That's what makes it feel like a film
rather than a slideshow.

---

## 03 — The 3D Visual World

### 03.1 Technology allocation

| Element | Tech | Why |
| --- | --- | --- |
| The machine (chassis, pads, knobs, strip) | **Three.js / R3F** | Needs raycasting, real materials, per-pad emissive. |
| Machine geometry | **Authored in Blender**, exported glTF + **Draco** | Do *not* build a convincing product form from primitives in code. Model it once, ~28k tris, and compress it. |
| Pad emissive envelopes | **Instanced mesh + per-instance attribute** | 20 pads, one draw call. Never 20 meshes. |
| Display readout | **CanvasTexture**, 256×64, redrawn only on change | |
| Contact shadow | **Baked AO texture** on the ground + one real shadow map | Half the cost, better result |
| Step sequencer grid (§ sound) | **SVG** | It's a grid of rectangles; WebGL is absurd here |
| Waveform / spectrum displays | **Canvas 2D** | |
| Skin swatches (all 50) | **CSS**, generated from the JSON at build time | 50 WebGL swatches would be architectural malpractice |
| Phone/desktop device morph (§ anywhere) | **SVG `<path>` morph** + CSS | A shape tween, not a 3D asset |
| App UI shots | **Static AVIF, 2×** | |
| Grain | **CSS** noise tile, 3%, over everything | |

**One canvas. One scene. One model.** Loaded once, ~600KB Draco-compressed,
reused by every section.

### 03.2 The skin pipeline

The part that makes this specific to you:

```
build time:  skins/*.json ──▶ scripts/build-skins.mjs
                              ├─ validate 32 tokens present
                              ├─ compute contrast, FAIL under 4.5:1 / 4.0:1
                              ├─ emit  app/skins.generated.css   (:root[data-skin="x"])
                              └─ emit  app/skins.generated.ts    (typed map for WebGL)

runtime:     pick skin ──▶ set  document.documentElement.dataset.skin
                       └─▶ scene.setSkin(map[name])
                             ├─ chassis.color      ← --surf2
                             ├─ pad[i].emissive    ← --kick / --snare / --hhat / …
                             ├─ ground.color       ← --bg
                             ├─ rim light          ← --red
                             └─ tween all over 250ms, one --ease-swap
```

The 3D materials take their colours from **the same 32 tokens as the CSS**.
When someone picks `vaporwave`, the page and the machine change together in one
move. That is the demo.

### 03.3 Performance budget

| | Budget |
| --- | --- |
| Draw calls | ≤ 11 (chassis, chamfer, pads×1 instanced, knobs×1 instanced, strip, display, ground, shadow) |
| Triangles | ≤ 34k |
| Textures | 5, none over 512², all KTX2/Basis compressed |
| Model transfer | ≤ 600KB Draco |
| GPU frame | < 8ms @ 1440p on an M1 / RTX 3050 |
| Shadow maps | 1 |
| Total first-view transfer | < 1.4MB (higher than SIDECHAIN — you're shipping a model, and it's worth it) |

### 03.4 Degradation

```
TIER A   desktop, WebGL2, ≥4 cores       full model, shadows, 20 live pads,
                                          audio engine loaded, sequencer live

TIER B   mobile / low-power              dpr ≤ 1.5, shadow map off (baked AO
                                          only), knurl normal maps dropped,
                                          pads still interactive + audible.
                                          Interaction survives; fidelity doesn't.

TIER C   no WebGL / reduced-motion       a pre-rendered 1600×900 AV1 turntable
                                          of the machine (6s, seamless, ≤420KB)
                                          — and, crucially, a **DOM pad grid**
                                          layered over it that still plays the
                                          real sounds. Reduced-motion = still
                                          frame + working DOM pads.
```

**The interaction is the product, so the interaction never degrades.** Drop
polygons, drop shadows, drop the model entirely — but a visitor must always be
able to hit a pad and hear it. That's the priority order, and it's the opposite
of how most 3D sites degrade.

---

## 04 — The Motion Language

### 04.1 The governing rule: mass, and the visitor's tempo

SIDECHAIN is quantised to a fixed 120 BPM. **SKRiMPAD is not quantised at all —
it's physical.** Everything on this site has weight, momentum and a spring.
Nothing on this site moves at a constant speed.

And the one thing that *is* rhythmic — the LED chase, the self-play pattern,
the headline's width-axis breathing, the section pulse — runs at **whatever BPM
the visitor has set on the hero knob.** Turn it to 174 and the whole site gets
faster. Turn it to 70 and the site gets heavy.

**The visitor sets the tempo of the website.** That is the ownable idea here,
and it's only possible because there's a real transport running in the page.

```css
/* springs — GSAP / Motion */
--ease-drop:  spring(1, 170, 12, 0);   /* hardware landing. overshoots once. */
--ease-press: spring(1, 400, 22, 0);   /* pad / button press. fast, tight.   */
--ease-swap:  cubic-bezier(0.65,0,0.35,1);  /* skin change, tab change       */
--ease-glide: cubic-bezier(0.22,1,0.36,1);  /* reveals                       */
--ease-out:   cubic-bezier(0.33,0,0.15,1);  /* leaving                       */

/* fixed durations, for things that aren't physical */
--d-press:  60ms;
--d-hover: 140ms;
--d-swap:  250ms;
--d-reveal:520ms;
--d-scene: 900ms;
```

### 04.2 Motion inventory

| Moment | Motion | Timing | Ease | Trigger |
| --- | --- | --- | --- | --- |
| **Load** | Machine drops and lands, boots, pads sweep | 1800ms | drop | assets ready |
| **Pad hover** | +0.4mm, emissive +15% | 140ms | glide | raycast |
| **Pad press** | −1.2mm, emissive → envelope | 60ms down, envelope up | press | pointerdown |
| **Knob drag** | 1:1 rotation, ±150°, snaps to detents with a 6° spring overshoot | live | press | drag |
| **Text reveal** | Per-**line** clip-path + 16px rise | 520ms, 80ms stagger | glide | 82% viewport |
| **Width breathing** | `wdth` 108↔116 on display type | 1 beat @ current BPM | swap | always |
| **Section reveal** | Camera moves to the next station; content rises 20px | 900ms | glide | scroll (scrubbed) |
| **Skin change** | All 32 tokens + all scene materials, simultaneously | 250ms | swap | click |
| **Button hover** | Fill sweeps from the cursor edge; label +2px | 140ms | glide | pointerenter |
| **Button magnetic** | max **7px**, radius 96px, lerp 0.15 | live | press | pointermove |
| **Button press** | scale 0.97 + 1px inset | 60ms | linear | pointerdown |
| **Sequencer step** | Step lights, LED strip advances | at BPM | linear | transport |
| **Edition tab swap** | The machine's exploded state animates between editions | 900ms | glide | click |
| **Nav on scroll** | 76px → 58px, hairline, blur | 250ms | glide | scrollY > 80 |
| **Route → /app** | The machine's display fills the viewport and the app boots inside it | 900ms ×2 | swap | click |

That last one is worth building properly: **navigating from the site to the app
looks like the app booting on the machine's screen.** The marketing site and
the product become one continuous object. It's a 40-line transition and it's the
kind of thing people screenshot.

### 04.3 What we deliberately do not do

- ❌ Per-character text stagger
- ❌ Free-orbit on the hero model
- ❌ Floating/bobbing the machine — it's sitting on a table, it has weight
- ❌ Particles anywhere
- ❌ Continuous rotation of anything
- ❌ Card tilt on hover
- ❌ Auto-playing audio on load (the machine is silent until clicked — always)
- ❌ Scroll-jacking
- ❌ Any CSS gradient that isn't derived from two skin tokens

### 04.4 Sound design (this product gets to have some)

An audio product is allowed audible UI, but under three hard rules:

1. **Nothing makes a sound until the user has made a sound.** The first pad hit
   is consent. Before that, absolute silence, no exceptions.
2. **A persistent, obvious mute in the transport bar**, state saved to
   `localStorage`.
3. **UI sounds come from the engine, not from a sample pack** — the pad clicks,
   the knob detents and the transport blips are synthesised by the same code
   that makes the music. They'll sound like they belong because they do.

---

## 05 — Sections as Experiences

The camera is one continuous path around and into one object.

### § 01 — HERO · "Play it"
Covered above. Camera: three-quarter, machine right of centre.

---

### § 02 — SOUND · "Fourteen voices. Here they all are."

**Layout.** Full-bleed. The camera has pushed into the chassis so the brushed
metal *is* the background. On it, a 20-track × 16-step grid rendered in SVG —
the real sequencer, at real proportions.

**Interaction.** It's a **working sequencer**. Click cells. Hit space to play.
There's a row of preset patterns (`BOOM BAP` / `DRILL` / `HOUSE` / `TRAP` /
`BREAKS`) that load in and play instantly. Each of the 20 lanes is coloured by
its skin token (`--kick`, `--snare`, `--hhat`…) — which is the moment the
visitor understands *why* the skins have 32 tokens instead of 4.

**Scroll behaviour.** The grid is pinned for 200vh. As you scroll, the camera
tracks slowly right along the chassis, and the grid scrolls with it through the
16 steps — you're reading the pattern like a score.

**Copy.** `Kicks, snares, hats, claps, toms, rides, crashes, perc, bass, FX. /
Fourteen synthesised voices, zero samples to download, no login to hear them.`

**CTA.** `[ Export this loop → ]` — gives them the WAV of whatever they just
made, no email required. That file, sitting in their Downloads folder with your
name on it, is a better retargeting asset than any pixel.

---

### § 03 — MACHINE · "What's in it"

**Layout.** The set-piece. The camera pulls back and the machine performs a
slow **exploded view** — chassis, pad deck, sequencer strip, and internals
separating along the Z axis, each layer labelled in Martian Mono with a thin
leader line.

**The mapping to editions is the concept:** each exploded layer *is* a tier.

| Layer | Edition | What lights up |
| --- | --- | --- |
| Pad deck + strip | **LIVE** — free | Pads and sequencer glow; everything behind is dark and wireframe |
| + Signal board | **STUDIO** | DAW, plugin rack, banks A/B/C, MIDI ports light up on the board's edge |
| + Cartridge slot | **VGA** | A chiptune cartridge slides into a slot on the side; the display switches to a pixel font; the pixel characters appear on-screen |
| + Front panel | **SE** | The themed HUD skins the entire chassis; the REVOLVE orbit runs around the machine |

**Interaction.** Four tabs above. Clicking a tier animates the machine between
exploded states over 900ms. **The comparison table is the machine.** Hovering
any feature name in the list highlights the physical part it corresponds to.

**Scroll behaviour.** Pinned 400vh, one tier per 100vh, so scrolling alone walks
you up the ladder — the upsell is the scroll direction.

**CTA.** Sits at the SE state: `[ Get the whole machine → ]`.

---

### § 04 — SKINS · "Fifty. Live. Right now."

**Layout.** A dense, edge-to-edge wall of **all 50 skins** as small swatch tiles
— each tile a miniature of the machine's face using that skin's real tokens,
rendered in CSS from the generated file. Not a carousel. Not "a selection."
All fifty, at once, because the quantity *is* the argument.

**Interaction.** Hover a tile: it lifts 4px and its name appears in mono.
**Click it and the entire page and the 3D machine change to it in 250ms.**
The wall stays; the world around it re-skins.

**Scroll behaviour.** The wall scrolls at 0.94 parallax against the section
heading. Nothing else moves. The section is loud enough already.

**The detail that closes it.** A 51st tile at the end, dashed border:
`+ YOUR OWN`. It opens a small panel showing the actual 32-token JSON schema
with a drop zone. Drop a JSON in, the site skins to it. **You can theme the
marketing site with a file you wrote.** That's a five-hour build and it will get
you posted about.

**Copy.** `Fifty skins in the box. Thirty-two colours each, all editable. /
Drop your own JSON in — the app keeps it forever, right beside ours.`

---

### § 05 — ANYWHERE · "Same session, every screen"

**Layout.** Split, but not a 50/50 card split — a **single continuous device
that morphs.** One SVG path, scroll-scrubbed, tweening from a phone in portrait
→ a tablet → a desktop window. The UI *inside* it re-flows at each step, using
your real responsive breakpoints (commit `d68fc30`).

**3D event.** The camera pulls back far enough that the machine becomes small
and sits on a desk beside the morphing screen. Scale established.

**Scroll behaviour.** Pure scrub, 1:1 with the scrollbar, `linear`. The user's
finger is doing the morph.

**Copy.** `Made it on the bus. Finished it on the desktop. / One purchase covers
Android, Windows and the browser.`

---

### § 06 — AI · "Tell it what you want"

**Layout.** The camera pushes all the way into the machine's inset display until
it fills the viewport. The section takes place *inside the screen.*

**Interaction.** A real, working text input. Three suggested prompts as chips:
`make a drill beat at 140` · `what key is this in` · `warm up the synth`. Type
or click one, and **the sequencer from §02 fills in and plays.** Live. It's the
same engine.

**Scroll behaviour.** Locked while inside the display; the boundary is the
screen bezel entering and leaving frame.

**Copy.** `It listens in plain English and then it does the thing. / Key
detection, drum patterns, melodies — in the app, not in the cloud.`

> If any of that runs server-side, say so plainly here. "Runs on your device"
> is a real selling point in 2026, and claiming it falsely is the kind of thing
> that ends up in a comment thread.

---

### § 07 — PRICING

Camera returns to the hero position. Full circle — you end where you started,
looking at the machine, now knowing what it is.

Four tiers per §01.7. **No scroll animation beyond a 20px rise.** People are
deciding.

Under the table, one mono line: `One purchase · Android + Windows + browser ·
free updates forever · rolls back if a build ever fails to start.` That last
clause is a genuinely unusual engineering promise and it belongs on the pricing
page, not in the FAQ.

---

### § 08 — FAQ + FOOTER

Seven questions. First: `Is the free version actually free?`

**Footer:** the machine powers down. Pads fade out in reverse of the boot
sweep, the display shows `— — —` then goes dark, the contact shadow softens
and the ground fades. Wordmark, then real links in small mono. Last frame of
the film.

---

## 06 — Building It With Claude

**Stack:** same as doc 01 — Next.js 15 · React 19 · TS · Tailwind v4 · R3F +
drei · GSAP + ScrollTrigger · Lenis. Plus **Blender** for the model and
`gltf-transform` for Draco/KTX2 compression.

The order matters more here than in doc 01, because there's a real audio engine
and a real model to integrate.

### Step 0 — Extract the engine first
Before any design work. The 776KB single-file app in
`android/app/src/main/assets/index.html` contains the synthesis code the hero
needs. Get it out and make it importable.

> Read `android/app/src/main/assets/index.html` and identify the Web Audio
> synthesis code: the voice definitions for the 14 onboard sounds, the ADSR
> envelope implementation, and the transport/sequencer clock. Extract them into
> a standalone ES module `packages/engine/src/index.ts` exporting
> `createEngine()` with `trigger(voice, velocity)`, `setBPM(n)`,
> `setPattern(grid)`, `start()`, `stop()`, and an `onEnvelope(cb)` subscription
> that reports per-voice amplitude at ~60Hz. Do not change any DSP behaviour —
> the sounds must be bit-identical to the app. Add a Vitest suite that renders
> each voice offline via `OfflineAudioContext` and snapshots its RMS envelope,
> so a refactor can't silently change the sound.

This module then serves the website *and* becomes the shared core the app can
migrate to. It's the highest-leverage hour in the whole project.

### Step 1 — Skin pipeline
> Write `scripts/build-skins.mjs` (Node, ESM, no deps). Read every
> `skins/skrimpad-skin-*.json`. For each: assert all 32 tokens are present;
> compute WCAG contrast for `--txt` on `--bg` and `--mute` on `--surf`; exit 1
> listing every file under 4.5:1 and 4.0:1 respectively. Emit
> `app/skins.generated.css` with one `:root[data-skin="<name>"]{…}` block per
> skin, and `app/skins.generated.ts` exporting a typed
> `Record<SkinName, Record<Token, string>>`. Wire it to `prebuild` and
> `predev`. Print a summary table of every skin and its two contrast ratios.

Run it. Expect failures — 50 hand-made palettes will not all pass. Fix the
files, not the threshold.

### Step 2 — Tokens & shell
> Create `app/globals.css`. Import `skins.generated.css`. Set the default skin
> to `black-gold` on `<html data-skin="black-gold">`. Add the type scale and
> timing/easing blocks from [paste §01.5 and §04.1]. Load Archivo (variable,
> `wght` + `wdth`) and Martian Mono via `next/font/google`. Add `.u-legend`
> (Martian Mono, uppercase, 0.18em, `--mute`) and `.u-measure` (62ch). Every
> colour in the entire stylesheet must be `var(--token)` from the skin schema —
> no literal hex anywhere. Then build `components/Nav.tsx` with the skin picker
> as a dropdown of all 50, persisting to `localStorage`.

### Step 3 — Static sections
> Build sections 02–08 from [paste §05] as static, responsive, non-animated
> React components. Real copy, real semantics, real pricing table, `<details>`
> FAQ. The §04 skin wall renders all 50 tiles from `skins.generated.ts` in
> pure CSS. No canvas yet. It must be complete and beautiful with JS off.

**Deploy. Check it on your phone. Fix the type and spacing before continuing.**

### Step 4 — The engine in the page (before the 3D)
> Wire `@skrimpad/engine` into a **DOM** pad grid and a **DOM** 16-step
> sequencer in sections 01 and 02. Real audio, real transport, BPM knob as an
> `<input type="range">` styled as a knob, working export-to-WAV via
> `OfflineAudioContext`. `AudioContext` must be created lazily on the first
> user gesture, never at load. Add a persistent mute in the transport bar.

At the end of step 4 you have a site that plays. **That's already better than
every competitor's homepage** and there is still no 3D in it. If you shipped
here, you'd have shipped something good.

### Step 5 — The model
> In Blender: model the machine per [paste §02.2 and §02.5] — chassis with
> chamfer, 20 pads as a single instanced source, 4 knobs, 16-step strip,
> display plane, 4 screws. Target 34k tris. Separate materials for chassis /
> chamfer / pad / knob / strip / display. UV-unwrap for the brushed normal map
> only. Export glTF, then:
> `gltf-transform optimize machine.glb machine.opt.glb --texture-compress ktx2 --compress draco`
> Verify under 600KB.

### Step 6 — The scene
Four prompts, separately:

> **6a.** `components/Scene.tsx`: one fixed R3F Canvas behind the DOM,
> `dpr={[1,2]}`, fog `--bg`, `PerspectiveCamera` fov 28. Load `machine.opt.glb`
> with `useGLTF` + Draco + KTX2 loaders and `<Suspense>`. Position per §02.6.
> Confirm ≤ 11 draw calls with `r3f-perf`.

> **6b.** Materials per §02.5, all colours read from the current skin map.
> Convert the 20 pads to a single `InstancedMesh` with a per-instance
> `aEmissive` float attribute. Lighting per §02.4 — exactly one shadow caster,
> 1024² PCFSoft, tight frustum. Custom 512px equirect env, generated in code,
> no downloaded HDRI.

> **6c.** Raycast the pad instances. Hover: +0.4mm and emissive +15%. Click:
> −1.2mm over 60ms and call `engine.trigger()`. Subscribe to `onEnvelope` and
> write each voice's amplitude into `aEmissive` every frame. Add the knobs
> (vertical drag, ±150°, 6° detent overshoot) wired to real engine params, and
> make the LED strip a clickable 16-step toggle for the selected pad.

> **6d.** Camera: 20s idle orbit ±6°/±2°, mouse parallax 0.08/lerp 0.09,
> constrained to ±18° yaw and −4°/+12° pitch with spring limits. Then a
> `CatmullRomCurve3` scroll path through the §05 station positions, scrubbed
> `linear` by ScrollTrigger. Then the §03 exploded view as a separate GSAP
> timeline driven by the tier tabs and by scroll position.

### Step 7 — Skin → scene binding
> On skin change, tween every scene material colour and the rim light to the
> new tokens over 250ms with `--ease-swap`, simultaneously with the CSS
> variables. One function, one timeline, no per-element stagger. Handle it
> during the exploded view without popping.

### Step 8 — Tiering, then polish
> Implement §03.4, keeping pad interaction and audio alive in all three tiers.
> Then audit against [paste §07] and fix in ranked order.

### Working practice
Same five rules as doc 01, plus one specific to this build:
**every time you touch the engine module, run the offline snapshot tests.** The
whole concept rests on the website making the app's real sounds; a silent
regression there is the one bug that would matter.

---

## 07 — The $50K Audit

### 07.1 The current site, specifically

I read `site/index.html`. It's a competent, fast, well-structured page — the
information architecture is genuinely fine and the FAQ answers the right
questions. It just looks like a template, and here's exactly why, ranked by
impact:

| # | Issue | Where | Fix |
| --- | --- | --- | --- |
| 1 | **`font: 15px/1.6 system-ui`** for the entire site | `:23` | Archivo + Martian Mono, body to 17–18px, measure to 62ch. Biggest single win available. |
| 2 | **The pink→purple→cyan diagonal gradient** on the logo, headline, buttons, badges and prices | `--grad`, `:19` and 8 uses | Delete `--grad` entirely. Flat skin tokens. This gradient is *the* 2024–2026 generated-site signature and it's currently on every prominent element. |
| 3 | **Emoji as feature iconography** (🥁 🎚️ 🤖 🎹 🎨 ⬇️) | `:151–156` | Replace with SVG line icons at 1.5px, or better, tiny live SVG meters/pads that actually animate. |
| 4 | **Three grids of identical rounded cards** — features, tiers, steps, all the same shape | `.feat`, `.tiers`, `.steps` | Only pricing keeps a grid. Features become the exploded machine (§03); steps become the 60-second timeline. |
| 5 | **Three radial blobs behind the hero at `blur(70px)`** | `.hero .glow`, `:46` | This is the default "AI landing page" background. Replace with the machine. |
| 6 | **`alert()` on checkout failure** | `:312` | Inline state in the tier card. A native alert dialog destroys every impression the page has built. |
| 7 | **No hero visual at all** — the product is never shown | hero | The machine. |
| 8 | **`◆` and `○` as list bullets** | `:86–87` | A 1.5px check / dash icon, or nothing at all — indentation and colour can carry it. |
| 9 | **`🎉` emoji in the post-purchase overlay** | `:340` | This is the highest-emotion moment in the funnel and it's currently a party popper. Make it the machine's display showing the license key. |
| 10 | Section padding is a flat `64px` everywhere | `section{padding:64px 0}` | Spacing scale `8/16/24/40/64/104/168`; sections at 104 mobile / 168 desktop. |
| 11 | Tier prices in the body font | `.tier .price` | Martian Mono, tabular figures. |
| 12 | Light mode is an inversion of 6 variables | `:112–115` | Design it, or drop it. A half-done light mode is worse than none. |

None of that is a criticism of the engineering — the page is 19KB, works with no
build step, has a sensible CORS-aware backend and degrades safely. It's a good
*page*. It's just wearing the default costume.

### 07.2 The general rules

Tiers 1–3 from doc 01 §07 apply here unchanged. The additions specific to a
hardware-metaphor 3D site:

| # | Weakness | Fix |
| --- | --- | --- |
| 13 | The 3D object floats with no contact shadow | It sits on a surface. Contact shadow + reflection. An object with no contact reads as a PNG. |
| 14 | Every edge on the model is a hard 90° | Chamfer everything ≥ 0.4mm and give the chamfer a low-roughness material. Real objects have no perfectly sharp edges, and the eye knows. |
| 15 | Downloaded studio HDRI | Custom 512px equirect. |
| 16 | Uniform roughness across the model | Brushed top (0.34), polished chamfer (0.08), matte silicone pads (0.62), matte ground (0.92). Material contrast is what makes a render read as photography. |
| 17 | Free orbit on the hero | Constrain to ±18°. |
| 18 | The model bobs or spins | It's on a table. It has mass. It doesn't move; the *camera* does. |
| 19 | UI sound plays on load | Silence until the first user gesture. Always. |
| 20 | Skins shown as static screenshots | They're live. Make them live. It's the whole feature. |

### 07.3 The one question to ask about this site
**"Did they let me play it?"** If a visitor leaves without having made a sound,
the design failed regardless of how it looks.

---

## 08 — Polish, Performance & Launch

### 08.1 Targets

| Metric | Target |
| --- | --- |
| LCP | < 2.0s (LCP element is the headline; the model loads after) |
| INP | < 100ms — **critical**, this is an instrument; pad latency is perceptible |
| **Pad-hit → audible sound** | **< 25ms** — the one number that matters most on this site |
| CLS | < 0.02 |
| Total JS | < 300KB gzip (three + engine) |
| Model | < 600KB |
| First-view transfer | < 1.4MB |
| Lighthouse mobile | ≥ 90 perf / 100 a11y / 100 SEO |

That 25ms figure deserves its own test in CI. If hitting a pad on the homepage
feels laggy, the visitor concludes the *product* is laggy, and no amount of
render quality recovers from that.

### 08.2 Assets
- **Model:** Draco + KTX2, loaded with `<Suspense>` after first paint, never
  blocking LCP.
- **Textures:** 5 max, ≤512², KTX2/Basis. The brushed normal is 128px tiled.
- **Audio:** the engine is synthesis, so there are no audio downloads — say
  this on the page (`no samples to download`), because it's genuinely unusual
  and it's a performance story your competitors can't tell.
- **Skin swatches:** pure CSS from generated tokens. Zero images for all 50.
- **Fonts:** Archivo variable subset to Latin (one file, both axes), Martian
  Mono subset to Latin + digits + the handful of symbols used.
- **Images:** AVIF/WebP, `srcset` 1×/2×, lazy below the fold.

### 08.3 WebGL & audio
- `dpr` capped at 2; pause the render loop on `visibilitychange` and when the
  canvas leaves the viewport.
- **Suspend the `AudioContext` when the tab is hidden** and resume on return —
  a page making sound in a background tab is the fastest way to get closed
  forever.
- Dispose the model, all materials and all textures on unmount; watch the R3F
  StrictMode double-mount in dev.
- Cap frame delta at 1/30s.
- Test the audio path on: iOS Safari (the strictest autoplay policy — your
  gesture-gating must be correct), Android Chrome, Firefox (different
  `AudioWorklet` behaviour), and Safari on Intel macOS.

### 08.4 Accessibility
- **The pad grid must be keyboard playable.** Each pad is a real `<button>` in
  the DOM layered over the canvas, labelled with its voice name, triggered by
  Enter/Space. Number keys 1–9 and Q–P as shortcuts, documented on the page.
  A music instrument that only works with a mouse is an instrument a lot of
  people can't use.
- Canvas `aria-hidden`; every fact it shows also exists in the DOM.
- **Contrast enforced across all 50 skins by the build script** — this is the
  a11y risk unique to this project and the pipeline in §03.2 is the mitigation.
  Do not ship a skin the script rejects.
- Reduced motion: still frame + fully working DOM pads and sequencer.
- Respect `prefers-reduced-transparency` and `prefers-contrast: more`.
- Every demo clip and any spoken audio gets a transcript.

### 08.5 SEO
- `<title>`: `SKRiMPAD — a groovebox for your phone, desktop and browser`
- JSON-LD: `SoftwareApplication` with `operatingSystem: "Android, Windows, Web"`
  and an `offers` array for all four tiers, plus `FAQPage`.
- `/skins` is a real SEO asset — 50 named palettes with a documented schema is a
  page people link to. Give each skin a fragment URL (`/skins#vaporwave`) that
  loads the site in that skin.
- OG image rendered from the actual hero, per-skin if you want to be clever
  about social variety.
- `sitemap.xml`, `robots.txt`, canonicals, and `/thanks` marked `noindex`.

### 08.6 Launch checklist

**Content**
- [ ] Pricing decision made (§01.1) and matching Stripe/PayPal/Play exactly.
- [ ] Every edition's feature list verified against what the build actually ships.
- [ ] All 50 skins pass the contrast gate.
- [ ] The AI section's claims are literally true, including where it runs.
- [ ] Refund policy, terms, privacy, and a real support address.

**Build**
- [ ] `npm run build` clean; engine snapshot tests green.
- [ ] Pad-hit → sound measured under 25ms on a mid-range Android.
- [ ] No `console.log`; no secrets in the client bundle.
- [ ] The `alert()` in the checkout path is gone and the backend is live —
      run one real end-to-end purchase per payment method, per edition, and
      confirm the key issues and the download unlocks.
- [ ] `/thanks` redesigned and tested with both the Stripe (`?session=`) and
      PayPal (`?license=`) return shapes.
- [ ] 404 / 500 designed.

**Cross-device**
- [ ] iPhone SE, iPhone 15 Pro, Pixel 6a, iPad both orientations, 1440p, ultrawide.
- [ ] Safari / Chrome / Firefox / Edge, and Safari on Intel macOS.
- [ ] Landscape phone.
- [ ] Slow 4G: page usable and pads audible before the model arrives.
- [ ] Reduced motion: complete and playable.
- [ ] **Every one of the 50 skins loaded and eyeballed at 375px.** Fifty
      screenshots. It's an hour and it will catch two or three broken ones.

**Instrumentation**
- [ ] Events: first pad hit (**the key metric**), sequencer play, pattern
      preset used, WAV exported, skin changed (+ which), edition tab viewed,
      `/app` opened, each purchase CTA, checkout started, purchase completed.
- [ ] Sentry with WebGL tier and skin name as tags.
- [ ] Uptime on `/`, `/app`, and the backend.

**The last two**
- [ ] **Hand your phone to someone who has never seen it and say nothing.**
      Count the seconds until they make a sound. If it's over 15, the hero
      isn't doing its job.
- [ ] **Turn the canvas off and look at the site.** If the DOM pad grid, the
      sequencer, the skin wall and the type still make you want the product,
      you've built a $50K site. The 3D is the amplifier — it was never
      supposed to be the argument.
