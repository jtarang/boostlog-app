# tasteskill: Anti-Slop Frontend Skill

A comprehensive design engineering guide for building landing pages, portfolios, and redesigns without falling into common AI-generated design patterns.

## Core Structure

The skill operates in four phases:

**1. Brief Inference (Section 0)** - Read the actual design direction before touching code. Output a one-line "Design Read" declaring the page kind, audience, and aesthetic family.

**2. Three Dials Configuration (Section 1)** - Set `DESIGN_VARIANCE` (1-10: symmetry to chaos), `MOTION_INTENSITY` (1-10: static to cinematic), and `VISUAL_DENSITY` (1-10: airy to packed). These gate every downstream decision.

**3. Design System Selection (Section 2)** - Choose a real system (Material Web, Fluent UI, Carbon, GOV.UK, etc.) or honest aesthetic implementation. "One system per project."

**4. Pre-Flight Checks (Section 14)** - Mechanical verification matrix before shipping. Non-negotiable blockers include em-dash elimination, color consistency locks, and motion justification.

## Key Enforcement Rules

**The Em-Dash Ban (Section 9.G)** - Completely forbidden everywhere: headlines, captions, quotes, body copy, buttons. "Zero em-dashes" is binary, not contextual. This is the #1 AI-design tell.

**Premium-Consumer Palette Ban (Section 4.2)** - The beige+brass+oxblood+espresso combination is explicitly banned as default for luxury/artisan briefs. Rotate to different families across projects.

**Serif Discipline (Section 4.1)** - Serif is discouraged by default. Only acceptable for editorial/luxury/publication briefs with explicit justification. Fraunces and Instrument_Serif are blacklisted.

**Layout Hard Rules (Section 4.7)** - Hero must fit initial viewport, max `pt-24` top padding, eyebrow count capped at `ceil(sectionCount/3)`, no more than 2 zigzag image-text sections in sequence.

**Motion Justification** - Every animation must answer "what does this communicate?" in one sentence (hierarchy, storytelling, feedback, or state transition). "It looked cool" fails.

## AI Tells (Section 9) - Banned Patterns

Forbidden unless explicitly requested:
- Section-number eyebrows (`001 · Capabilities`)
- Decorative locale/time/weather strips
- Three equal feature cards as default layout
- Div-based fake product screenshots
- Generic "Quietly trusted by" labels
- Placeholder avatar eggs and Jane Doe names
- Startup-slop brand names (Nexus, Cloudly, SmartFlow)
- Uniform `//` eyebrows on every single section

## Reference Implementation

The skill includes canonical skeletons for:
- **Sticky-Stack sections** (GSAP with `start: "top top"`, `pin: true`)
- **Horizontal-Pan hijack** (vertical scroll to horizontal slide)
- **Scroll-Reveal stagger** (Motion's `whileInView` alternative)

All animation patterns isolate in Client Components with strict cleanup.

## Design System Mapping

Material Web, Fluent UI, Carbon, Shopify Polaris, Atlassian, Primer, GOV.UK, USWDS, Bootstrap, Tailwind, Radix, and shadcn/ui all available with install commands.

## Redesign Mode (Section 11)

Distinguishes three paths: greenfield (baseline dials), preserve (audit existing tokens, evolve gradually), overhaul (new visuals, preserve content/IA). Audit captures brand tokens, IA, content blocks, SEO baseline, and existing pattern wins before proposing changes.

---

**This skill prioritizes shipping real design, not templated defaults. Every rule is contextual, gated by the design read and dial values. The Pre-Flight Check is mandatory; missing a single box means the output is incomplete.**
