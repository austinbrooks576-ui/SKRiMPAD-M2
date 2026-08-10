# Creative Direction

Two agency-grade creative directions, each covering the same eight disciplines:
creative direction, cinematic hero, 3D visual world, motion language, sections
as experiences, the build sequence, the honest audit, and launch.

| Doc | Product | The idea in one line |
| --- | --- | --- |
| [01 — SIDECHAIN](./01-SIDECHAIN.md) | **New.** Automatic audio mixing for video and podcasts. | A colour and motion system that literally sidechains — two signals, and one always makes room for the other. |
| [02 — SKRiMPAD](./02-SKRIMPAD.md) | **This repo.** The groovebox. | The homepage is a playable 3D machine wired to the real audio engine, and the site runs on the product's own 50 skin files. |

## Why two, and why these two

The brief asked for a *new* product — something already in demand and proven to
make money — and then, separately, for the same treatment applied to SKRiMPAD.
The new product wasn't named, so doc 01 names one, argues the market
structurally (§01.1), and flags exactly which sections are product-specific if
you want to swap the premise.

The two directions are deliberately built on **opposite** decisions, so neither
reads as the same template recoloured:

| | SIDECHAIN | SKRiMPAD |
| --- | --- | --- |
| World | A void. Nothing touches anything. | A table. Everything has weight. |
| Hero object | An abstract signal envelope | A photoreal machine you can play |
| Colour | Two fixed accents that duck under each other | 50 live palettes from the product's own files |
| Type | Grotesk + mono; **numbers are always mono** | Variable-width display that breathes on the beat |
| Motion rule | **Quantised** — every duration is a subdivision of 120 BPM | **Physical** — springs and mass, at the visitor's chosen BPM |
| Particles | 400 dust motes, deliberately | None, deliberately |
| Proof asset | An A/B listen | Letting you play it |

## The shared non-negotiables

These appear in both docs because they're the difference between expensive work
and generated work, regardless of the brand:

- Body copy at 17–18px, `line-height` 1.55, measure capped at 62ch.
- One spacing scale — `8 / 16 / 24 / 40 / 64 / 104 / 168` — and nothing off it.
- No pure `#FFFFFF`, no pure `#000000`, ever.
- No decorative multi-hue gradients. That gradient is the tell.
- Text reveals **per line**, never per character.
- Mouse parallax at 0.06–0.08. Magnetic buttons at 6–7px, not 20.
- One WebGL canvas for the whole site; sections are camera positions, not scenes.
- An authored Tier-C fallback that is checked in, not an accident.
- The site must still look expensive with the canvas switched off.

## Reading order

Read §00 and §01 of either doc for the argument. §02–§05 are the design. §06 is
the build, with copy-pasteable prompts. §07 is the audit to run before launch —
doc 02 §07.1 audits the current `site/index.html` line by line. §08 is the
checklist.
