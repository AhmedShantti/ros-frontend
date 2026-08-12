# TRENDOW — build progress

Frontend only. There is no server, no database and no Python anywhere in the
tree: the running restaurant lives in the browser. `npx tsc --noEmit` and
`npm run build` both pass, and `npm run dev` serves all 23 routes.

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

## What is not built

Roughly two thirds of the SRS modules — menu editing, purchasing, costing
analytics, workforce, organisation, approvals, users and roles, country
packs, integrations. They appear in the sidebar greyed with a "not in this
build" tag rather than hidden or linked to a 404, because the shape of the
product is part of what the console is showing.

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
