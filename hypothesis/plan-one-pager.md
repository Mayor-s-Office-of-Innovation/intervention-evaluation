# Plan — Hypothesis tool one-pager

_2026-07-17. A single-page brief describing the `./hypothesis/` self-serve
intervention-evaluation tool. Draft skeleton for review. Featured example locked:
a plainclothes-officer deployment, verified against live data (see "See it in
action")._

## Goal

Produce a one-page brief that lets a reader understand what the hypothesis tool
is, why it matters, and that it's built responsibly — in ~60 seconds, without us
in the room.

## Audience (locked)

**High-level city leadership** (not part of pod meetings) **+ external parties
interested in the city's use of technology.**

Implications:
- Awareness / credibility piece, **not** an onboarding how-to. No reader is about
  to drop a pin themselves.
- **Lead with value and fit**, not mechanics.
- The "interested in city tech" audience rewards the **responsible-tech** angle:
  live open data, every number reproducible from a public query, honest
  "observational, not causal" framing. Feature these, don't bury them.
- Minimal jargon, maximum polish. It may travel beyond people who know the context.

## Format (locked)

- **Now:** Markdown in the repo — `hypothesis/one-pager.md`. Fast, version-
  controlled, renders on GitHub, easy to redline.
- **Later (once content is locked):** export to a designed **PDF** leave-behind.
  Keep the markdown export-friendly (relative image paths, no GitHub-only syntax).

## References the template is built on

- **[18F Content Guide](https://guides.18f.org/content-guide/)** and
  **[Product Guide](https://guides.18f.org/product/)** — civic-tech standard,
  public domain (free to adapt). Principles used: structure for scanning,
  descriptive headings, plain language ([plainlanguage.18f.org](https://plainlanguage.18f.org/)),
  build trust through transparency + honest limitations, friendly-informational tone.
- **[Miro one-pager template](https://miro.com/templates/one-pager/)** — the
  generic skeleton (Overview → Summary → Next steps) and the discipline of
  "prioritize by importance; share-ready for stakeholders with limited background."
- **Product one-pager convention** — value-forward spine: one-line value prop →
  problem → how it works → proof/example → positioning → limitations.

## What the tool actually is (accuracy notes for drafting)

- Self-serve, **pin-and-radius** tool. Officials describe an intervention (title,
  what/where/when + expected "levers") and the tool pulls **live SF OpenData**
  within a radius of the pin for a **before/after** read.
- Outputs: plain-language **verdict**, **before/after bar chart over time**,
  **stat cards**, **map of every underlying report**, and a **methodology panel
  with the exact runnable query**.
- **14 vetted levers** (drug activity, dumping, encampments, graffiti, noise,
  lighting, shoplifting, mental-health calls, medical emergencies, etc.), each
  wired to a real dataset with documented caveats (SFPD report lag, 5000-row cap).
- Baked-in honesty: _"Prototype — observational, not a causal claim."_
- **Positioning vs. the rest of the dashboard:** the district dashboards take the
  *wide* view (displacement, emerging clusters across a district); this tool is
  the *local, bottom-up* counterpart — one owner, one location, one change,
  "did my thing work here?" Together they form a system.

## Section-by-section outline (the deliverable)

| # | Section | Content | Length |
|---|---------|---------|--------|
| 1 | **Name + one-line value prop** | "A self-serve tool to check whether a local intervention actually moved the data." | 1 line |
| 2 | **Why it exists** | Officials change environments/staffing in response to complaints but have no fast, neutral way to see if it worked. | 2–3 sentences |
| 3 | **How it works** (scannable, 3 steps) | Describe the intervention + drop a pin → tool queries live open data in that radius, before vs. after → verdict + chart + map. | 3–4 bullets |
| 4 | **See it in action** | Plainclothes-officer deployment, drug lever, −26% rate (verified — see below). Hero screenshot. | 2–3 sentences + 1 image |
| 5 | **Part of a larger system** (emphasized) | Zoom in: this tool checks one local effect. Zoom out: the district dashboards' hot/cold "what moved / what changed" maps reveal whether the behavior displaced to nearby blocks. See dedicated notes below. | 3–4 sentences |
| 6 | **Built responsibly** | Live public data; every number reproducible from a public query; honest "observational, not causal." | 2–3 sentences |
| 7 | **Who it's for + access** | Pod leaders / intervention owners; live at [URL]. | 2 lines |
| 8 | **Footer** | Data sources + contact. | 1 line |

Discipline: truly one page. If it spills, cut — don't shrink the font. Cap images
at 1–2. Everything scannable; lead with the answer.

## "Part of a larger system" — the zoom-in ↔ zoom-out story (emphasis)

Per user request, elevate this from a single footnote to a **through-line** —
the tool is not a standalone gadget; it's the local lens of a bigger toolkit, and
that's a selling point (sophistication + honesty) for the leadership/external
audience.

**The core message:** local wins can be real *or* they can just be displacement.
Good practice checks both, and this toolkit lets you.

- **Zoom in (this tool):** "Did my intervention move the data *right here*?" —
  pin + radius, fast before/after on one local effect.
- **Zoom out (the district dashboards):** "Did that activity just move *nearby*?"
  — the district pages carry hot/cold transition maps ("**Hotspots: what moved**"
  on drug, "**Hotspots: what changed**" on unhoused) driven by a time scrubber,
  which show where a behavior *appeared* vs. *faded* across a district window.
  That's the displacement check the local tool alone can't give you.

**Where this theme surfaces in the copy (light, not repeated verbatim):**
1. A clause in the **value prop / "Why it exists"** hinting at the pair.
2. This **dedicated section** as the fullest statement.
3. The **example's caveat** — our plainclothes drop fell back from a Mar–Apr
   spike; the honest next question is "did it displace?", answered on the
   district map. Concrete proof the two views work together.

**Accuracy guardrails for the copy:**
- Call them "district dashboards" and use their real panel titles ("what moved" /
  "what changed"). Don't imply the local tool itself shows displacement — it
  doesn't; the district maps do.
- Frame displacement as a *question the system helps you ask*, not a claim that
  this particular intervention did or didn't displace. **Decision (2026-07-17):**
  skip the per-intervention displacement check for now — displacement stays the
  illustrative question, no concrete "it didn't move next door" claim in the copy.

## Example ("See it in action") — LOCKED & verified

**Intervention:** a plainclothes-officer deployment (Tenderloin area).
**Shareable link (the exact view to screenshot):**
`…/hypothesis/?dp=drug&date=2026-05-11&lat=37.78900&lng=-122.41598&r=200&from=2025-11-01&to=2026-06-16&what=plain+clothes+officers`

- Lever: `drug` — community-reported 911 "Suspicious Person" calls whose notes
  mention drugs (`onview` excluded → resident concern, not officer-initiated).
- Pin 37.78900, −122.41598 · radius 200 m · intervention date 2026-05-11 ·
  window 2025-11-01 → 2026-06-16.

**Verified against the tool's own render (2026-07-17 hero screenshot):**

| | Count | Rate / 30 days |
|---|---|---|
| Before (191 days) | 140 | ≈ 22.0 |
| After (37 days) | 20 | ≈ 16.2 |
| **Rate change** | | **−26% (down)** |

_(My earlier standalone query gave −32% / 140→18 over a 36-day window; the tool's
actual render is −26% / 140→20 over 37 days — a slightly different window boundary
plus live-data drift. **The screenshot is the source of truth for the doc.**)_

**Headline framing (must use the RATE, not raw counts):** "down ~26%" — NOT
"140 → 20" (that's −86% and misleading; the before-window is ~5× longer). The tool
normalizes to a per-30-day rate and reports −26% correctly.

**Why this is a credible example:**
- Community-reported lever (`onview` excluded) → the drop is *fewer residents
  calling*, not "police wrote more reports." Robust to enforcement reflexivity
  ([[crime-effectiveness-enforcement-reflexivity]]).
- Clears the tool's 30-day short-window caution threshold (post = 36 days).

**Caveats to frame honestly in the copy (not dealbreakers):**
- Post-window is ~5 weeks, June partial → "early but clear," more months would
  strengthen it.
- Monthly series `18,24,13,13,35,32,17,6`: Mar–Apr were local peaks just before
  the intervention, so part of the drop is falling back from a spring spike; the
  tool is observational and can't isolate cause. **Turn this into the "Where it
  fits" tie-in:** the local tool shows the local drop; the district-wide
  dashboards are where you'd check whether activity displaced to nearby blocks.

## Screenshot plan

- Store in `hypothesis/one-pager-assets/`; reference with **relative paths** so
  images render on GitHub *and* survive the PDF export.
- **Hero (required):** a real result — verdict + before/after chart + map together.
- **Optional supporting (pick ≤1):** the input form (pin + levers) to convey
  "structured, self-serve," or the methodology panel (dataset + runnable query)
  to sell reproducibility to the external-tech audience.
- **Capture last**, after wording + example are locked (screenshots are content-
  dependent — re-shoot if the example changes). Capture via the repo's existing
  Playwright setup by driving the live app to the verified intervention.
- Data is public and the site is already public → no redaction concern.

## Process / next steps

1. ✅ Audience + format + template locked; skeleton drafted (this doc).
2. ✅ Featured example chosen: plainclothes-officer deployment (shared link above).
3. ✅ Verified the data supports the win — re-ran the query, −32% rate (2026-07-17).
4. ✅ User reviewed the plan; approved with the "larger system" emphasis added.
5. ✅ Drafted `hypothesis/one-pager.md` — plainclothes example baked in, system
   through-line woven, hero screenshot placeholder marked, footer = SF Mayor's
   Office of Innovation, access = live GitHub Pages URL.
6. ✅ Hero screenshot in place at `hypothesis/one-pager-assets/hero-plainclothes-result.png`
   (user-cropped: verdict + stat cards + chart, 1022×665). 2nd screenshot
   (displacement map) skipped to keep the doc to one page. Numbers corrected to
   −26% to match the render.
7. ✅ Exported one-page PDF → `hypothesis/one-pager.pdf` (light-theme, print-styled,
   hero embedded; generator: `/tmp/make-onepager-pdf.cjs`, run with
   `NODE_PATH=$PWD/node_modules node …`). CTA = 3 links (live analysis · dashboards
   · code). Fits one page (~921/960px).

## Guardrails (carry through to the draft)

- Plain language, active voice, no unexplained jargon (18F / plainlanguage.gov).
- Honesty is a feature for this audience — name the limits, show the sources.
- Don't cherry-pick the example by fishing the data for any drop; start from a
  real documented intervention and let the tool confirm it.
