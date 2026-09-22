# Menu Management — manual test checklist (`/menu/management`)

Run `npm run dev`, sign in, open **Menu & Recipes → Menu Management** in the sidebar, and go top to bottom. Each step says what you do → what you should see.
Until `NEXT_PUBLIC_MENU_MANAGEMENT_API=http` is set (see `docs/MENU_MANAGEMENT_API.md`) everything starts empty and resets on refresh — that's expected.

## 1. Menus
1. Open the page → "No menus yet" with a **Create menu** button.
2. Click **Create menu**, leave the name empty → **Create menu** button is disabled.
3. Type `Lunch`, press **Enter** → window closes, the menu picker shows **Lunch**, publish button says **Publish changes**.
4. Click the menu picker → **+ Create new menu** → create `Dinner` → Dinner is selected and empty.
5. Switch back to **Lunch** from the picker → Lunch's content is still there (menus don't share content).

## 2. Brand / branch filters (options come from the console session, same as the top-bar switcher)
1. Click **Brand** → list shows **All brands** + every brand. Pick one → the menu picker only lists menus for that brand (plus menus with no brand).
2. Click **Branch** → only branches of the chosen brand are listed. Pick one → only menus for that branch (or for all branches) remain.
3. With a brand + branch picked, click **+ Create new menu** → the form is pre-filled with that brand and branch.
4. Pick a combination with no menus → "No menus for this brand / branch".

## 3. Categories
1. Click **+ Add category** → a name box opens under the list. Press **Esc** → it closes.
2. Open it again, empty name → **Add** is disabled.
3. Add `Burgers`, `Pizza`, `Drinks` (press **Enter** each time) → each appears and gets selected; counts show 0.

## 4. Items
1. In **Drinks**, click **Add item** → the Category field is already **Drinks**.
2. Type only a name → footer hint says "Add a price."; pressing **Enter** does nothing.
3. Price `2.5`, press **Enter** → drawer closes, item appears, price shows your currency.
4. **Different prices → By channel**: item price `12`, Delivery `13.5` → card shows "+1 channel price".
5. **Different prices → By size**: Small `9`, Large `14`, plus an extra row with a name but no price → save → card shows "From 9.00 · 2 sizes" (the incomplete row is dropped). Re-open → By size is selected with the 2 sizes.
6. Change an item's **Category** and save → it moves; both category counts update.
7. Open **Add item**, type something, click the dimmed page outside the drawer → drawer closes, nothing saved.
8. **Hide item or mark unavailable** in the editor → pick **Unavailable** → badge "Sold out". Pick **Hidden** → badge "Hidden", row looks faded.
9. **⋯ menu** on a row: Mark unavailable / Hide / Available each change the badge immediately.
10. **⋯ → Duplicate** → "(copy)" appears right below.
11. **⋯ → Delete** → first click turns into "Click again to delete"; second click removes it. In the editor: **Delete item → Yes, delete**.
12. **All items** → every item with its category tag. Search box filters by name; nonsense text → "No items match your search".

## 5. Customizations
1. Click **Customizations** → "No customization groups yet" → **New group**.
2. Name `Sauces`, press **Enter** with no options → red "Add at least one option."
3. Add `Ketchup` (0) and `Mayo` (0.75) — decimals type fine. Tick **Allow more than one choice**, max `2` → preview line says "Optional · up to 2".
4. Press **Enter** → "All changes saved" (window stays open). Press **Enter** again → window closes.
5. Edit an item → tick **Sauces** → save → "Sauces" tag on the card.
6. In an item, **+ Create customization group** → name `Ice` → **Enter** → group window opens with that name; add an option, **Done** → back in the item, Ice is already ticked.
7. Rename Sauces to `Dips`, then click another group on the left → it saves automatically; item tags now say "Dips".
8. The group shows "Used on N items in this menu" with their names.
9. **Delete group → Yes, delete** → it disappears from the list and from every item's tags.

## 6. Combos
1. Click **Combos** (left, under DEALS) → "No combos yet". Click **Create combo**.
2. Before adding items → no savings box, just "Add items to the combo to see how much the customer saves."
3. Name `Solo`, add one item to **Main** only, leave Side and Drink empty, price `8` (item costs 9) → "Customer saves 1.00 (11%)". **Enter** → saved with just "Main".
4. New combo: two items in Main (first one is marked **default**), one Drink, choose **Discount %** `20` → combo price = default items total × 0.8.
5. Price higher than the items → red "Combo costs more than buying the items separately".
6. Edit a combo → empty parts are gone; rename and save.
7. **⋯** → Duplicate / Mark unavailable / Delete work like items.
8. Mark the only item of a combo part as **Unavailable** → combo row shows "Can't be ordered".
9. Delete an item that's inside a combo → it disappears from the combo.

## 7. Preview
1. Click **Preview menu** → hidden items are missing; unavailable ones show "Sold out" with the price struck through.
2. Sized items list each size on its own row; customization groups and their extra charges are listed under items.
3. Switch **Dine-in / Takeaway / Delivery** at the top → channel prices change (e.g. 12.00 → 13.50 on Delivery). Combos section appears first.

## 8. Publish
1. After any change → button says **Publish changes**.
2. Click it → **Publishing…** then **Published ✓** (greyed out, can't click again).
3. Make any change (add/edit/hide an item, edit a combo, add a category) → button goes back to **Publish changes**.
4. Edit a customization group used by items → **Publish changes** again.
5. Publish **Lunch**, switch to **Dinner** → Dinner has its own state; switch back → Lunch still **Published ✓**.

What publish does *today*: in memory mode it only records "published". With the http adapter it calls `POST /menu-management/menus/:id/publish`; what customers/POS then see is up to the backend (see `docs/MENU_MANAGEMENT_API.md` → "Server rules", point 4). The preview always shows the current draft.

## 9. Keyboard
- **Enter** in any text box inside a window/drawer = that window's main button (Save item, Create combo, Create menu, Save group).
- **Enter** in the description box = new line.
- **Esc** closes the add-category box and the new-group name box.

## 10. With the http adapter on (`NEXT_PUBLIC_MENU_MANAGEMENT_API=http`)
1. Stop the backend and reload → "Couldn't load Menu Management" + **Try again**.
2. Make the server reject a save (e.g. return `400 {"message":"Name already used"}`) → the message appears in red next to the Save button and the drawer stays open.
3. A failed quick action (⋯ menu, publish) → dark message at the bottom of the screen for 5 seconds.

## Automated checks

```bash
npx vitest run lib/console/menu-management components/console/menu-management lib/console/nav.menu-management.test.ts
```

- `lib/console/menu-management/menu.test.ts` — channel / size pricing, combo pricing and blocked parts, rule text.
- `lib/console/menu-management/memory-adapter.test.ts` — empty start, publish flag, temporary-id replacement, delete-item-from-combo, delete-group-from-items.
- `components/console/menu-management/menu-management.test.tsx` — the page end to end: menu → category → item → publish.
- `lib/console/nav.menu-management.test.ts` — the sidebar entry is first in Menu & Recipes and every existing menu screen is still there.
