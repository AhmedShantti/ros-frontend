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

The first form pings `/health`. The second signs in, lists tenants, selects
one, and reads every scoped list the console depends on — which is where a
"connected but blank" setup actually breaks.

## On a local network

The backend is at a different origin from the page, so three things have to
be true and only the first is obvious:

1. **The API binds `0.0.0.0`, not `127.0.0.1`.** A NestJS app defaults to
   listening on all interfaces, but `app.listen(3000, '127.0.0.1')` is
   reachable only from the API machine itself.
2. **The browser is allowed to read the response.** Two headers decide this,
   and as of this writing the backend at `192.168.1.43:3000` sends neither
   correctly — see below.
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
| `lib/api/endpoints.ts` | 133 typed calls, grouped by tag: `api.catalogue.listItems()` |

Drop in a new spec export, re-run, and `tsc --noEmit` will point at every
call the backend has changed under you.

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

**Live** — every one of the document's 133 operations is reachable through
the registry. That covers: authentication and password reset, tenants,
terminals (register, bind, fingerprint, revoke), RBAC (roles, permissions,
membership assignment), organisation (brands, branches, warehouses, central
kitchens, operating hours, print routing, station routing, brand
reassignment), catalogue (menus and their branch assignment, categories,
items, placements, variants, modifier groups and modifiers, price lists and
entries, availability 86, completeness), inventory (items, levels, batches,
movements, counts and count lines, transfers and receipts, waste, reason
codes, reorder configuration, low stock, negative stock, reconciliation),
production (recipe versions, publish, substitute groups, completeness),
sales (list, open, add line, void pre-fire line, fire, capture payment) and
treasury (open cash session).

**Still demo data** — dashboard, costing, purchasing, workforce, finance,
governance, platform, catalogue combos, inventory adjustments, kitchen queue,
security users. These are not unfinished wiring: the document has no
endpoints for them at all. The console keeps its demo data rather than
showing empty screens, and nothing mixes invented rows into a domain the
backend does serve.

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
| `http` | `pos-live.tsx` | Open cash session → open order → add line → void pre-fire line → fire → capture **partial** payment |

`pos-live.tsx` lists what the API cannot do rather than hiding those
controls, because a till that appears to take a discount and does not is
worse than one that says it cannot.

Two refusals are deliberate on the backend's side and are passed through
verbatim rather than worked around:

- **Full settlement.** `POST /payments` rejects a payment that would close
  the order; Completion is not implemented.
- **Post-fire voids.** Only pre-fire voids exist. After Fire the line belongs
  to the kitchen and there is no endpoint to take it back.

Order writes carry `if-match: <version>`, so a second terminal editing the
same order is refused with 412 rather than silently overwriting.

## Adding an endpoint the backend has just built

1. Replace `api/openapi.json`, run `npm run api:types`.
2. Fix whatever `npm run typecheck` now objects to.
3. Add a mapper in `map.ts` if the shape is new.
4. Replace the `mockServices.…` line in `http.ts` with the real
   implementation, and move its entry from `API_COVERAGE.demo` to `.live`.

No page, component or hook changes.
