# TRENDOW — Restaurant Operating System

Built from the Software Requirements Specification (ROS-SRS-001 v1.0).

Frontend only: no backend, no database, no Python. The running restaurant —
orders, kitchen tickets, stock, the cash drawer — lives in the browser, so
the system can be used rather than only described.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the production build
```

Requires Node 18.18+ (Node 20+ recommended).

## Take an order

1. Open **`/pos`** and declare an opening float. No shift, no sales
   (FR-POS-090).
2. Pick a table, or start a takeaway. Add items — the ones with a required
   choice open an options sheet, the rest go on in one tap.
3. **Send to kitchen.** Ingredients leave stock at that moment, and a ticket
   appears at the station each line routes to.
4. Open **`/kds`** in a second tab. It is a second terminal: the ticket is
   already there. Hold to bump; the pass releases the order when every
   station is done.
5. Take payment. Cash rounds to the smallest coin in circulation and the
   change is computed; the receipt carries the tax breakdown the country pack
   requires.
6. Open the console — **`/orders`**, **`/inventory/movements`**,
   **`/finance/cash-sessions`**, **`/audit`**. The sale is in all of them.

Two tabs on the same machine sync through `localStorage`, which is as close
as a frontend-only build can honestly get to the local-network routing in
NFR-REL-003. **Reset terminal** in the top bar clears the shift and starts
over; the menu, recipes and branches are untouched.

See `PROGRESS.md` for what is implemented, what is not, and why stock
depletes when a line is fired rather than when the bill is paid.

## Stack

- Next.js 16 (App Router) + React 19
- TypeScript
- Tailwind CSS v4 (tokens declared in `app/globals.css` under `@theme`)
- Fonts loaded from Google Fonts in `app/layout.tsx`:
  Space Grotesk for Latin display, Inter for text, Cairo for Arabic on
  every surface including headings, JetBrains Mono for requirement tags
  and money columns
- Motion primitives in `components/motion.tsx` — scroll reveal, count-up,
  marquee, scroll progress, cursor-tracked card glow. All of it is off
  under `prefers-reduced-motion`, and the reveal falls back to visible
  under `@media (scripting: none)`.

## Routes

**Terminals** — full screen, no console chrome.

| Route  | What it does                                                                 |
| ------ | ---------------------------------------------------------------------------- |
| `/pos` | Floor plan, menu, modifiers, courses, discounts, voids, split payment, receipt |
| `/kds` | Station displays, live timers, hold-to-bump, recall, all-day counts, pass      |

**Console** — behind `/login`.

| Route                     | What it does                                            |
| ------------------------- | ------------------------------------------------------- |
| `/dashboard`              | The eight figures an owner acts on, plus today's live take |
| `/orders`                 | Every order with its line detail, costs and payments      |
| `/operations/open-orders` | What is on the floor now, oldest first                   |
| `/operations/tables`      | Table state and time since seated                        |
| `/operations/kitchen`     | The queue, average ticket time, bottleneck station        |
| `/inventory/levels`       | Live on-hand, what the shift moved, negatives shown       |
| `/inventory/movements`    | The append-only ledger every balance derives from         |
| `/inventory/waste`        | True waste separated from staff meals and tastings        |
| `/finance/cash-sessions`  | Float, drawer operations, expected cash, variance         |
| `/finance/payments`       | Net by tender, refunds against the same tender            |
| `/audit`                  | Hash-chained trail of every discount, void and refund     |
| `/settings`               | Switches that change how the terminals behave             |

**Marketing** — the public site.

| Route       | What it does                                                        |
| ----------- | ------------------------------------------------------------------- |
| `/`         | The one-sale-nine-effects argument, the four numbers, the food-cost drift calculator, differentiators, the competitive landscape, unit economics, module and segment previews |
| `/modules`  | All seventeen module codes from SRS §1.5, in three groups            |
| `/flows`    | Six use cases at step level — UC-POS-01, UC-KDS-01, UC-INV-01, UC-PRC-01, UC-CST-01, with UC-OFF-01 on `/platform` |
| `/architecture` | Chapters 5, 7, 24, 25, 26: drivers, module rules, extraction path, event catalogue and envelope, domain model and value objects, the order state machine, movement types, patterns and rejected anti-patterns, schemas, partitioning, migrations, backup, API conventions, status codes, error model, endpoints |
| `/quality`  | Chapters 27, 28, 29: usability and accessibility, maintainability, observability, portability, test categories, the conformance corpus, quality gates, environments, the pipeline, deployment rules, SLOs, incident severity, cost management |
| `/segments` | The four buyer segments with buying behaviour, and the five personas each hard requirement came from |
| `/platform` | Offline, Arabic and country packs, audit, integrations, architecture and ADRs, performance, scale and availability, the three shipped country packs, security and compliance mapping, and the UC-OFF-01 outage timeline |
| `/pricing`  | Three tiers, the comparison matrix, add-ons, tenant lifecycle        |
| `/spec`     | The reference key: document control, the requirement scheme and module codes, MoSCoW, assumptions, constraints, out-of-scope, glossary, actors, bounded contexts, the fifteen release-blocking scenarios, test pyramid, data volumes |
| `/contact`  | Demo request form (client-side only — see below)                     |

## Bilingual model

Arabic is the default locale and the layout is authored right-to-left,
then mirrored to English — not the reverse. This mirrors FR-LOC-001..005.

- `content/en.ts` defines the core copy **and** its shape (`export type Copy`)
- `content/{flows,architecture,quality}/en.ts` do the same for the three
  long reference chapters; `lib/i18n.tsx` composes all four into one `t`
- Each `ar.ts` is typed against its English counterpart, so a missing key
  is a build error. 2,309 leaf strings, checked in both directions.
- `lib/i18n.tsx` holds the language, writes `lang`/`dir` onto `<html>`,
  and remembers the choice in `localStorage`
- Layout uses logical properties throughout (`ps-*`, `me-*`, `border-s`,
  `start-*`), so nothing needs flipping by hand

Adding a third language: create `content/fr.ts` typed as `Copy`, add it to
`dictionaries` in `lib/i18n.tsx`, and extend the toggle into a picker.

Numbers in the Arabic build render as Arabic-Indic via
`Intl.NumberFormat("ar-EG")` in `components/DriftCalculator.tsx`. Switch
the locale string to `en-US` there if you want Western numerals in Arabic.

## Wiring the demo form

`app/contact/page.tsx` validates locally and then fakes a submit — nothing
leaves the browser. To make it real, replace the `window.setTimeout` in
`onSubmit` with a `fetch` to your CRM, a Next.js route handler, or a form
service. The success and error states are already in place.

## Design notes

- **Signature element**: the hero docket and the nine records the same sale
  produced elsewhere (`components/SaleCascade.tsx`). It animates once on
  scroll and can be replayed; it renders complete and static under
  `prefers-reduced-motion`.
- **Structural device**: the mono requirement tags (`FR-POS-001`, `NFR-USA-003`).
  Every claim on the site points at the requirement it came from, which is
  also a useful sales artifact — nothing is promised that isn't specified.
- **A light system, structured by hue**: there are no dark bands. Structure
  comes from five working colours, each with one job — `amber` the brand
  and money, `emerald` "this is working", `azure` platform and
  architecture, `violet` quality and governance, `rose` loss and risk.
- **Three weights per hue, and only one of them may carry text**: the mid
  weight is for marks, bars, rings and borders; `-deep` is the only weight
  that clears 4.5:1 on paper; `-wash` is a section background and nothing
  else.
- **The accent is plumbed, not hard-coded**: a `Section` sets
  `data-accent`, which defines `--a`, `--a-deep` and `--a-wash`. Everything
  inside reads `text-a`, `bg-a-wash`, `border-a`, so one prop recolours a
  whole band and no component knows which hue it is wearing.
- **Loss is rose, never amber**: a warm accent and a warm error tint a few
  degrees apart means an error panel reads as an informational one.
- **Backgrounds are layered, not flat**: drifting colour blobs behind the
  hero, the wordmark band and the CTA; a masked dot or grid ruling on every
  section; a lit hairline in the band's own hue. All pure CSS, all stopped
  under `prefers-reduced-motion`.
- **Header is a floating capsule plus a full-screen menu**: nine
  destinations will not fit in a pill row without shrinking past
  readability, so three stay inline and the overlay gives each one a
  number, a description and its own hue.
- **Reveal threshold is 0 deliberately**: a ratio threshold cannot be met
  by an element taller than the viewport divided by that ratio, so a long
  table would never appear. The negative bottom `rootMargin` does the
  "wait until it is properly on screen" job at any element height.
