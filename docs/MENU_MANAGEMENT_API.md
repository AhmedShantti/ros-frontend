# Menu Management — canonical endpoint mapping (`/menu/management`)

MENU-MANAGEMENT-CANONICAL-INTEGRATION-P0 — this document used to specify an
invented `/menu-management/*` contract for a backend that never implemented
it. It didn't exist on the server, and the workspace's default
"production" behaviour was actually a silent, empty in-memory store. Both
are gone. This is now the honest mapping.

## Two implementations, one switch

`app/(console)/menu/management/page.tsx` renders one of two components,
chosen by `DATA_MODE` (`lib/api/config.ts`) — the same switch every other
console screen already uses, not a bespoke env var of this workspace's own:

| `DATA_MODE` | Component | Data source |
|---|---|---|
| `"mock"` (explicit demo mode) | `components/console/menu-management/menu-management.tsx` | `lib/console/menu-management/memory-adapter.ts` — an empty in-memory store. Simulates the full intended shape (combos, per-channel/per-size pricing, a publish/dirty flag) that the backend does not implement yet. Never rendered against a real backend. |
| `"http"` (a real backend is configured) | `components/console/menu-management/live-menu-management.tsx` | `services.catalogue` (the app's real, canonical service registry) + `lib/console/menu-management/live-adapter.ts` for the two shapes that registry does not expose menu-scoped. Only offers what `/catalogue/*` actually implements. |

The demo sandbox's own data layer (`lib/console/menu-management/{api,memory-adapter,types,menu}.ts`)
is unchanged and is documented only for what it simulates — it is never the
production path, so its shapes below are not a server contract.

## What the LIVE workspace actually calls

All real, all already used elsewhere in the console (`/menu/menus`,
`/menu/categories`, `/menu/items`) — nothing here is new backend surface:

| Concern | Canonical call |
|---|---|
| List / create menus | `services.catalogue.menus.list/create` → `GET/POST /catalogue/menus` |
| Activate / deactivate a menu | `services.catalogue.setMenuActive` → `POST /catalogue/menus/{id}/status` |
| Assign / unassign a branch | `services.catalogue.assignMenuToBranch` / `unassignMenuFromBranch` → `POST`/`DELETE /catalogue/menus/{id}/branches[/{branchId}]` |
| Branch resolution + ambiguity | `services.catalogue.resolveBranchMenus` → `GET /catalogue/branches/{id}/menus` |
| List / create categories **for one menu** | `live-adapter.ts#listMenuCategories/createMenuCategory` → `GET/POST /catalogue/menus/{menuId}/categories` (the menu-scoped route directly — `services.catalogue.categories` flattens every menu's categories into one tenant-wide list for the legacy `/menu/categories` screen and drops which menu each came from, which this workspace needs) |
| List items, resolve each one's category | `live-adapter.ts#listItemsWithPlacements` → `services.catalogue.items.list` + `GET /catalogue/items/{id}/placements` per row (the API has no "items in category X" index, only "categories this item is in") |
| Create an item (+ its default variant, priced) | `services.catalogue.items.create` → `POST /catalogue/items` with `variants: [{ name, price, currency }]` inline — the item and its sellable variant(s) are created atomically, in one call. No Price List concept exists; there is no second step to make a new item sellable. |
| Edit an item | `services.catalogue.items.update` → `PATCH /catalogue/items/{id}` (never touches variants — see the row below for that) |
| Move an item's category | `services.catalogue.placeItem` → `POST /catalogue/items/{id}/placements` |
| Tax class | `services.catalogue.listTaxClassesForBranch` → `GET /catalogue/branches/{id}/tax-classes` (shared component: `components/console/catalogue/tax-class-field.tsx`) |
| Available / 86 | `services.catalogue.toggleAvailability` → `POST /catalogue/availability-rules/{id}/86` |
| Deactivate an item | `services.catalogue.items.remove` → `POST /catalogue/items/{id}/status {isActive:false}` (never a hard delete — none exists) |
| Add a FURTHER variant to an item that already exists | `services.catalogue.addVariant` → `POST /catalogue/items/{id}/variants` — requires its own `price`; the item is already sellable via its existing variant(s) before this call |
| Edit a variant's direct price | `services.catalogue.updateVariantPrice` → `PATCH /catalogue/variants/{id}/price` — edited inline, in the same drawer, no separate pricing workspace |

## Deliberately not implemented here (report, don't fake)

- **Combos** — `POST /catalogue/*` has no combo table, service or endpoint
  at all (`MenuItem.isCombo` is a retained-but-dead flag). Nothing to call;
  the Combos tab stays on the legacy `/menu/combos` page, which is itself
  non-functional against a live backend (`unsupportedCombos`).
- **Per-channel / per-size price editing** — every variant has exactly one
  direct price (`basePriceMinor`/`currency`); there is no branch-, order-type-
  or time-based override concept on the backend to write to. If product
  needs per-channel/per-size pricing later, it is designed then. There is no
  `/menu/pricing` route any more — the Price List concept it hosted was
  removed entirely, not replaced.
- **Modifier-group management from this workspace** — real backend
  endpoints exist, but wiring create/attach/delta editing here is deferred.
  Stays on `/menu/modifiers`.
- **"Hidden"** — not a flag on this backend. An item is hidden from a menu
  by having no category placement at all; there is no one-click "hide"
  action for that yet, so the live editor says so instead of faking a
  status the server cannot persist.
- **Duplicate** — no clone endpoint, and no item field this slice has
  verified is safe to copy without server identifiers. Not offered; hide
  the control rather than fabricate a "safe" clone.
- **Item images** — a `MenuItemImage` table exists in the schema with zero
  API wired to it. Nothing to call.
- **Category delete/deactivate** — no such endpoint exists. No delete
  control is rendered.

## Related

- [`docs/MENU_MANAGEMENT_TESTING.md`](MENU_MANAGEMENT_TESTING.md) — manual
  test checklist (demo-sandbox flows; see the automated suites under
  `lib/console/menu-management/` and `components/console/menu-management/`
  for the live workspace).
- [`BACKEND_INTEGRATION.md`](../BACKEND_INTEGRATION.md) — the console-wide
  `DATA_MODE`/`services` convention this workspace now follows.
