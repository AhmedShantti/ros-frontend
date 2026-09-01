# Backend integration

The console reads everything through one object, `services`, defined in
`lib/console/services/index.ts`. Which implementation that is depends on a
single environment variable:

```ini
# .env.local
NEXT_PUBLIC_API_URL=http://192.168.1.43:3000
```

Set → `httpServices` (the real backend). Unset → `mockServices` (demo data).
Next reads it at build time, so **restart `next dev` after changing it**.

Override the inference with `NEXT_PUBLIC_API_MODE=http|mock`.

## Check the link before you debug the UI

```bash
npm run api:check
npm run api:check -- --email you@example.com --password secret
```

The first form pings `/health`, probes CORS, and compares the deployed
document at `/docs-json` against `api/openapi.json` — the snapshot the wire
types are generated from. That last check is the one nothing else catches:
the app typechecks, builds and boots happily against a spec the server
stopped serving weeks ago, and the first symptom is a 404 in production.

The second form signs in, lists tenants, selects one, and reads every scoped
list the console depends on — which is where a "connected but blank" setup
actually breaks.

## On a local network

The backend is at a different origin from the page, so three things have to
be true and only the first is obvious:

1. **The API binds `0.0.0.0`, not `127.0.0.1`.** A NestJS app defaults to
   listening on all interfaces, but `app.listen(3000, '127.0.0.1')` is
   reachable only from the API machine itself.
2. **The browser is allowed to read the response.** CORS decides this. The
   deployed backend gets it right; a locally-run one may not — see below.
3. **The tablet can reach the dev server.** Next blocks cross-origin requests
   to dev-only endpoints; list the address you type on the tablet in
   `DEV_ORIGINS` (see `.env.local`), which `next.config.ts` feeds to
   `allowedDevOrigins`.

A failure at any of these surfaces as `NETWORK_UNREACHABLE`. A CORS rejection
is indistinguishable from a dead host in JavaScript — the browser hands the
page the same opaque "Failed to fetch" — so the error's `detail` names both.

### CORS: resolved on the deployed backend

`npm run api:check` probes this. Against `https://ros-zchd.onrender.com` it
now reports:

```
Browser access (CORS)
  OK   Access-Control-Allow-Origin: http://127.0.0.1:3000
  NOTE Cross-Origin-Resource-Policy: same-origin
  OK   Preflight allows authorization, idempotency-key and if-match
```

The last line is the one that matters and was not previously checked. Every
authenticated call sends `authorization`; `POST /orders`, its lines and
`POST /cash-sessions` also send `idempotency-key`; order writes send
`if-match`. A preflight that admits the origin but not those headers blocks
every write while looking correct.

**`Cross-Origin-Resource-Policy: same-origin` is not a blocker**, and this
document previously said it was. Per the Fetch standard the CORP check only
runs when a response's tainting is `opaque` — `no-cors` subresource loads
such as images, scripts and fonts. Every request this app makes is a
`cors`-mode fetch that receives a valid `Access-Control-Allow-Origin`, so its
tainting is `cors` and CORP is never consulted. Relax it only if something
starts loading assets from the API cross-origin:

```ts
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
```

No cookies are used — the client sends `credentials: "omit"` — so
`Access-Control-Allow-Credentials` is not required.

**If a deployment ever lacks CORS**, route around it. Point the app at this
server and let it forward:

```ini
# .env.local
NEXT_PUBLIC_API_URL=/api/ros
API_PROXY_TARGET=https://ros-zchd.onrender.com
```

`next.config.ts` rewrites `/api/ros/:path*` to the backend. The browser then
only ever talks to the origin it was served from, so CORS never applies —
verified for both `GET /health` and `POST /auth/login`. `API_PROXY_TARGET` is
server-side only, so the backend's address never reaches the client bundle.

The trade-off: every call takes an extra hop through the Next server, and in
production it needs an equivalent rewrite on whatever serves the app. Fixing
CORS on the backend is the better end state.

## Regenerating the types

`api/openapi.json` is the source of truth. Two files are generated from it
and must not be hand-edited:

```bash
npm run api:types
```

| File | Contents |
| --- | --- |
| `lib/api/schema.ts` | Request DTOs, one response type per operation, and a route table |
| `lib/api/endpoints.ts` | 151 typed calls, grouped by tag: `api.catalogue.listItems()` |

Drop in a new spec export, re-run, and `tsc --noEmit` will point at every
call the backend has changed under you. `npm run api:check` tells you when
that is due, by diffing the snapshot against `GET /docs-json`.

Two conventions the generator applies, because the NestJS document does not
carry enough information to infer them:

- Request DTOs honour their `required` array.
- Response schemas carry no `required` array at all, so every declared
  property is treated as present. A field that can be absent is declared
  `["string", "null"]` in the document and becomes `| null`.

## The layers

```
app/…                        pages and components
  └── services               lib/console/services/index.ts — the swap point
        ├── mock.ts          in-memory demo data
        └── http.ts          ServiceRegistry over HTTP
              ├── map.ts     wire shapes → domain model
              ├── paging.ts  client-side search / sort / paging
              └── lib/api/
                    ├── endpoints.ts   generated typed calls
                    ├── schema.ts      generated wire types
                    ├── client.ts      fetch, auth, errors, retries
                    ├── auth.ts        login → tenant → terminal
                    ├── session.ts     token storage
                    └── config.ts      NEXT_PUBLIC_API_URL, mode, timeout
```

## Authentication

The API splits sign-in into three calls, and the order is load-bearing:

| Step | Call | Effect |
| --- | --- | --- |
| 1 | `POST /auth/login` | Access + refresh token, **no tenant claim** |
| 2 | `POST /auth/tenant` | Rotates the access token to carry a tenant |
| 3 | `POST /auth/terminal` | Optional; binds the session to a device |

Every `/org`, `/catalogue`, `/inventory` and `/orders` endpoint returns 403
until step 2 has happened. `lib/api/auth.ts` does 1 and 2, and selects the
tenant automatically when the account has exactly one; the login page shows a
chooser when it has several.

`POST /auth/refresh` yields a **tenant-less** token, so `client.ts` replays
steps 2 and 3 after every rotation. Without that, a session starts returning
403 the moment the first access token expires.

Tokens live in `localStorage` (`ros.api.*`), because a POS terminal that
reloads mid-service must come back signed in.

## What is live

`API_COVERAGE` in `lib/console/services/http.ts` is the authoritative list and
is printed to the browser console at start-up. In summary:

**Live** — every one of the document's 151 operations is reachable through
the registry. That covers: authentication and password reset, tenants,
terminals (register, bind, fingerprint, revoke), RBAC (roles, permissions,
membership assignment), organisation (brands, branches, warehouses, central
kitchens, operating hours, print routing, station routing, brand
reassignment), catalogue (menus and their branch assignment, categories,
items, placements, variants, modifier groups and modifiers, price lists and
entries, availability 86, completeness), inventory (items, levels, batches,
movements, counts and count lines, transfers and receipts, waste, reason
codes, reorder configuration, low stock, negative stock, reconciliation),
production (recipe versions, publish, substitute groups, completeness,
modifier recipe effects), sales (list, open, add line, void pre-fire line,
fire, capture payment — partial *or* settling) and treasury (open a cash
session, pay-in, pay-out, safe drop, close context, declare the count,
finalise an above-tolerance close, publish a branch cash-close policy),
the **kitchen display** (station queue, first-viewed acknowledgement, start a
line, bump a line, bump a whole ticket, recall inside the window) and the
**day close and daily-trading report** (retrieve a persisted Z, close a
business day or activate a branch's close epoch, and the query-time trading
report the tender and tax summaries are built from).

**Still demo data** — costing, purchasing, workforce, governance, platform,
catalogue combos, inventory adjustments, security users, and two members of
finance: the cash-session index and expenses. These are not unfinished
wiring: the document has no endpoints for them at all. The console keeps its
demo data rather than showing empty screens, and nothing mixes invented rows
into a domain the backend does serve.

The dashboard is neither: it has no aggregate endpoint either, but it is
*derived* in the browser from live orders, waste, stock, terminals, tables
and — since the KDS routes landed — the station queues. What it cannot derive
it reports as null and the screen shows a dash.

Note the split inside finance. The cash **drawer** is live, and so now is the
**day close**: `POST /branches/{id}/day-closes/{day}` seals a day and returns
the Z, and `GET` reads a sealed one back. What is still not live is the
tenant-wide *list* of cash sessions, because no `GET /cash-sessions` exists —
a session is reachable by the id this client was handed when it opened the
drawer, and by nothing else.

### The day close has no index, so the list is assembled

`GET /branches/{branchId}/day-closes/{businessDay}` reads one day of one
branch and 404s for a day with no Z. There is no "list day closes". So
`finance.dayCloses.list()` asks for the last seven days of each branch in
scope and keeps what answers — real records only, a bounded number of
requests, and nothing invented for the days that 404.

That alone would give a screen that can only ever show history, because every
*persisted* record is by definition already closed. The days still to be
closed come from `GET /reports/branches/{id}/daily-trading/{day}` instead,
which is where their figures, their `periodStatus` and their blockers
(`openOrderCount`, unclosed cash sessions) come from. Those rows carry
`id: "<branchId>:<businessDay>"`, since they have no persisted id yet.

**A close returns one of two outcomes and they are not the same event.** The
first request a branch ever makes *activates* its DayClose epoch and seals
nothing (`outcome: "ACTIVATED"`); only a later request for a day inside that
epoch performs a real close (`outcome: "CLOSED"`, with the Z snapshot).
`services.finance.closeDay` returns a `DayCloseResult` carrying the outcome,
and the screen words the two differently — reporting an activation as
"business day closed" would be a lie a manager acts on.

### Which screens read which source

Eight console screens were written against the in-memory engine in
`lib/console/live/`. Six of them now have a real endpoint behind them and
choose their source by `DATA_MODE`, through the hooks in
`lib/console/feeds.ts`:

| Screen | `mock` | `http` |
| --- | --- | --- |
| Orders | this device | `GET /orders` |
| Open orders | this device | `GET /orders`, filtered by state |
| Stock movements | this device | `GET /inventory/items/{id}/movements` |
| Waste | this device | `GET /inventory/waste` |
| Kitchen queue | this device | `GET /kds/stations/{id}/queue`, per station |
| Payments (tender mix) | this device | daily-trading `tenderTotals` |
| Audit trail | this device | this device — no audit endpoint |
| Cash sessions | this device | this device — no session index |

The bottom two keep reading the device even when the console is live, and
`LiveNotice` says so in as many words. It used to promise, on every one of
these screens, that ringing something up on the POS would make rows appear —
which against a backend was false, and left a reader staring at an empty
table with a confident explanation for it.

Two notes on the middle pair. The kitchen queue fans out over the stations of
the branches in scope, and a KDS terminal is bound to one station and answers
403 for the rest — so a live fan-out returns what the caller may see rather
than failing whole. And the tender mix from `tenderTotals` has an amount and
a payment count per tender but no gross/refund split, so the refunds column
is dropped in live mode rather than shown as a dash that would read as "no
refunds today".

## Shape differences worth knowing

**Names.** `/org/*` sends one plain string; `/catalogue/*` and `/inventory/*`
send an open `{ en, ar }` map. `map.localised()` accepts either and falls back
to the other language rather than rendering a blank (FR-LOC-007).

**Money.** The API carries exact decimal strings ("12.500") because a float
cannot price a sale (BR-CORE-003). The console carries minor units plus a
currency. `map.minorUnits()` converts with string arithmetic. The currency of
rows that carry none is the tenant's, learned at sign-in.

**Lists.** Most list endpoints answer with a bare array — no envelope, no
`?search=`, no `?sort=`. `paging.project()` applies the toolbar's query
client-side. `GET /orders` is the exception: a real keyset cursor, walked
forward in `http.ts`.

**Fan-out.** `list()` issues one call and returns what it gives; `get()`
fetches the joins. A menu item's variants, placements and prices are three
more requests, which is right for a detail page and wrong for a table of 400
rows. Lookup tables everything needs — branches, locations, stock items — are
memoised for ~20 seconds and invalidated on write.

## Known gaps

Each is marked `// gap:` at the point it bites.

| Gap | Effect |
| --- | --- |
| No unit catalogue endpoint | Quantities are labelled `pc` unless units are registered. Call `map.registerUnits({ "<uuid>": "kg" })` once at start-up to fix this properly. |
| No landed cost on stock items | Only `standardCost` is available, so stock valuations use it. |
| No purchasing endpoints | `onOrder` is always zero; supplier fields are null. |
| No station routing on items | `stationType` reads `pass`; routing lives in per-branch rules. |
| Table state is not modelled | Every table reads `available`; the floor plan overlays open orders itself. |
| No movement index | `inventory.movements.list()` needs `filters.itemId`, and returns an empty page without it. |
| No count / transfer index | A count or transfer is reachable by id after this client creates it. |
| Per-role permissions are not exposed | `/auth/permissions` returns the *caller's* effective codes, so `roles.list()` can only fill the caller's own. |
| Roles are flat codes, console roles are named | `roleFromPermissions()` picks the closest named role for **navigation only**; the server authorises every request regardless (FR-SEC-045). |
| No branch seat count / area | Read from the opaque `address` blob if present, otherwise zero. |
| No unit catalogue, and `baseUnitId` is required | Creating a stock item asks for a real `inventory.uom` id, because there is no endpoint to offer a picker from. |
| No item→modifier-group read | `POST /items/{id}/modifier-groups` attaches; nothing lists what is attached, so the item drawer can add but not show. |
| No tenant-wide membership index | `GET /auth/tenants` returns only the *caller's* memberships, so roles can be assigned to the signed-in account and no other. |
| No terminal app version / queue depth | `appVersion` reads "—" and `queuedOperations` zero; both are device-side figures the REST surface does not carry. |
| No pairing-code concept | The device screen lists real terminals to bind to instead. See `app/(auth)/register-device/page.tsx`. |
| Country pack must be activated for pricing | `POST /orders` answers 422 `CountryPackUnavailableError` until an activated, signed country pack is in force. The POS surfaces the backend's own message. |
| No `GET /cash-sessions` | A cash session is reachable only by the id this client was handed when it opened the drawer. The console's cash-sessions screen therefore shows what the terminals on *this device* did, and says so. |
| No cash-close policy read | `POST /branches/{id}/cash-close-policy` publishes a version; nothing lists them. Whether one exists is inferred from `close-context` omitting `toleranceMinorUnits`. |
| No unit id for a sub-recipe recipe effect | `PUT /modifiers/{id}/recipe-effects` needs a unit UUID for an `add`, and the only real one available is a stock item's `baseUnitId`. The editor offers `add` against stock items; an existing sub-recipe `add` renders and round-trips but is not editable. |
| `recipeDelta` is not on the modifier row | `GET /modifier-groups/{id}/modifiers` carries no recipe delta, so the modifiers screen reads each modifier's effects from `GET /modifiers/{id}/recipe-effects` on demand rather than fanning out over the whole list. |
| KDS `status` is an open string | The document declares both `ticket.status` and `line.status` as a bare `{"type":"string"}` with no enum, so the values are not knowable from the contract. `map.toKitchenTicket` derives state from the timestamps instead — `startedAt`, `readyAt`, `bumpedAt`, `recalledAt`, `cancelledAt` — which are specified and cannot drift. A `status` that happens to spell a state the console knows is still honoured. |
| No ticket priority or cancel reason | The KDS routes carry no rush/VIP/remake flag and no cancellation reason, so `priority` reads `normal` and `cancelReason` null. The live display lists both as unavailable rather than rendering an always-absent badge. |
| No station or branch on a KDS ticket | A ticket carries `stationId` and nothing about the station. `http.ts` memoises the branches' stations and joins on it for the name and the branch. |
| A KDS queue needs a bound terminal | The read wants `kds.operate` on a terminal bound to *that* station, so a console session is normally refused for every station. `operations.kitchenQueue` returns the stations it may read; a clean sweep of refusals is re-thrown rather than flattened into an empty table, and the dashboard reports queue depth as `null` rather than zero. Point a browser at `/kds` from a registered KDS terminal to see the queues. |
| No bumped-ticket index | Recall is offered only for bumped tickets the station queue itself returns. If the queue drops them at the bump, the recall strip is empty rather than rebuilt from what the browser remembers. |
| No day-close index | `GET /branches/{id}/day-closes/{day}` reads one day; there is no list. `dayCloses.list()` asks for the last seven days per branch and keeps what answers, and fills the unsealed days from the daily-trading report. |
| Daily trading is single-branch | `GET /reports/.../daily-trading/{day}` is 403 unless the tenant has exactly one active branch, 400 for a future day and 409 on a mixed-currency day. None of those is an outage, so each reads as "no report for this branch and day" and the screen moves on. |
| No refund split in `tenderTotals` | The report carries an amount and a payment count per tender and no gross/refund breakdown, so the payments screen drops its refunds column in live mode instead of showing a dash. |
| Tax classes are opaque on a Z | The Z snapshot's `taxByClass` carries only `taxClassId`, a uuid; the live report also carries a free-form `taxClassCode`. Neither is coerced into one of the console's four named classes — an unrecognised one renders as itself, and the rate is computed as tax ÷ net. |
| Day-close money is in minor units | Like treasury and unlike everything else, every amount on both new financial endpoints is a minor-unit decimal string (`pattern: ^-?\d+$`). They go through `map.minorMoney`, never `map.money`, which would multiply them by a hundred. |

## The POS against this backend

The demo POS in `components/terminal/pos-*.tsx` runs on the in-memory engine
in `lib/console/live/` and simulates the whole SRS — discounts, comps,
splits, refunds, courses, table state, KDS tickets. The backend implements
six order operations and none of that.

Bridging one onto the other would produce a till whose discount button does
nothing to the server, so `app/(terminal)/pos/page.tsx` chooses between them
by `DATA_MODE`:

| Mode | Screen | Behaviour |
| --- | --- | --- |
| `mock` | `pos-*.tsx` | The full simulation, unchanged |
| `http` | `pos-live.tsx` + `pos-drawer.tsx` | Open cash session → open order → add line → void pre-fire line → fire → capture payment (partial or settling) → move cash → count and close the drawer |

A fired order now reaches a real kitchen display: see below.

`pos-live.tsx` lists what the API cannot do rather than hiding those
controls, because a till that appears to take a discount and does not is
worse than one that says it cannot. `kds-live.tsx` does the same in its side
panel.

One refusal is deliberate on the backend's side and is passed through
verbatim rather than worked around:

- **Post-fire voids.** Only pre-fire voids exist. After Fire the line belongs
  to the kitchen and there is no endpoint to take it back.

Full settlement used to be a second such refusal and no longer is:
`POST /payments` completes an order atomically when the payment covers the
outstanding balance. The payment drawer therefore defaults the amount to that
balance, and reports a settling payment differently from a partial one.

Order writes carry `if-match: <version>`, so a second terminal editing the
same order is refused with 412 rather than silently overwriting.

### The cash drawer close — FR-POS-094/095/096/097, FR-FIN-006

`pos-drawer.tsx` implements a state machine, not a form, because the backend
has one. `declareClose` either lands within tolerance and closes the session
in the same request, or freezes it at `closing`; `finalizeClose` is the only
way out of frozen, and an explicit rejection leaves it frozen for another
attempt.

Three details are easy to get wrong and are handled explicitly:

- **A blind count withholds figures structurally.** Under `countMode: "blind"`
  the server *omits* `expectedCashMinorUnits` and `toleranceMinorUnits` from
  `GET /close-context` — they are absent, never `null`. The generator marks
  every declared response property as present, so `http.ts` reads that
  response as a partial shape and the UI renders a dash. Filling it with a
  zero would defeat FR-POS-095 outright.
- **A rejection is a committed 200.** `finalizeClose` answers
  `outcome: "rejected"` rather than throwing. The outcome is read from the
  response; the absence of an error means nothing here. A retry mints fresh
  `approvalRequestId` and `approvalDecisionId` values.
- **The PIN is the manager's, not the cashier's.** The server checks
  `cash.variance.approve` against the *verified manager's* permission set, so
  the form asks for a manager employee code alongside it.

`GET /cash-sessions/{id}/close-context` enforces the same own/other
permission split as the writes, so a cashier cannot probe another employee's
drawer state.

## The kitchen display against this backend

The same split, for the same reason. The demo KDS in
`app/(terminal)/kds/page.tsx` runs on the in-memory engine and simulates more
of ch.9 than the API implements: staggered release, an expediter pass view,
cancellation acknowledgement, rush and VIP priorities. The backend implements
six KDS operations:

| Mode | Screen | Behaviour |
| --- | --- | --- |
| `mock` | `app/(terminal)/kds/page.tsx` | The full simulation, unchanged |
| `http` | `components/terminal/kds-live.tsx` | Pick the station → read the queue → acknowledge first view → start a line → bump a line → bump the ticket → recall inside the window |

Three things are worth knowing about the live display.

**The station is a property of the device, not of the visit.** The backend
binds a KDS terminal to exactly one station and answers 403 for any other, so
the picker writes `ros.api.kdsStationId` to `localStorage`. A screen on a
kitchen wall gets power-cycled, and it has to come back showing the line it
was showing rather than a chooser nobody is standing at.

**Start is per line.** There is no ticket-level start on this API, so the
button sits with the line it applies to. Bump exists at both levels and both
are wired: tapping a line bumps that line, and the hold-to-bump footer calls
`POST /kds/tickets/{id}/bump-all`.

**It polls.** There is no stream, and a display that is five seconds stale is
a display that works. The interval is torn down while a mutation is in flight
so a bump is never overwritten by a read that started before it.

### Treasury money is already in minor units

Every other endpoint sends money as a decimal string ("12.500"). Treasury
sends minor units — "1250" means 12.50. Passing one of those through
`map.money()`, which reads a *decimal*, multiplies the figure by a hundred,
so treasury responses go through `map.minorMoney()` instead. It is the only
money conversion in the file that is a straight parse.

## Adding an endpoint the backend has just built

0. `npm run api:check` — it names what the deployment serves that the
   snapshot does not.
1. Replace `api/openapi.json` (`curl <base>/docs-json`), run `npm run api:types`.
2. Fix whatever `npm run typecheck` now objects to.
3. Add a mapper in `map.ts` if the shape is new.
4. Replace the `mockServices.…` line in `http.ts` with the real
   implementation, and move its entry from `API_COVERAGE.demo` to `.live`.

Steps 1–4 need no page, component or hook changes: an endpoint that fills a
service the console already calls appears wherever that service is read.

A genuinely **new capability** is different, and pretending otherwise is how
a wired-up endpoint ends up with nothing calling it. Extend the interface in
`services/types.ts`, implement it in both `http.ts` and `mock.ts` — refusing
honestly there via `noBackend()` beats inventing rows — and then build the
screen. The cash-drawer close is the worked example: seven endpoints, one new
service contract, and `components/terminal/pos-drawer.tsx`.
