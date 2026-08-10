# SIDECHAIN — $50K Creative Direction

> **Status of this document.** The brief asked for a *new* product — something
> that does something new, is already in demand, and is proven to make money —
> and did not name it. This document names it, argues the market, and then
> gives it a full agency-grade creative direction across all eight disciplines.
> If you already had a different product in mind, sections **01.1–01.3** are the
> only product-specific ones; the visual, motion, 3D, build and launch systems
> below transfer to any product with a "signal" metaphor at its core.

---

## 00 — The premise in one line

**SIDECHAIN makes anything you record sound like it was mixed by someone
expensive.** You drop in a video or a voice track. It comes back scored,
ducked, de-noised, cut on the beat, and loudness-matched to whatever platform
it's going to. One upload, one minute, one file back.

The name is the mechanic. *Sidechaining* is the studio technique where the
music automatically ducks out of the way of the voice. That single behaviour —
**one signal making room for another** — is the product, the logo, the colour
system, the motion language, and the hero animation. Every decision in this
document traces back to it.

---

## 01 — Creative Direction

### 01.1 Why this category is proven

The honest version, because a $50K deck that lies gets found out in the first
client meeting:

Creators already pay, separately, for the three things this product does in one
pass.

| The job | What they pay for it today | Proof it's a market |
| --- | --- | --- |
| **Music that's legally safe** | Subscription stock-music libraries, advertised in the ~$10–25/mo range for individual creators | Multiple well-funded incumbents, all subscription, all still growing |
| **Audio that doesn't sound like a phone** | One-click speech-enhancement tools; some free, some bundled into paid editors | The free tiers exist *specifically* because the demand is enormous — it's a funnel, not a hobby |
| **Cutting long video into shorts** | AI clipping tools at consumer SaaS price points | Category went from nothing to crowded in about two years, which only happens when money is visibly there |

> **Verify before this goes in a pitch deck.** Do not put specific ARR or
> revenue figures on a slide on my say-so. Pull them yourself from the
> companies' own posts, press, or funding announcements the week you present.
> The *structural* argument above stands on its own and doesn't need numbers:
> three separate paid products, one workflow, nobody bundling them.

**The gap.** Every one of those tools solves the *visual* or the *licensing*
problem. None of them solve the **mix**. A creator can have a legally-clean
track, a de-noised voice, and a snappy cut, and it still sounds amateur —
because the music is sitting on top of the voice instead of underneath it, the
cuts don't land on the beat, and the whole thing is 6 LUFS off what the platform
wants. That last mile is the thing only an engineer knows how to do, it takes
30–90 minutes a video by hand, and it is completely automatable.

**Your unfair advantage.** You have already shipped a real-time audio engine, a
synthesis library, an FX chain with compression and saturation, key detection,
and a cross-platform delivery pipeline (web + Android + Electron). SIDECHAIN is
not a new competency for you. It is your existing engine pointed at a market
that pays monthly.

### 01.2 Positioning

- **Category:** post-production audio, automated.
- **For:** the creator who is good at talking and bad at mixing — podcasters,
  YouTube essayists, course sellers, agencies cutting client UGC at volume.
- **Against:** "AI video editor." SIDECHAIN is deliberately *not* an editor.
  It's a finishing service. It sits after the edit, before the upload.
- **The promise:** *Sounds like a studio. Takes a minute.*
- **The proof we lead with:** an A/B toggle. Raw vs SIDECHAIN. Same clip. The
  visitor hears the difference in four seconds. This is the single most
  important conversion asset on the site — everything else supports it.

### 01.3 Brand voice

Engineer, not hype-man. Short declaratives. Real units — LUFS, dB, ms, BPM —
used correctly, because using them correctly is the credibility signal to the
people who'll pay. Never "revolutionary," never "unleash," never "supercharge."

| Say | Never say |
| --- | --- |
| "Ducked 6 dB under the voice." | "AI-powered audio magic." |
| "−14 LUFS. Ready for upload." | "Professional-grade sound!" |
| "Your cuts, on the grid." | "Take your content to the next level." |
| "It's 40 seconds. Then it's done." | "Lightning-fast processing." |

Headline rhythm rule: **the second line always undercuts the first.** Big claim,
then a flat technical fact. That cadence *is* the voice.

### 01.4 Sitemap

Deliberately shallow. This is a conversion site, not a content site.

```
/                     One-page cinematic scroll (the whole pitch)
  #hero                 The envelope. A/B listen.
  #problem              "Why your audio sounds like that"
  #how                  Three moves: DUCK / CLEAN / LAND
  #proof                Before/after gallery — 6 real clips
  #speed                The 60-second timeline
  #pricing              3 tiers
  #faq                  7 questions, no more
/studio               The app itself (post-signup)
/pricing              Standalone, for ad traffic that skips the story
/for/podcasters       Landing variant — same system, different proof clips
/for/agencies         Landing variant — volume/API angle, seat pricing
/legal/licensing      The music-rights page. Boring on purpose. Trust asset.
/changelog            Ship log. Proof of life.
```

Nav is four items and one button: `How it works · Proof · Pricing · Docs ·
[ Try one free ]`. No mega-menu. No "Resources."

### 01.5 Typography

Two families. Never a third.

| Role | Ideal (licensed) | Free, ships today | Usage |
| --- | --- | --- | --- |
| Display / UI | **PP Neue Montreal** | **Geist** (or Inter Display) | Everything |
| Data / meters | **PP Fraktion Mono** | **Geist Mono** (or JetBrains Mono) | Numbers, units, timecode, LUFS, filenames |

**The rule that makes it look expensive:** *every number is monospaced, every
word is not.* Type a "−14 LUFS" in mono next to a sentence in the grotesk and
the page instantly reads as an instrument rather than a landing page. This one
rule does more work than any 3D effect on the page.

**Scale** (fluid, `clamp()`, 1.25 ratio at the small end opening to ~1.4 at the
display end):

```css
--t-display: clamp(3.25rem, 8.5vw, 8.5rem);   /* hero only, once per page   */
--t-h1:      clamp(2.5rem, 5.5vw, 4.5rem);    /* section openers            */
--t-h2:      clamp(1.75rem, 3vw, 2.5rem);
--t-h3:      clamp(1.125rem, 1.6vw, 1.375rem);
--t-body:    clamp(1rem, 1.1vw, 1.125rem);    /* 17–18px. never 15px.       */
--t-small:   0.875rem;
--t-meta:    0.75rem;                          /* mono, tracked +0.14em      */
```

**Non-negotiables:**
- Display sizes get `letter-spacing: -0.035em` and `line-height: 0.92`. Tight
  and heavy. Body gets `-0.011em` / `1.55`.
- Body copy measure capped at **62ch**. Nothing wider. Ever.
- Mono meta is `UPPERCASE`, `letter-spacing: 0.14em`, `--mute` colour.
- Exactly **one** display-size element on the page. The hero. If a second one
  appears, the hero stops being the hero.

### 01.6 Colour — the system that sidechains

This is the idea I'd defend hardest in the room.

There are **two accent signals**, and they behave like a real sidechain
compressor: **when one is loud, the other ducks.** Amber is the voice — human,
warm, the thing that must always be heard. Cyan is the bed — the music, the
machine, the environment. They are never both at full intensity in the same
viewport. As you scroll, the page hands the emphasis back and forth, and the
handoff is the visual signature of the brand.

```css
:root{
  /* ground */
  --void:    #07090B;   /* page. near-black, faint blue cast              */
  --panel:   #0E1216;   /* raised surfaces                                */
  --panel-2: #151B21;   /* inputs, wells                                  */
  --line:    #232C34;   /* 1px hairlines                                  */
  --line-hi: #35424D;   /* hairline on hover / focus                      */

  /* text */
  --bone:    #EDE7DD;   /* primary. warm off-white, NOT #fff              */
  --mute:    #8595A1;   /* secondary. 4.9:1 on --void                     */
  --faint:   #55636D;   /* tertiary, mono meta only, never body copy      */

  /* the two signals */
  --key:     #FF9A3C;   /* VOICE  — amber                                 */
  --key-dim: #7A4A1C;   /* voice, ducked                                  */
  --bed:     #4FD8FF;   /* MUSIC  — cyan                                  */
  --bed-dim: #1E5C6E;   /* music, ducked                                  */

  /* state */
  --ok:      #4ADE9B;   /* in range                                       */
  --clip:    #FF4A5E;   /* over. used exactly twice on the whole site.    */
}
```

**Rules:**
1. `--key` and `--bed` never touch at full saturation. If one is at 100%, the
   other is at its `-dim` value. Enforced per-section, animated on scroll.
2. `--clip` red appears **twice** on the entire site: on the "before" waveform
   in the hero A/B, and on the over-limit meter in the problem section. Its
   scarcity is what makes it mean something.
3. Pure white (`#FFFFFF`) appears **zero** times. Bone only. This is the
   single fastest way to stop a dark site looking like a template.
4. Gradients are **never** decorative. The only gradients on the site are the
   two signal ribbons in the 3D scene, and they're generated by the shader, not
   by CSS. No `linear-gradient(120deg, purple, cyan)` anywhere. That gradient
   is the tell that a site was generated, and it is currently on your SKRiMPAD
   page — see doc 02.

**Light mode:** ship it, but as a *different room*, not an inversion. Ground
becomes `#F4F1EC` (warm paper, not grey), panels `#FFFFFF`, text `#0D1114`,
hairlines `#DED8CF`. Signals keep their hue but drop ~12% lightness so they
survive on paper. Test both — a dark-only site in 2026 reads as a choice you
didn't make.

### 01.7 The conversion strategy

Five things, in priority order. Everything else is decoration.

1. **The A/B is above the fold and it is a real audio player.** Not a video of
   a player. Two buttons: `RAW` / `SIDECHAIN`. Same clip, crossfaded instantly
   on click so the difference is undeniable. Autoplay is off; a single click
   starts it. This asset does more selling than the entire rest of the page.
2. **The free unit is one whole file, not a watermarked teaser.** "Try one
   free" means one complete, downloadable, unmarked render. The product has to
   be good enough that one is enough to sell the second. If it isn't, the
   pricing is not the problem.
3. **No signup before value.** Upload → process → *then* an email field to
   collect the download. You've already delivered; asking now converts far
   better than asking at the door.
4. **Price on the platform, not the minutes.** Creators think in *videos per
   week*, not in processing minutes. Tiers are named for output volume.

   | | **SOLO** | **CHANNEL** | **STUDIO** |
   | --- | --- | --- | --- |
   | | $19/mo | $49/mo | $149/mo |
   | Renders | 10 /mo | 60 /mo | 400 /mo |
   | Length cap | 20 min | 90 min | 4 hr |
   | Music bed library | Core | Full | Full + stems |
   | Loudness targets | YT / TikTok / IG | + Spotify, podcast, broadcast | + custom presets |
   | Seats | 1 | 1 | 5 |
   | API | — | — | Yes |
   | | | **Most creators** | |

   Annual = 2 months free, shown as the default toggle. The middle tier is
   visually largest and is the only one with the accent border — nobody should
   have to think about which one to pick.
5. **The licensing page is a conversion asset, not a legal chore.** "Can I get
   copyright-struck?" is the #1 objection in this category. Answer it on its
   own page, in plain English, with the actual grant text quoted. Link it from
   pricing. Boring, plain, high-trust — deliberately the least designed page on
   the site.

### 01.8 Storytelling spine

The page is a five-beat argument, and each beat owns one scroll-section:

1. **This is what a mix looks like.** (hero — the envelope, breathing)
2. **Here's what's wrong with yours.** (the problem — clipped, flat, buried)
3. **Three moves fix it.** (duck / clean / land)
4. **Here it is, done, on real clips.** (proof)
5. **It took a minute.** (speed → price → go)

If a section can't be assigned to one of those five beats, it doesn't ship.

---

## 02 — The Cinematic Hero

### 02.1 Copy

```
                    ANY MIC. ANY ROOM. ANY PLATFORM.

              Your voice,
              out in front.

     Music that ducks. Noise that's gone. Levels that land.
     Drop a file in — get it back mixed, in about a minute.

        [ ▸ Hear the difference ]     [ Try one free → ]

        ── RAW ──────●──────── SIDECHAIN ──         −14 LUFS · 00:38
```

- Eyebrow: mono, `--faint`, `0.14em` tracked.
- Headline: two lines, display scale, `--bone`. The word **out** carries the
  only `--key` amber on the line. One accented word. Not three.
- Sub: 2 lines max, 62ch, `--mute`.
- Primary CTA is *listening*, not buying. The buy CTA is secondary until they've
  heard it. This inversion is intentional and it is the whole conversion thesis.
- The bottom row is a real, working A/B slider with live mono readouts.

### 02.2 The 3D centrepiece — "The Envelope"

A single object. Not a scene full of floating shapes.

Two ribbons of extruded geometry hang in dark space, running left-to-right
across the viewport like a strip of film or a strip of tape:

- **The bed** (cyan) — a wide, smooth, continuous ribbon. Brushed-aluminium
  material with a faint anisotropic sheen. It is the music.
- **The key** (amber) — a narrower, more agitated ribbon riding above it. It's
  the voice: irregular, bursty, alive.

**The behaviour that sells it:** wherever the amber ribbon has energy, the cyan
ribbon *physically dents* — carved down and away, like a heavy object pressing
into foam, then springing back with a slow release. The dent is not a texture.
It is real vertex displacement driven by the actual amplitude envelope of the
audio playing in the A/B player. **When the visitor plays the demo clip, the
sculpture reacts to it.** Mute or paused, it idles on a synthetic 120 BPM
envelope so it's never static.

That's the entire hero. One object, one behaviour, and the behaviour is the
product.

### 02.3 Environment

- **Void, not a room.** No floor, no horizon, no grid. `--void` fog with a
  density that swallows the ribbons at ~40 units so they read as infinite.
- Two soft volumetric shafts, well off-axis, catching only the ribbon edges.
  They're there to define the ribbons' silhouette, not to light the scene.
- **A single very slow dust field** — ~400 particles, 3px, additive, drifting
  at 0.02 units/s with slight Brownian wander. Purpose: to give the void a
  sense of scale and depth. If you remove them the scene reads flat. If you add
  4,000 of them it reads like a screensaver. 400.

### 02.4 Lighting

Three lights, all of them doing a specific job:

| Light | Type | Colour | Intensity | Job |
| --- | --- | --- | --- | --- |
| Key | Rect area, 8×2, upper-left, aimed down-right | `#FFF3E4` | 4.2 | Defines the top edge of both ribbons |
| Bed rim | Rect area, 6×1, lower-right, behind | `#4FD8FF` | 2.8 | Separates the cyan ribbon from the void |
| Voice bounce | Point, travelling, parented to the loudest point of the amber ribbon | `#FF9A3C` | 0.6→2.4 (audio-driven) | The amber ribbon *emits* — it lights the dent it's making |

That third one is the detail that makes it look rendered rather than
real-time: the voice ribbon casting warm light down into the valley it just
carved. Cheap to do, enormously effective.

Environment: a small custom HDR — a 512px equirect gradient with two soft
highlights baked in. **Do not** ship a downloaded studio HDRI; the recognisable
softbox reflections are a dead giveaway and cost 2–8MB.

### 02.5 Materials

```
BED RIBBON      MeshPhysicalMaterial
                base #0F2933 · metalness 0.85 · roughness 0.28
                anisotropy 0.6, rotation aligned to the ribbon's length
                clearcoat 0.4 / clearcoatRoughness 0.25
                emissive #4FD8FF, intensity driven by (1 − duckAmount)

KEY RIBBON      MeshPhysicalMaterial
                base #2B1607 · metalness 0.15 · roughness 0.5
                emissive #FF9A3C, intensity driven by envelope amplitude
                transmission 0.15 — it glows slightly from within

DUST            PointsMaterial, additive, 3px, opacity 0.35, --bone
```

The bed reads as **machined metal**. The key reads as **hot filament**. Machine
vs human. That contrast is the whole brand in two materials.

### 02.6 Camera

- 35mm equivalent, `fov: 32`. Long lens. Compresses depth, makes the ribbons
  feel large and close. Wide-angle here would make it look like a game.
- Resting position: slightly below the ribbons, looking up along their length —
  the classic hero-shot low angle. Ribbons vanish toward the horizon.
- **Idle:** a 24-second figure-eight drift, amplitude ±0.4 units. Barely
  perceptible. Never stops.
- **Mouse:** parallax at **0.06 strength**, damped with a 0.08 lerp. This is
  much less than instinct says. Strong mouse-parallax is the #1 tell of an
  amateur WebGL hero. It should feel like the object has weight, not like it's
  glued to the cursor.
- **On the beat:** an 8-frame, 0.4% dolly-in on beat 1 of each bar. Sub-conscious.
  The visitor feels a pulse they can't point at.

### 02.7 Entrance (2.0s, one bar at 120 BPM)

| t (ms) | Event |
| --- | --- |
| 0 | Black. Only a 1px amber hairline across the centre of the viewport. |
| 0–500 | The hairline **stretches** horizontally out past both edges — `--ease-attack`. |
| 400 | Hairline thickens and resolves into the amber key ribbon; camera pulls back revealing it has depth. |
| 500–1000 | Cyan bed ribbon rises *from below the frame* into position under it. Fog resolves. Dust fades in. |
| 750 | Headline line 1 masks up (`clip-path` reveal, per-line, not per-character). |
| 875 | Headline line 2 masks up. |
| 1000 | **First duck.** The amber ribbon fires, the bed dents, the bounce light flashes. This is the money frame. |
| 1125 | Sub-copy fades + 12px rise. |
| 1250 | CTAs scale from 0.96 with a spring. |
| 1500 | A/B strip slides up from the bottom edge. |
| 2000 | Idle loop takes over. Scroll hint appears (a single amber tick that pulses on beat 1). |

**Never** stagger the headline per-character. Per-character text reveals are the
most reliable signal that a site was generated by an AI in 2024–2026. Per-line
masked reveals are what actual film-title and agency work uses.

### 02.8 Mouse interaction

- **Parallax** — 0.06, as above.
- **The cursor is a probe.** Move over the ribbons and a small mono readout
  trails the cursor showing the value at that point: `−6.2 dB`, `120 ms`,
  `4.1 kHz`. Numbers that are *actually derived from the geometry under the
  cursor*, not random. It turns idle mousing into product education.
- **Click and hold anywhere on the scene** — you become the key input. The bed
  ducks under your cursor for as long as you hold. Release, and it springs back
  over 380ms. Visitors discover this by accident and then do it eight times.
  That's eight seconds of dwell you didn't have to buy.

### 02.9 Scroll transition out of the hero

Not a fade. A **camera move**, so the page reads as one continuous space:

Over the first 100vh of scroll, the camera **rolls 90°** — the ribbons rotate
from horizontal to vertical and recede — and the viewer descends *past* them
into the problem section. The ribbons stay in the scene, now running as two
vertical rails down the left and right edges of the viewport, and they remain
there for the entire rest of the page: a persistent frame, ducking and
releasing as each section takes emphasis. **The hero object never leaves.** It
becomes the site's chrome.

That's the difference between "a 3D hero" and "a 3D site."

---

## 03 — The 3D Visual World

### 03.1 Technology allocation

Deciding what is *not* WebGL is the senior decision here.

| Element | Tech | Why |
| --- | --- | --- |
| The two signal ribbons | **Three.js / R3F**, custom vertex + fragment shader | Needs real-time audio-driven displacement. Nothing else can do it. |
| Dust field | **Three.js** `Points`, single draw call | Trivial cost inside a scene that already exists |
| Volumetric shafts | **Faked** — two additive planes with a soft gradient texture, always facing camera | Real volumetrics cost 4–6ms/frame for a look nobody can distinguish from this |
| Waveforms in the proof section | **Canvas 2D** | 60fps, 1/20th the cost of WebGL, and it's a 2D problem |
| Meters, LUFS dials, knobs | **SVG** + CSS transforms | Crisp at any DPR, animatable, accessible, ~2KB total |
| Section backgrounds / grain | **CSS** — a tiled 128px noise PNG at 3% opacity, `background-repeat` | A shader for grain is pure waste |
| The "60 seconds" timeline | **SVG path** + `stroke-dashoffset` | One element, scrubs perfectly with scroll |
| Product UI screenshots | **Static WebP/AVIF**, 2× | Do not rebuild your app UI in WebGL |
| Testimonial / clip thumbnails | **AV1 video**, muted, `poster`, `preload="none"` | |

**One WebGL canvas for the entire site.** Fixed, `100vh`, `z-index: 0`, behind
all DOM content, driven by scroll progress. Not one canvas per section. This is
what keeps it at 60fps and what makes it feel like a single continuous world.

### 03.2 The shader that does the work

The duck is a single displacement function on the bed ribbon's vertices, and
it's worth specifying because everything depends on it:

```glsl
// per-vertex, bed ribbon
// uEnv[]  : 64-tap amplitude envelope of the key signal, uploaded per frame
// uTime, uAttack (0.04s), uRelease (0.38s)

float x    = (position.x + uLength * 0.5) / uLength;   // 0..1 along the ribbon
float env  = sampleEnvelope(uEnv, x);                  // 0..1 voice energy here
float duck = smoothstep(0.0, 1.0, env);

// the dent: deeper in the middle of the ribbon's width, feathered at the edges
float across = 1.0 - abs(position.y / uWidth * 2.0);
float dent   = duck * uDepth * pow(across, 1.6);

vec3 p = position;
p.z -= dent;                                  // press it away from camera
p.y -= dent * 0.35;                           // and slightly down — gravity
p.z += sin(x * 22.0 + uTime * 1.4) * 0.012;   // idle life. subtle.
```

Fragment side: `emissiveIntensity = mix(0.9, 0.15, duck)` — **the bed literally
dims as it ducks.** Amber rises as cyan falls. The colour system, the audio
behaviour, and the shader are the same idea expressed three ways.

### 03.3 Performance budget

Hard numbers, enforced in CI:

| | Budget |
| --- | --- |
| Draw calls | ≤ 14 |
| Triangles | ≤ 48k |
| Textures | 3 (noise, env gradient, dust sprite) — none over 512² |
| Shader compile | < 90ms, warmed during the entrance animation |
| GPU frame time | < 8ms @ 1440p on an M1 / RTX 3050 |
| WebGL bundle (three + R3F + drei subset) | < 190KB gzip |
| Total page transfer, first view | < 1.1MB |

### 03.4 Graceful degradation — three tiers, chosen at runtime

```
TIER A  desktop, WebGL2, dpr ≥ 1.5, > 4 logical cores
        → full scene, dpr capped at 2, dust on, audio-reactive on

TIER B  mobile, or low-core desktop, or dpr < 1.5
        → dpr capped at 1.5, dust off, envelope taps 64 → 24,
          bounce light baked to a static emissive, no shadow maps

TIER C  no WebGL, prefers-reduced-motion, or 3 consecutive frames > 32ms
        → canvas is destroyed; a pre-rendered 1600×900 AV1 loop of the hero
          (≤ 380KB, 6s, seamless) takes its place. On reduced-motion it's a
          single still frame at the money moment (t = 1000ms).
```

**Tier C must be authored, not an accident.** Render that loop from the real
scene and check it in. A hero that falls back to a blank div is how a $50K
site becomes a $500 site on someone's work laptop.

---

## 04 — The Motion Language

### 04.1 The governing rule: the site is quantised

**Every duration on this site is a subdivision of 120 BPM.** No 300ms. No 450ms.
No "0.3s ease". If the visitor never consciously notices, good — they'll still
feel that the whole page shares a pulse, because it does.

```css
:root{
  --bar:  2000ms;   /* section transitions, scene changes       */
  --half: 1000ms;   /* hero lines, big reveals                  */
  --beat:  500ms;   /* section elements, cards, images          */
  --e8th:  250ms;   /* buttons, toggles, nav                    */
  --e16:   125ms;   /* hover, focus, cursor                     */
  --e32:    62ms;   /* press-down, tick marks                   */
}
```

### 04.2 The easing set — named after the compressor

Five curves. Not one more.

```css
--ease-attack:  cubic-bezier(0.22, 1.00, 0.36, 1.00); /* fast in, hard stop  */
--ease-release: cubic-bezier(0.33, 0.00, 0.15, 1.00); /* slow, long tail     */
--ease-duck:    cubic-bezier(0.65, 0.00, 0.35, 1.00); /* symmetric, for A↔B  */
--ease-spring:  spring(1, 90, 14, 0);                 /* GSAP / Motion only  */
--ease-linear:  linear;                               /* scrub-linked ONLY   */
```

Assignment is fixed and non-negotiable:
- Anything **appearing** → `--ease-attack`
- Anything **leaving** → `--ease-release`
- Anything **swapping state** (A/B, tabs, tier toggle) → `--ease-duck`
- Anything **physical** (buttons, knobs, drag) → `--ease-spring`
- Anything **tied to the scrollbar** → `--ease-linear`, always, no exceptions.
  Eased scroll-scrubbing feels broken because the user's finger *is* the
  easing.

### 04.3 The full motion inventory

| Moment | Motion | Timing | Ease | Trigger | Why it exists |
| --- | --- | --- | --- | --- | --- |
| **Load** | Amber hairline → ribbon, per the hero table | `--bar` | attack | Fonts + shader ready | Buys the compile time and looks intentional |
| **Text reveal** | Per-**line** `clip-path` inset from 100%→0, +14px y | `--half`, 90ms line stagger | attack | `scrollTrigger` @ 82% viewport | Reads as film titling. Per-character reads as AI. |
| **Numbers** | Count-up on mono figures, 2 decimals held | `--half` | release | In view, once | Makes data feel measured |
| **Section reveal** | The section's content rises 24px + fades; the WebGL rails re-duck to hand emphasis to this section's signal colour | `--beat` | attack | 70% viewport | The colour handoff *is* the section transition |
| **Parallax** | Content layers at 1.0 / 0.94 / 0.88 depth | scrub | linear | Scroll | Depth without the "everything floats" look |
| **Camera** | One continuous scroll-driven path through the whole page; sections are camera *positions*, not separate scenes | scrub | linear | Scroll | The reason it feels like one journey |
| **Buttons — hover** | Bg fills from the cursor's x-position; label shifts 2px toward the fill | `--e16` | attack | pointerenter | Cheap, tactile, directional |
| **Buttons — magnetic** | Translate toward cursor, max **6px**, radius 90px, lerp 0.14 | continuous | spring | pointermove in radius | 6px. Not 20. 20px magnetism looks like a demo. |
| **Buttons — press** | scale 0.975, 1px inset shadow | `--e32` | linear | pointerdown | Sells physicality more than the hover does |
| **A/B toggle** | Waveform morphs between the two datasets while audio crossfades | `--e8th` | duck | click | The morph makes the audio change *visible* |
| **Cursor** | 8px bone dot, 0.5 lerp. Grows to 44px ring w/ mono label over interactive targets. Becomes a **crosshair + readout** over the WebGL canvas. | `--e16` | attack | pointermove | Three states, each meaningful. Not a blob that trails everything. |
| **Pricing toggle** | Prices roll like an odometer, monthly↔annual | `--e8th` | duck | click | |
| **Nav on scroll** | Bar contracts 72px→56px, hairline appears, bg blur 0→14px | `--beat` | attack | scrollY > 80 | |
| **Page → /studio** | Amber ribbon sweeps L→R over the viewport, covers, uncovers on the new route | `--half` ×2 | duck | route change | The brand element does the transition. Not a generic wipe. |
| **The pulse** | The rails brighten 4% on beat 1 of each bar, sitewide, always | `--bar` loop | duck | always | The heartbeat. Remove it and the site dies. |

### 04.4 What we deliberately do not do

Listing these is as much a part of the direction as the list above. Each one is
a specific tell:

- ❌ Per-character text stagger
- ❌ Scroll-jacking / snap-scroll — never take the scrollbar from the user
- ❌ Anything rotating continuously for no reason
- ❌ A tilt on every card
- ❌ Marquee ribbons of logos moving at 40px/s
- ❌ Blob/gradient mesh backgrounds
- ❌ A custom cursor that just replaces the arrow with a bigger circle
- ❌ Reveal animations on elements already visible at load
- ❌ More than one thing animating in the same 250ms window

### 04.5 Accessibility

```css
@media (prefers-reduced-motion: reduce){
  *{ animation-duration:.01ms !important; transition-duration:.01ms !important }
}
```
…plus, in JS: kill the ScrollTrigger scrub, freeze the camera at each section's
end-state, swap the canvas for the Tier-C still, disable magnetism and the
custom cursor. **Every piece of content must be reachable and legible with all
motion off.** If a section only makes sense while it's animating, it's badly
designed.

---

## 05 — Sections as Experiences

The camera path is one continuous move. These are its stops.

### § 01 — HERO · "The Envelope"
Covered in full above. Camera at origin, looking along the ribbons.

---

### § 02 — PROBLEM · "This is what it looks like when it's wrong"

**Layout.** Full-bleed. No cards. A single enormous waveform runs edge-to-edge
across the viewport — **the visitor's-eye view of a bad mix.** It is visibly
clipped: flat-topped, squared off, and the clipped peaks are the first of only
two appearances of `--clip` red.

**Camera.** Descended and rolled 90° from the hero; the ribbons are now vertical
rails at the far left and right edges. The bed rail is at full cyan here — the
music is winning, and that's the problem.

**Interaction.** Three mono labels sit on the waveform at specific points, and
hovering each one *changes the audio playing*:
- `CLIPPED · +2.4 dBFS` → you hear the distortion
- `MUSIC OVER VOICE · +3 dB` → you hear the vocal buried
- `−22 LUFS · 8 dB UNDER TARGET` → you hear it go quiet against a reference

**Scroll behaviour.** As you scroll through, the waveform scrubs horizontally in
1:1 sync with scroll position — you are scrubbing a timeline. At the end of the
section the waveform hits the clipped section and the whole viewport flashes
`--clip` for exactly one frame (16ms). Once. That single frame is the emotional
low point of the page.

**Copy.** `Nobody says "the audio was bad." / They just don't finish watching.`

**CTA.** None. This section is allowed to have no CTA. It's the setup.

---

### § 03 — HOW · "Three moves"

**Layout.** Three full-height panels, but **not three cards side by side.** The
camera *travels between three stations* along the ribbons — each move is a
distinct place in the 3D world, and you arrive at it.

| | **01 DUCK** | **02 CLEAN** | **03 LAND** |
| --- | --- | --- | --- |
| Camera | Tight on the dent forming | Pulled back, top-down on the key ribbon | Wide, both ribbons, level |
| 3D event | Real-time duck at 6dB, visible | Noise "shaved" off the key ribbon — high-frequency vertex jitter smooths away over 1s | Both ribbons snap to a horizontal guide line — the target level |
| Signal colour | Amber leads, cyan dimmed | Amber only, cyan at `--bed-dim` | Both, balanced, equal — the only moment on the site they share |
| Number shown | `−6.0 dB` | `−31 dB noise floor` | `−14.0 LUFS` |
| Copy | "The music gets out of the way. Automatically, every syllable." | "Room, hiss, hum, plosives. Gone, and your voice still sounds like you." | "Every platform wants a different level. It hits all of them." |

**Scroll behaviour.** Pinned for 300vh, three stations at 0/33/66%. Content
crossfades on `--beat`; the camera moves on `--bar`. Because the camera arrives
before the copy, each station feels like a place you got to.

**The § 03 → § 04 handoff.** At station 3 the two ribbons align to the guide
line — and that guide line **becomes the top border of the proof section.** The
transition is one continuous graphic element changing role.

---

### § 04 — PROOF · "Six clips. Raw and done."

**Layout.** A 6-item grid — but the grid is **asymmetric on purpose**: 2 items
at 5 columns, 1 at 2, 2 at 4, 1 at 6, on a 12-col grid, rows of varying height.
Uniform grids of six identical cards is the exact look we're avoiding.

**Each item** is a still frame + a 2-channel waveform + an inline `RAW ⟷ DONE`
toggle. Clicking any item's toggle **stops all others** — only one thing plays
on this page at a time, always.

**Content.** Six genuinely different sources, chosen to pre-empt objections:
a phone-recorded talking head; a two-mic podcast with room echo; a noisy café
interview; a screen-recorded course module; a car vlog; a live-event clip with
crowd noise. Each labelled with the *actual* source device in mono type. The
specificity is the credibility.

**Scroll behaviour.** Items rise at three slightly different parallax rates
(1.0 / 0.96 / 0.92) so the grid breathes. No tilt. No scale-on-hover — hover
raises the item 4px and brightens its hairline, and that's all.

**CTA.** `[ Try it on your worst file → ]` — inviting the hard case is a
confidence signal, and it's the highest-converting CTA on the page.

---

### § 05 — SPEED · "About a minute"

**Layout.** One horizontal SVG timeline, edge to edge, scrubbed by scroll. A
single amber playhead travels it. Beneath it, stage labels tick past in mono:

```
00:00 UPLOAD ─── 00:04 ANALYSE ─── 00:11 SEPARATE ─── 00:26 DUCK + CLEAN
   ─── 00:44 SCORE ─── 00:52 MASTER ─── 00:58 ▸ DONE
```

**3D event.** The rails run a full sweep in sync — the entire scroll of this
section is one continuous duck-and-release across the whole ribbon length.

**Detail that matters:** the numbers are the *real* median stage times from
your own pipeline, updated from telemetry. If they're real, put them on the
page. If they're not real yet, don't invent them — say "about a minute" and
show no numbers until they are.

**Copy.** `Faster than making coffee. / Considerably faster than learning to mix.`

---

### § 06 — PRICING

**Layout.** Three columns, the middle one taller, wider and the only one with a
`--key` hairline and a soft amber bloom behind it. Annual/monthly toggle above,
annual selected by default.

**3D event.** The rails converge toward the centre column — the geometry itself
points at the tier we want sold. Sounds gimmicky written down; at 8% intensity
it's invisible and it works.

**Scroll behaviour.** Nothing clever. **Pricing is the one section that does not
animate on scroll beyond a plain 24px rise.** People are making a decision here;
movement is a tax on that. Restraint at exactly this moment is what separates
expensive work from busy work.

**Below the tiers.** One line, mono, `--mute`: `Cancel any time · Every render
is yours to keep · Music cleared for commercial use →` with that last clause
linking to the licensing page.

---

### § 07 — FAQ + FOOTER

Seven questions. The first is `Will I get copyright-struck?`. Accordion, 250ms
height + opacity, chevron rotates 90° not 180°.

**Footer** is where the camera path ends: the ribbons converge to a single point
at the horizon and the wordmark sits at that vanishing point. The last thing on
the page is the two signals finally becoming one. Then a hairline, then real
links in small mono type. No newsletter modal. No cookie banner theatre.

---

## 06 — Building It With Claude

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 ·
React Three Fiber + drei · GSAP 3 with ScrollTrigger · Lenis for smooth scroll ·
Vercel.

Work **in this order**. The most common way these builds fail is starting with
the 3D. Build the page as a flat, fast, correct HTML document first; the WebGL
goes in behind it at step 5, and if it were deleted the site would still work.

### Step 0 — Scaffold
```
npx create-next-app@latest sidechain --typescript --tailwind --app --eslint
cd sidechain
npm i three @react-three/fiber @react-three/drei gsap lenis
npm i -D @types/three
```

### Step 1 — Design tokens
> Create `app/globals.css` for a Next.js 15 + Tailwind v4 project. Define these
> CSS custom properties on `:root` exactly as given, then re-declare only the
> colour tokens under `@media (prefers-color-scheme: dark)` guarded as
> `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`.
> [paste the colour block from §01.6, the type scale from §01.5, and the
> timing + easing blocks from §04.1–04.2]
> Add a `.u-mono` utility (Geist Mono, uppercase, 0.14em tracking, --faint) and
> a `.u-measure` utility capping width at 62ch. Set `body` to `--void`/`--bone`
> explicitly. No other CSS.

### Step 2 — Layout shell
> Build `app/layout.tsx` and `components/Nav.tsx`. Nav: fixed, 72px, contracts
> to 56px with a 14px backdrop-blur and a `--line` bottom hairline once
> `scrollY > 80`, transitioning over 500ms with
> `cubic-bezier(0.22,1,0.36,1)`. Left: wordmark `SIDECHAIN` in Geist at 800,
> `-0.04em`. Right: four text links in 14px `--mute` and one primary button.
> Mobile: links collapse into a full-screen overlay that wipes in from the right
> over 250ms. Load Geist and Geist Mono via `next/font/local` with
> `display: swap`. Semantic HTML, keyboard accessible, visible focus rings using
> `--key`.

### Step 3 — All sections, static
> Build sections 02–07 from [paste §05 of this doc] as plain, non-animated,
> fully responsive React server components in `components/sections/`. Real copy
> from the doc, real semantic headings (one `h1`, then `h2` per section), real
> `<table>` for pricing, `<details>` for FAQ. Grid via Tailwind on a 12-column
> layout with the asymmetric spans specified for the proof section. No
> animation, no canvas, no placeholder lorem. It must look finished and be
> perfectly readable with JavaScript disabled.

**Deploy here.** Get it on Vercel, look at it on your phone, fix the typography
and spacing until the *static* page already looks expensive. Everything after
this point is amplification — and amplifying something that isn't right yet is
how sites end up cluttered.

### Step 4 — Motion layer
> Add GSAP + ScrollTrigger and Lenis (`lerp: 0.085`). Create
> `hooks/useReveal.ts` implementing the per-**line** clip-path reveal from
> §04.3 — split on lines using a wrapper with `overflow:hidden`, never per
> character. Apply to every heading and lede. Add the magnetic button (max 6px,
> radius 90, lerp 0.14) and the three-state cursor. Wrap everything in a
> `prefers-reduced-motion` guard that no-ops all of it. Use the `--beat`/`--e8th`
> variables via `getComputedStyle`, not hard-coded numbers.

### Step 5 — The WebGL scene
Four separate prompts. Do not ask for all of it at once.

> **5a.** Create `components/Scene.tsx`: one R3F `<Canvas>`, fixed, inset-0,
> `z-0`, `pointer-events-none` except over the hero, `dpr={[1, 2]}`,
> `gl={{ antialias:true, powerPreference:'high-performance' }}`. Fog `#07090B`,
> density 0.028. A `PerspectiveCamera` at fov 32. Nothing in the scene yet but a
> single test box. Confirm it renders behind the DOM and doesn't block scroll.

> **5b.** Add the two ribbons: `PlaneGeometry(40, 2.2, 256, 12)` each, with a
> custom `ShaderMaterial` for the bed implementing the displacement in §03.2.
> Pass `uEnv` as a 64-float uniform array; for now fill it from a synthetic
> 120 BPM envelope (`pow(fract(t*2), 4)` shaped). Materials per §02.5.

> **5c.** Add lighting per §02.4, the 400-point dust field, and the two faked
> volumetric planes. Then the camera: an idle 24s figure-eight, mouse parallax
> at 0.06 with 0.08 damping, and a `ScrollTrigger`-scrubbed path through the
> section positions in §05, using a `CatmullRomCurve3` so the camera never
> snaps.

> **5d.** Wire the audio: a `WebAudio AnalyserNode` on the A/B player;
> downsample `getFloatTimeDomainData` to 64 taps with attack 40ms / release
> 380ms envelope following; push to `uEnv` each frame. When paused, crossfade
> back to the synthetic envelope over 500ms so it never jumps.

### Step 6 — Tiering and fallback
> Implement the three-tier system in §03.4. Detect at mount: WebGL2 support,
> `navigator.hardwareConcurrency`, `devicePixelRatio`, and a rolling frame-time
> monitor that demotes a tier after 3 consecutive frames over 32ms. Tier C
> unmounts the Canvas entirely and renders `<video>` with the pre-rendered loop,
> or a still if reduced-motion. Log the chosen tier once to analytics.

### Step 7 — Polish
> Audit the built site against [paste §07 of this doc]. Fix in ranked order.
> Then: add `next/image` with AVIF+WebP for every raster, `preload` the two
> fonts, add JSON-LD `SoftwareApplication` + `FAQPage`, generate OG images at
> 1200×630 from the real hero frame, write `robots.txt` and `sitemap.xml`, and
> set `Cache-Control: public, max-age=31536000, immutable` on all hashed assets.

### Working practice with Claude
1. **One surface per prompt.** "Build the pricing section" gets a good result.
   "Build the site" gets a template.
2. **Paste the tokens, don't describe them.** Every prompt that touches visuals
   should include the actual CSS variable block.
3. **Never accept a placeholder.** If it returns `lorem` or a grey box, the next
   prompt is "replace every placeholder with the real content from the doc."
4. **After every step: `npm run build`, then open it on your phone.** Not the
   responsive simulator. Your actual phone.
5. **Ask for deletions.** "What in this file is doing nothing?" is the single
   highest-value prompt in the whole process and almost nobody runs it.

---

## 07 — The $50K Audit

The ranked list of what makes a site look cheap. Run this against the build
before launch. It's ordered by *impact per hour of work*, which is not the same
as ordered by severity.

### Tier 1 — Fix these or nothing else matters

| # | Weakness | Exact fix |
| --- | --- | --- |
| 1 | **Body copy below 16px, or line-height under 1.5** | 17–18px, `1.55`, 62ch max. This is the highest ROI change on any website, every time. |
| 2 | **Vertical rhythm is arbitrary** — sections at 64px, 80px, 96px because they were typed that way | One spacing scale: `8 / 16 / 24 / 40 / 64 / 104 / 168`. Section padding is `104` mobile, `168` desktop. Nothing off-scale. |
| 3 | **Pure `#FFF` text on near-black** | `--bone #EDE7DD`. Instantly reads as art-directed rather than default. |
| 4 | **Multi-hue diagonal gradient** on buttons/headings | Delete. Flat `--key` on the primary button, everything else `--bone` or `--mute`. The gradient is the single loudest "AI made this" signal in 2026. |
| 5 | **Every section is a row of 3 identical cards** | Two of the seven sections may use a grid, and only one of those may be symmetric. See §05 §04 for the asymmetric spans. |
| 6 | **Headline says nothing** ("Elevate your content") | The headline must contain either a noun from the product or a number. |
| 7 | **Emoji as iconography** | Replace with a single-weight 1.5px stroke icon set (Lucide, `strokeWidth: 1.5`) or, better, SVG meters that show real values. |

### Tier 2 — The difference between good and expensive

| # | Weakness | Exact fix |
| --- | --- | --- |
| 8 | Hover states are `opacity: 0.8` | Directional fill from cursor x, `--e16`, plus a 2px label shift. |
| 9 | Everything animates in at once on scroll | Max one element per 250ms window. Stagger 90ms. |
| 10 | Mouse parallax too strong | 0.06 strength, 0.08 lerp. If you can consciously see it tracking, it's 3× too much. |
| 11 | Magnetic buttons at 15–25px | 6px, radius 90px. |
| 12 | Text reveals per character | Per line, `clip-path`. Non-negotiable. |
| 13 | Buttons have no press state | `scale(0.975)` over 62ms on `pointerdown`. |
| 14 | 3D object floats with no shadow or contact | The dent *is* the contact. If an object touches nothing, it reads as a sticker. |
| 15 | Downloaded HDRI with recognisable softboxes | Custom 512px equirect gradient. |
| 16 | Focus rings removed | 2px `--key` offset 2px, on everything focusable. |
| 17 | Mobile is the desktop layout, squeezed | Redesign the hero for portrait: ribbons run *vertically*, headline drops to 2 lines at `clamp(2.75rem, 11vw, 4rem)`, A/B strip becomes a fixed bottom bar. |
| 18 | Loading state is a spinner | The entrance animation *is* the loading state. Nothing else. |

### Tier 3 — The last 5%

| # | Weakness | Exact fix |
| --- | --- | --- |
| 19 | Numbers in the body font | Every numeral in mono, tabular figures (`font-variant-numeric: tabular-nums`). |
| 20 | Copy uses `--mute` for something important | `--mute` is for secondary only. Three text levels, used consistently. |
| 21 | No grain | 128px noise tile at 3% over the whole page. Kills the flat-vector look. |
| 22 | Hairlines are `#333` everywhere | Two line tokens, and hairlines get `0.5px` on `dpr ≥ 2`. |
| 23 | Corner radii inconsistent | Exactly three: `6px` inputs, `12px` cards, `999px` pills. |
| 24 | Section transitions are hard cuts | The camera and the rails carry across. See §05. |
| 25 | The footer is an afterthought | It's the last frame of the film. Give it the vanishing point. |

### The five questions to ask about any element
1. What is this *for*? (If "visual interest," delete it.)
2. Would a $500 template have this? (If yes, change it or remove it.)
3. Is it on the grid, on the scale, on the palette, on the beat?
4. Does it survive `prefers-reduced-motion`?
5. Does it still work at 375px?

---

## 08 — Polish, Performance & Launch

### 08.1 Performance targets

| Metric | Target | Notes |
| --- | --- | --- |
| LCP | < 1.8s (4G, mid Android) | LCP element is the **headline**, not the canvas |
| INP | < 120ms | |
| CLS | < 0.02 | Reserve height for every image and the canvas |
| TBT | < 150ms | Canvas mounts *after* first paint, always |
| Total JS | < 260KB gzip | Three.js is the whole budget — audit `drei` imports individually |
| First-view transfer | < 1.1MB | |
| Lighthouse (mobile) | ≥ 92 perf / 100 a11y / 100 SEO / 100 best-practices | |

### 08.2 Asset optimisation
- **Images:** AVIF with WebP fallback, `srcset` at 1× and 2× only, everything
  below the fold `loading="lazy"` + `decoding="async"`.
- **Video:** AV1 (MP4/H.264 fallback), `muted playsinline preload="none"`,
  poster frames as AVIF. Nothing autoplays with sound, ever.
- **Fonts:** self-hosted WOFF2, subset to Latin + the specific glyphs used,
  `font-display: swap`, `<link rel="preload">` for the two weights above the
  fold. Two weights max per family.
- **Audio demos:** 96kbps Opus for the web player (they're speech + music at
  small scale; nobody can hear the difference in a browser). Preload only the
  first clip's first 3 seconds.
- **Three.js:** import from `three/webgpu`-free ESM paths and tree-shake; import
  drei helpers individually, never `import * from '@react-three/drei'`.

### 08.3 WebGL-specific
- Cap `dpr` at 2. Above that you're rendering 4× the pixels for no visible gain.
- **Pause the render loop when the tab is hidden** and when the canvas is fully
  scrolled out of view (`IntersectionObserver`). This alone can halve the
  average power draw.
- Warm the shader during the entrance animation, never on first scroll.
- Dispose geometries/materials/textures on unmount. Watch for the R3F
  StrictMode double-mount in dev.
- Cap the frame delta at 1/30s so a background tab doesn't fast-forward the
  animation when it returns.
- Test on: iPhone 12 (Safari), a Pixel 6a, a 4-year-old Windows laptop with
  integrated graphics, and Safari on an Intel MacBook. That last one is where
  WebGL sites go to die.

### 08.4 Accessibility
- Real landmarks: `header / nav / main / section[aria-labelledby] / footer`.
- Heading order: exactly one `h1`; no level skipped.
- Canvas is `aria-hidden="true"` and `role="presentation"` — it's decorative,
  and every fact it conveys is also in the DOM.
- The A/B player needs real `<button>`s with `aria-pressed`, and a text readout
  of the current state for screen readers.
- Contrast: `--bone` on `--void` ≈ 15.8:1; `--mute` on `--void` ≈ 5.6:1;
  `--faint` is **decorative only** at ~3.4:1 — never body copy. `--key` on
  `--void` ≈ 8.1:1. Verify every pair with a checker before launch, including
  light mode.
- Full keyboard pass with the mouse physically unplugged. Every interactive
  thing reachable, visible focus, no traps, and the section content readable
  without ever triggering a scroll animation.
- Captions/transcripts on every demo clip. On an *audio* product, missing
  captions is not just an a11y failure — it's an own goal.

### 08.5 SEO
- `<title>`: `SIDECHAIN — automatic audio mixing for video and podcasts`
- Meta description leads with the outcome and the time: under 155 chars.
- JSON-LD: `SoftwareApplication` (with `offers` for all three tiers) +
  `FAQPage`.
- OG/Twitter images rendered from the actual hero at 1200×630, with the
  headline burned in — not a screenshot of the page.
- `sitemap.xml`, `robots.txt`, canonical on every route, `/for/*` variants
  canonicalised properly so they don't cannibalise `/`.

### 08.6 Launch checklist

**Content**
- [ ] Every string is final. Zero lorem, zero "Coming soon."
- [ ] All six proof clips are real, cleared, and labelled with the real source device.
- [ ] Pricing matches Stripe exactly — amount, currency, interval, tier names.
- [ ] Licensing page reviewed by someone who is not you.
- [ ] Legal: terms, privacy, refund policy, contact address.

**Build**
- [ ] `npm run build` clean, zero TS errors, zero console warnings in prod.
- [ ] No `console.log` in the bundle.
- [ ] 404 and 500 pages designed, not defaults.
- [ ] Every env var set in Vercel prod; no secrets in the client bundle
      (`grep -r "sk_\|secret\|api_key" .next/static` returns nothing).

**Cross-device**
- [ ] iPhone SE (375px), iPhone 15 Pro, Pixel 6a, iPad portrait + landscape,
      1440p, 2560p ultrawide.
- [ ] Safari 17+, Chrome, Firefox, Edge. Safari is the one that will break.
- [ ] Landscape phone (the hero must not be 100vh-broken).
- [ ] Slow 4G throttle: is the page usable before the canvas arrives?
- [ ] Reduced-motion on: complete, legible, no dead zones.
- [ ] Light mode: not an inversion, actually designed.

**Instrumentation**
- [ ] Analytics with events on: A/B play, A/B toggle, each section 50% view,
      upload started, render completed, each pricing CTA, FAQ opens.
- [ ] Error tracking (Sentry) with the WebGL tier attached as a tag — you want
      to know if 30% of traffic is falling to Tier C.
- [ ] Real-user Web Vitals reporting.
- [ ] Uptime monitor on `/` and on the render API.

**The last two, and they're the ones that get skipped**
- [ ] **Hand your phone to someone who has never seen it, say nothing, and
      watch them for 60 seconds.** Where do they stop? What do they not tap?
      Fix that, not what you think is wrong.
- [ ] **Turn off the WebGL canvas entirely and look at the site.** If it still
      looks like a $50K site, you've built one. If it collapses, the 3D was
      carrying work the design should have been doing — and that's a fixable
      problem, but only before launch.
