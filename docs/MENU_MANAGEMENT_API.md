# Menu Management — API contract (`/menu/management`)

The Menu Management workspace (`app/(console)/menu/management`) reads and
writes only through `MenuManagementApi` in
`lib/console/menu-management/api.ts`. Two implementations exist:

| Mode | File | When |
|---|---|---|
| memory | `lib/console/menu-management/memory-adapter.ts` | default — an **empty** in-memory store, nothing saved, resets on refresh |
| http | `lib/console/menu-management/http-adapter.ts` | `NEXT_PUBLIC_MENU_MANAGEMENT_API=http` in `.env.local` (restart `next dev`) |

The http adapter goes through the console's own `lib/api/client` — so the
base URL (`NEXT_PUBLIC_API_URL`), bearer token, token refresh and error model
are the same as every other screen. It does **not** switch on just because
`NEXT_PUBLIC_API_URL` is set, because the endpoints below are a proposal the
backend does not serve yet; the existing `/catalogue/*` routes are untouched.

All paths below sit under `MENU_MANAGEMENT_BASE` (`/menu-management`, in
`http-adapter.ts`). If the backend lands them elsewhere, change the base or
the individual paths in that one file — nothing else knows URLs.

Brand and branch options on the page come from the console session
(`useSession().availableBrands / availableBranches`), the same lists as the
top-bar switcher, so `GET /brands` and `GET /branches` below are optional.

IDs can be numbers or strings (UUIDs are fine) — the UI never assumes a type.
Errors: any non-2xx; the `message` in the body is shown to the user (handled by
`lib/api/client`).

---

## Data shapes

### Menu
```json
{
  "id": "m_1",
  "name": "Lunch Menu",
  "description": "Lunch items and daily specials.",
  "brandId": "b_1",              // nullable
  "branchIds": ["br_1", "br_2"], // empty = all branches
  "hasUnpublishedChanges": true,
  "publishedAt": "2026-09-22T10:00:00Z" // nullable
}
```

### Category
```json
{ "id": "c_1", "menuId": "m_1", "name": "Burgers", "position": 0, "items": [Item, ...] }
```
`items` is only included inside `GET /menus/:menuId/content`.

### Item
```json
{
  "id": "i_1",
  "categoryId": "c_1",
  "name": "Chicken Burger",
  "kitchenName": "Chicken Burger",
  "description": "Grilled chicken, lettuce and house sauce.",
  "status": "available",                // "available" | "unavailable" (sold out, still shown) | "hidden" (not shown)
  "pricingMode": "single",              // "single" | "channel" | "size"
  "price": 12.0,                        // base / dine-in price. For "size" = first size's price
  "channelPrices": { "takeaway": null, "delivery": 13.5 }, // only used when pricingMode = "channel"; null = same as price
  "sizes": [ { "id": "s_1", "name": "Single", "price": 12.0 } ], // only used when pricingMode = "size"
  "modifierGroupIds": ["g_1", "g_2"],   // customization groups attached to this item
  "position": 0
}
```

### Combo
```json
{
  "id": "cb_1",
  "menuId": "m_1",
  "name": "Chicken Meal",
  "description": "Burger, side and a drink.",
  "status": "available",          // same values as Item.status
  "pricing": "fixed",             // "fixed" | "discount"
  "price": 16.0,                  // when pricing = "fixed", else null
  "discountPercent": null,        // 1–99 when pricing = "discount", else null
  "slots": [
    { "id": "sl_1", "label": "Main", "itemIds": ["i_1", "i_2"] } // customer picks one; first = default
  ]
}
```
Discount combos cost: sum of the chosen item in each slot × (1 − discountPercent/100).

### ModifierGroup (customization group)
Shared across all menus of the account.
```json
{
  "id": "g_1",
  "name": "Sauces",
  "required": false,
  "multiple": false,
  "maxSelections": null,          // only when multiple = true; null = no limit
  "options": [ { "id": "o_1", "name": "Mayo", "price": 0.5 } ]  // price = extra charge
}
```

### Brand / Branch (read-only, used when creating a menu)
```json
{ "id": "b_1", "name": "TRENDOW" }
{ "id": "br_1", "name": "Downtown", "brandId": "b_1" }
```
Optional — the page reads brands/branches from the console session. Return `[]` if unused.

The Brand / Branch filters at the top of the page filter the menu list **in the browser**: a menu shows when its `brandId` matches (or is null) and its `branchIds` include the branch (or are empty). No extra endpoint is needed; if the menu list gets large, `GET /menus?brandId=&branchId=` can be added later.

### Nested row ids (sizes, options, slots)
When the UI creates a new size / option / slot it sends a temporary id like `"size-lz3k-ab12c"` (always a string starting with `size-`, `opt-` or `slot-`).
The server should treat any id it doesn't recognise as new, assign a real id, and return the saved object. Rows missing from a `PUT` body are deleted.

---

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/menu-management/brands` | – | `Brand[]` |
| GET | `/menu-management/branches` | – | `Branch[]` |
| GET | `/menu-management/menus` | – | `Menu[]` |
| POST | `/menu-management/menus` | `{ name, description, brandId, branchIds }` | `Menu` |
| POST | `/menu-management/menus/:menuId/publish` | – | `Menu` (with `hasUnpublishedChanges: false`) |
| GET | `/menu-management/menus/:menuId/content` | – | `{ categories: Category[] (each with items, ordered by position), combos: Combo[] }` |
| POST | `/menu-management/menus/:menuId/categories` | `{ name }` | `Category` |
| POST | `/menu-management/menus/:menuId/items` | Item without `id` (includes `categoryId`) | `Item` |
| PUT | `/menu-management/items/:itemId` | Item without `id` (full replace; `categoryId` may change = move) | `Item` |
| PATCH | `/menu-management/items/:itemId` | `{ status }` | `Item` |
| DELETE | `/menu-management/items/:itemId` | – | `204` |
| POST | `/menu-management/menus/:menuId/combos` | Combo without `id` / `menuId` | `Combo` |
| PUT | `/menu-management/combos/:comboId` | Combo without `id` / `menuId` | `Combo` |
| PATCH | `/menu-management/combos/:comboId` | `{ status }` | `Combo` |
| DELETE | `/menu-management/combos/:comboId` | – | `204` |
| GET | `/menu-management/modifier-groups` | – | `ModifierGroup[]` |
| POST | `/menu-management/modifier-groups` | ModifierGroup without `id` | `ModifierGroup` |
| PUT | `/menu-management/modifier-groups/:groupId` | ModifierGroup without `id` (full replace) | `ModifierGroup` |
| DELETE | `/menu-management/modifier-groups/:groupId` | – | `204` |

## Server rules the UI relies on
1. **Deleting an item** also removes its id from every combo slot.
2. **Deleting a modifier group** also removes its id from every item's `modifierGroupIds`.
3. Any change to a menu's categories, items or combos sets that menu's `hasUnpublishedChanges = true`. Changing a modifier group should flag every menu that uses it.
4. **Publish** makes the current draft what customers/POS see and sets `hasUnpublishedChanges = false`. Customer-facing and POS endpoints should read the published version, not the draft.
5. Customer-facing output: skip `hidden` items/combos; show `unavailable` ones as sold out and reject orders for them. A combo can't be ordered if any slot has no `available` item.
6. Validate on the server too: name required; price ≥ 0; `pricingMode = "size"` needs ≥ 1 size; combo needs ≥ 1 slot and each slot ≥ 1 item; `discountPercent` 1–99; a group needs ≥ 1 option. Return `400` with `{ "message": "..." }` — the message is shown in the editor.

## Not in the UI yet (safe to add later)
Reordering categories/items (`position` is already in the shape), renaming/deleting categories, editing/deleting menus, item images upload, per-option availability, per-branch price overrides.
