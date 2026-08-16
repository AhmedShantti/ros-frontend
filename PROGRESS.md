# TRENDOW — build progress

Frontend only. There is no server, no database and no Python anywhere in the
tree: the running restaurant lives in the browser. `npx tsc --noEmit` and
`npm run build` both pass, and `npm run dev` serves all 62 routes.

## What works

The operational core runs end to end. A sale taken on the point of sale
moves every downstream number, on the same device, with no round trip:

    POS  →  fire  →  kitchen ticket  →  bump  →  pass  →  pay
              ↓                                            ↓
       stock depletion                              cash drawer
       (recipe expanded,                            (expected cash,
        modifier-aware)                              blind close)
              ↓                                            ↓
        console: levels, movements, waste, orders, payments, audit

**Terminals** (`app/(terminal)/`, full screen, outside the console shell)

- `/pos` — floor plan with live table state and time-since-seated, order
  types, menu grid with Arabic-normalising search, variant and modifier
  sheets, course firing, line and order discounts with reason and manager
  approval, comps, pre- and post-fire voids with disposition, split payment
  across tenders, cash rounding and change, receipt, refund.
- `/kds` — station displays with live timers coloured against target,
  hold-to-bump, per-item bump, recall, all-day counts, expediter pass view.
- Shift and drawer — opening float before the first sale, pay-in, pay-out,
  safe drop with a drawer limit, X report, blind denomination count with
  variance and manager acknowledgement.

**Console** (`app/(console)/`) — dashboard, orders with line detail, open
orders, table status, kitchen queue, stock levels, stock movements, waste,
cash sessions, payments by tender, audit trail, settings. The settings that
change terminal behaviour actually change it.

## How it is built

**`lib/console/live/`** is the new layer and the only mutable state.

- `engine.ts` — pure rules. Price resolution precedence (FR-POS-040), tax
  under both inclusive and exclusive pricing, cash rounding to the smallest
  coin in circulation, recipe expansion including sub-recipes and
  modifier deltas, station routing (FR-KDS-010), ticket urgency, Arabic
  search normalisation. No storage, no React, no clock.
- `state.ts` — the shape, and the seed drawn from the fixtures.
- `reducer.ts` — every transition. Pure: timestamps arrive on the action and
  ids come from a counter, so the same actions always produce the same store.
- `store.tsx` — the provider. Write-through to localStorage, plus a `storage`
  listener so two tabs behave like two terminals on one local network. Open
  the POS in one and the KDS in another; they talk to each other.

**`lib/console/mock/`** is the world as it was at boot — menu, recipes,
branches, employees, yesterday's ledger. It never changes. The live layer
holds everything the shift moves.

## Two decisions worth knowing

**Stock depletes when a line is fired, not when the bill is paid.**
FR-POS-070 says a post-fire void leaves the depletion standing and asks for a
waste record instead, which is only coherent if the food left stock when the
kitchen was told to make it. Paying an order that was never fired fires it
first, so a counter sale cannot slip past the ledger.

**Negative stock is recorded, never blocked.** UC-POS-01 alt-flow 13a: the
food was sold, so the record must say so. A negative balance means a receipt
was not entered, and it should be loud rather than hidden.

## Every module now has a screen

The remaining 39 routes were built against the service registry that was
already in place, so no page reaches a mock module for its rows — everything
goes through `services.*` and swaps to HTTP in one file. There are no `stub`
entries left in `nav.ts`; nothing in the sidebar is greyed.

- **Menu** — categories, items (with the 86 workflow), modifier groups
  showing the recipe delta beside the price delta, combos, price lists with
  the precedence rule, recipes with the cost breakdown and margin.
- **Inventory** — item master, blind counts (expected stays hidden until the
  count is submitted), transfers with the dispatch/receipt discrepancy,
  batches, an expiry queue bucketed by time left to act, adjustments.
- **Purchasing** — supplier scorecards, requisitions, purchase orders with
  value-band approval, goods receipts carrying price variance and
  temperature, invoices with the three-way match and ageing.
- **Costing** — food cost by branch/brand/category, theoretical-vs-actual
  variance with the hypothesis column, waste analysis separating true waste
  from controlled consumption, contribution margin with the Boston matrix
  and per-channel profitability.
- **Workforce** — employees (compensation behind its own permission),
  schedules with rule violations, attendance with flags and method,
  overtime split approved/unapproved, performance with the control metrics.
- **Finance** — expenses, day close with blocking sessions and the Z
  sequence, tax summary tied to the country pack that produced it.
- **Organisation** — tenants, brands, branches, warehouses, central kitchens.
- **Governance and admin** — the approvals queue with self-approval and
  permission checks, the report catalogue, terminals with outbox depth,
  country packs with the signing and conformance gates, integrations with
  connector health and circuit-breaker state.

Writes stay demo-scoped: the actions wired to the service layer are the ones
it implements — `toggleAvailability`, `approveOrder`, `closeDay`, `decide`.
Everything else raises the "not in this build" toast rather than pretending.

## Verified

`npx tsc --noEmit` and `npm run build` both pass; all 62 routes prerender.
`en.ts` and `ar.ts` carry 1,496 keys each — `ar.ts` is typed as `ConsoleCopy`,
so that parity is enforced by the compiler rather than by discipline. Every
route was served and every collection behind it returned rows.

## Notes for whoever picks this up

- Nothing under `lib/console/mock/` may call `Math.random()` or `Date.now()`.
  Use the seeded RNG in `rng.ts` and the fixed anchor in `clock.ts`, or
  hydration will mismatch.
- The same rule applies to `lib/console/live/reducer.ts`: it is a pure
  function, and the timestamp belongs on the action.
- Bumping `LIVE_STATE_VERSION` in `state.ts` invalidates every stored drawer.
  Do it when the shape changes; do not do it casually.
- Client-side `can(...)` checks decide what to render, not what is allowed.
  SRS FR-SEC-045 — a real deployment authorises every request on the server.
