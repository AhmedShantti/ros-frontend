# ROS Frontend — Build Status

Working state as of the last session. `npx tsc --noEmit` and `npx next build`
both pass.

Companion files: `docs/FRONTEND_COVERAGE.md` (477 frontend-relevant SRS
requirements, extracted per module) and `docs/srs-requirements.json`.

---

## Shared foundations — DONE

These are finished and everything else should build on them rather than
re-inventing.

| Thing | Where | Notes |
|---|---|---|
| Confirmation system | `components/console/confirm.tsx` | `useConfirm()`, `useConfirmDelete()`, type-to-confirm for irreversible actions. Mounted in `ConsoleProvider`. |
| Dialog focus | `lib/console/hooks.ts` → `useDialogFocus` / `useDialogRefs` | Focus trap, initial focus (`data-autofocus`), restore on close. Wired into `Modal` and `Drawer`. |
| Bilingual authoring | `components/console/fields.tsx` → `LocalisedField`, `LocalisedText` | Per-language inputs with `dir`, copy-across, fallback marking. |
| Form controls | `components/console/fields.tsx` | `MoneyInput` (minor units), `QuantityInput`, `PercentInput`, `DateRangeField`, `SearchSelect`, `EmptyState`, `OriginBadge`. |
| Form engine | `components/console/record-drawer.tsx` | Field kinds: text, number, select, textarea, date, time, toggle, money, localised, search. Per-field validation, conditional visibility. |
| Export | `lib/console/export.ts`, `components/console/export-button.tsx` | Real CSV (RFC 4180 + BOM), real XLSX (hand-built OOXML + ZIP + CRC-32), real PDF. Logged via `lib/console/export-log.ts`. Async threshold at 50k rows. |
| Backend-later seam | `lib/console/local-store.ts` | `localCollection` / `localDocument` behind the existing `CollectionService<T>` interface. Namespaced per tenant via `lib/console/services/tenant-context.ts`. |
| Copy tooling | `scripts/add-copy.mjs` | Adds keys to `content/console/{en,ar}.ts` together. **Use this** — a key added to one file alone is a build error. |

**All 13 `notInBuild` stubs are gone.** Nothing in the console is a dead button.

---

## Modules — DONE

- **Onboarding wizard** — `/onboarding`, all 15 steps, driven by the existing
  `store/onboarding.ts` + `schemas/onboarding.ts`. Progress rail, skip, save
  and resume, preview, sample sale, completion checklist.
- **Recipe BOM editor** — `components/console/recipe-editor.tsx`. Add / edit /
  remove components, units, per-line wastage, yield, substitute groups, cycle
  detection with the path shown, live cost, draft → publish, version history,
  recipe scaling.
- **Waste and adjustments** — `components/console/inventory-entry.tsx`, wired
  into both pages. Full FR-INV-057 reason taxonomy, true-waste vs controlled
  consumption, approval thresholds, photo capture.
- **Expiry worklist** — write-off, transfer and markdown, all live at every
  horizon rather than only after expiry.
- **Customers & loyalty** (new module) — `/customers`, `/customers/loyalty`,
  `/customers/promotions`, `/customers/segments`. Service in
  `lib/console/services/crm.ts`. Quick-create, order history, per-channel
  consent grid, block, GDPR erase + subject export, points ledger, tiers,
  promotion builder with plain-language summary, coupon generation, RFM
  segments with consent-gated export. Nav section + 10 permissions added.
- **Purchasing** — `components/console/purchasing-forms.tsx`. Supplier
  create/edit, requisition, PO with approval-band preview, goods receipt
  (batch, expiry, temperature, rejection, over-receipt tolerance, price
  variance, ad-hoc lines), invoice with three-way match and dispute.
- **Workforce** — `components/console/workforce-forms.tsx`. Week-grid schedule
  builder with rule validation and projected cost, attendance correction
  (original kept beside the new value), overtime approve/reject, payroll
  export with column mapping.
- **Roles** — `components/console/permission-editor.tsx`. Full checkbox tree,
  live SoD warnings, blocking pairs disabled at selection, clone, delete,
  change diff before save.
- **Reports** — `lib/console/reports/engine.ts` + `/reports/[id]`. Parameters,
  chart, table with totals, drill-down to transactions, export, data-freshness
  and partial-period indicators.
- **POS** — barcode scanner (`components/terminal/pos-lookup.tsx`), PLU pad,
  favourites strip, open-price, misc item, weighed item;
  (`components/terminal/pos-tender.tsx`) full tender grid, split by
  equal/seat/items/amount, tips, card-terminal state machine;
  (`components/terminal/pos-print.tsx`) print queue, digital receipt delivery
  (SMS/WhatsApp/email/QR), duplicate marking, kitchen-ticket language.
- **Admin** — `components/console/admin-forms.tsx`. Expense (with petty-cash
  drawer link), combo builder with slots and allocation basis, user invite
  with MFA enforcement, integration config with write-only credentials.

---

## Remaining — P0

- [ ] **Settings hierarchy** — tenant → brand → branch → terminal resolution,
      locked settings naming the locking level, settings inspector, effective
      dating on financial settings. (FR-PLT-025…028)
- [ ] **Alerts and delivery** — alert configuration (9 triggers, thresholds,
      rate limits), scheduled report delivery, morning-brief config.
      (FR-RPT-040/041/045/046)
- [ ] **Audit** — structured filters (actor / entity / action / branch /
      correlation ID / date range), correlation-chain view, export,
      impersonation-session visibility. (FR-AUD-008/010)
- [ ] **Stock item master** — full attribute form + edit mode: purchase units
      with conversion factors, multiple barcodes, allergens, storage, shelf
      life, reorder min/max, density, account code, base-unit lock.
      (FR-INV-001…005)
- [ ] **Stock counts** — recount trigger, written explanation to unblock
      posting, ad-hoc item, barcode scanning in the count drawer.
      (FR-INV-046…049)
- [ ] **POS seat assignment** — seat picker on lines. *Split-by-seat is already
      built and works; nothing currently assigns a seat number, so it has no
      data to act on.* (FR-POS-004)
- [ ] **POS remainder** — hold-and-fire, amendment-ticket indicator, customer
      attach to order (the `CustomerQuickCreate` component is built and ready
      to mount), clock-in/out panel. (FR-POS-037/038, FR-CRM-004, FR-HRM-020)
- [ ] **Session security** — idle timeout with re-auth prompt, MFA *enrolment*
      flow (verification page exists; enrolment does not). (FR-SEC-023/026)
- [ ] **Conflict register** — `/operations/conflicts`, side-by-side version
      resolution, `isolated` connectivity mode, clock-skew banner.
      (FR-OFF-042/043)
- [ ] **Anomalies page** — `/governance/anomalies`. *Already referenced by
      `REPORT_ROUTES` in `app/(console)/reports/page.tsx`, so that link is
      currently dead.* (FR-CST-040…043)
- [ ] **Export history page** — surface `lib/console/export-log.ts`, which is
      recording but has no screen. (FR-RPT-044)
- [ ] **SoD conflict report by user** — the per-user computation already exists
      in `app/(console)/users/page.tsx`; it needs running across the
      population. (FR-SEC-017)
- [ ] **Role assignment scope + validity dates** — temporary elevation.
      (FR-SEC-002/005)
- [ ] **Menu item full edit** — surface-specific names (POS/KDS/receipt/
      aggregator), image, allergens, PLU, colour, sort order. (FR-MNU-004/005)
- [ ] **Modifier group editor** — min/max/required/allow-repeat/free-quantity,
      recipe-delta editor, per-item overrides, nested groups.
      (FR-MNU-010…013, FR-POS-023)
- [ ] **Retrofit `LocalisedField`** — nine create forms still write one string
      into both locales. Grep for `{ en: values.name.trim(), ar: values.name.trim() }`.
      (FR-LOC-006)
- [ ] **Receipt template editor** — logo, header/footer, language ordering,
      live preview. (FR-POS-101/102)
- [ ] **Branch scorecard** — comparison, ranking, normalisation, outliers,
      branch template. (FR-BRN-008…014)
- [ ] **Central kitchen** — production orders, yield variance, distribution
      orders with allocation rules. (FR-BRN-020…028)

## Remaining — P1

- [ ] Graphical floor plan editor; merge tables; split a table's order; server
      sections. (FR-POS-080…084)
- [ ] KDS: audible alerts, capacity warning, icon/image mode, per-item target
      prep time, order-type-priority sort. (FR-KDS-012/023/029/031/044/045)
- [ ] Pricing: change history, bulk operations, CSV import with preview,
      margin-below-threshold warning, future effective dates. (FR-MNU-024…026)
- [ ] Inventory: cycle counting schedule, storage-ordered count sheets,
      reorder suggestions with forecast, batch traceability both ways.
      (FR-INV-027/048/049/067…069)
- [ ] Transfer requests and suggested transfers. (FR-BRN-016/017)
- [ ] Finance: card-batch and aggregator payout reconciliation.
      (FR-FIN-011/012)
- [ ] Approved-supplier lists and supplier compliance documents.
      (FR-PRC-010/011)
- [ ] Dashboards: role-specific defaults, widget selection and layout
      persistence, live operations view. (FR-RPT-030…034)
- [ ] Menu engineering matrix. (FR-MNU-055…057)
- [ ] Leave requests, shift swaps. (FR-HRM-016/017)
- [ ] 86 auto-re-enable time, daily quantity limits, remaining-sellable in the
      console. (FR-MNU-030/033/035)

## Remaining — P2

- [ ] Franchise: field locking, royalties, compliance visibility. (FR-BRN-035…037)
- [ ] Nutrition panel. (FR-MNU-050)
- [ ] Invoice OCR capture with human verification. (FR-PRC-046)
- [ ] Break-even progress; like-for-like branch comparison. (FR-CST-038, FR-BRN-014)
- [ ] Central-kitchen transfer pricing. (FR-BRN-030)
- [ ] Natural-language report query. (FR-RPT-047)
- [ ] Clock-in photo capture with consent notice. (FR-HRM-027)
- [ ] Additional language packs (ur/bn/tl/fr/tr/hi) beyond the kitchen-ticket
      picker; Hijri calendar display; per-user vs per-terminal vs per-document
      language selection. (FR-LOC-008/009/010)
- [ ] Waste anomaly detection; automatic expiry write-off at day close.
      (FR-INV-026/061)
- [ ] In-product bilingual release notes. (FR-OPS-013)

---

## Conventions to keep

1. **Copy** goes through `node scripts/add-copy.mjs --file <json>`, never by
   hand-editing one dictionary.
2. **New domains without a backend** use `localCollection` from
   `lib/console/local-store.ts` and are registered in `ServiceRegistry` so both
   `mock.ts` and `http.ts` resolve them. The UI never knows which.
3. **Destructive actions** call `useConfirm()`. No bare `window.confirm`.
4. **Money** is minor units end to end; use `MoneyInput`, never a raw number
   field.
5. **Quantities** stay decimal strings — never parse to `number` on the way to
   a service.
6. Run `npx tsc --noEmit` after each unit of work; the dictionary types catch
   missing copy immediately.
