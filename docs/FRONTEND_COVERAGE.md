# ROS — Frontend SRS Coverage Tracker

Generated from `docs/srs-requirements.json` (extracted from ROS SRS v1.0).

`FE` = has a frontend surface. Only `FE` rows are in scope for this repository.
Status is `[x]` when the **complete** frontend workflow exists: screen, form,
interactions, validation, loading/empty/error/success states, and confirmation
where the action is destructive.

- Requirements extracted: **670**
- Frontend-relevant: **477**
- Backend/infra only (out of scope): **193**

## USA — Usability & Accessibility  (11)

- [x] **NFR-USA-001** `[M]` A three-line dine-in order with no modifiers SHALL be completable in no more than 6 user interactions from an empty screen.
- [x] **NFR-USA-002** `[M]` All primary touch targets SHALL be at least 48 × 48 dp with at least 8 dp separation.
- [x] **NFR-USA-003** `[M]` , FR-PLT- 020..029 Enable multi-country sale without code change New country pack certified in ≤ 6 engineer-weeks
- [x] **NFR-USA-004** `[M]` The POS SHALL be fully operable by a user who cannot read, using a configurable image-based menu grid.
- [x] **NFR-USA-005** `[M]`  New cashier productive after ≤ 30 minutes of training
- [x] **NFR-USA-006** `[M]` All KDS text conveying item identity SHALL be legible at 2 metres on a 21- inch display at 1920×1080, implying a minimum effective font size of 24 pt for item names.
- [x] **NFR-USA-007** `[M]`  Dashboard meets WCAG 2.1 Level AA
- [x] **NFR-USA-008** `[M]`  Contrast ratio ≥ 4.5:1 for text, ≥ 3:1 for UI components
- [x] **NFR-USA-009** `[M]`  Dashboard fully keyboard-navigable
- [x] **NFR-USA-010** `[M]`  Every destructive action is confirmable or undoable
- [x] **NFR-USA-011** `[M]`  Every error message states what happened and what to do next

## PLT — Platform & Tenancy  (13)

- [x] **FR-PLT-001** `[M]` The System SHALL model tenants, brands, branches, warehouses, and central kitchens as distinct entities with the hierarchy above.
- [x] **FR-PLT-002** `[M]` A tenant SHALL be able to own multiple brands, and a brand SHALL be able to own multiple branches.
- [x] **FR-PLT-003** `[M]` Every tenant-scoped record SHALL carry an immutable tenant_id. Records SHALL NOT be transferable between tenants.
- [x] **FR-PLT-004** `[S]` A branch MAY be reassigned between brands within the same tenant by a Tenant Owner, with a full audit record and an explicit warning regarding menu and pricing implications. BR-PLT-001 — Inventory is held at a location (branch, warehouse, or central kitchen), 
- [x] **FR-PLT-012** `[M]` Any request that reaches the data layer without a resolved tenant context SHALL fail closed with an error, never defaulting to an unfiltered query. Risk: The catastrophic failure mode of shared-schema multi-tenancy is cross-tenant data leakage. Every reported 
- [x] **FR-PLT-020** `[M]` Tenant self-service signup SHALL create a working branch with a starter menu template, a default role set, and a first user in a single flow.
- [x] **FR-PLT-021** `[M]` The System SHALL NOT delete tenant data upon downgrade or suspension. Data beyond the plan’s limits SHALL become read-only rather than being destroyed.
- [x] **FR-PLT-022** `[M]` At any lifecycle state except purged, a tenant SHALL be able to export all of their data in machine-readable format (CSV per entity plus a JSON manifest) within 24 hours of request.
- [x] **FR-PLT-023** `[M]` Termination SHALL be a two-step process: an initiation that begins a 30- day reversible countdown, and a final confirmation. Data purge SHALL occur no earlier than 30 days after initiation. Rationale: Requirement FR-PLT-021 is a commercial decision expressed a
- [x] **FR-PLT-025** `[M]` The System SHALL implement a hierarchical settings resolver with the precedence above.
- [x] **FR-PLT-026** `[M]` A setting SHALL be markable as locked at any level, preventing override at lower levels. Locked settings SHALL be visibly indicated in the UI at lower levels with the locking level named.
- [x] **FR-PLT-027** `[S]` The System SHALL provide a settings inspector showing, for any effective value, which level supplied it and what the value would be at each level. Rationale: The most common support ticket in configurable multi-level systems is “why is this price/tax/permissio
- [x] **FR-PLT-028** `[M]` Settings that affect financial computation (tax class, rounding policy, service charge) SHALL be versioned with effective dates, and historical transactions SHALL be interpreted with the setting version in force at their transaction time, never the current ver

## SEC — Roles, Permissions & Access  (36)

- [x] **FR-SEC-001** `[M]` The System SHALL implement role-based access control where permissions are granted to roles and roles are assigned to users.
- [x] **FR-SEC-002** `[M]` Role assignments SHALL carry a scope, restricting the assignment to a tenant, a brand, a set of branches, or a single branch.
- [x] **FR-SEC-003** `[M]` A user MAY hold multiple role assignments with different scopes — for example, Branch Manager at Branch 1 and Cashier at Branch 2.
- [x] **FR-SEC-004** `[M]` Where multiple assignments apply, effective permissions SHALL be the union of granted permissions within each assignment’s own scope. Permissions SHALL NOT leak across scopes.
- [x] **FR-SEC-005** `[S]` Role assignments SHALL support validity dates, enabling temporary elevation (covering a manager’s leave) that expires automatically. Rationale: Temporary elevation without expiry is the mechanism by which every organisation’s permission model degrades. Someone
- [x] **FR-SEC-010** `[M]` The System SHALL ship predefined roles suitable for immediate use, which tenants may clone and modify but not delete. Role Scope Character Owner Tenant All permissions Operations Director Brand(s) All operational, no user or billing management Brand Manager Br
- [x] **FR-SEC-011** `[M]` Tenants SHALL be able to create custom roles by selecting permissions from the catalogue.
- [x] **FR-SEC-012** `[M]` The role editor SHALL display, for each permission, a plain-language description of what it allows and a warning marker on sensitive permissions.
- [x] **FR-SEC-015** `[M]` The System SHALL define incompatible permission pairs and SHALL warn when a role or user combines them. Permission A Permission B Risk inventory.count.perfo rm inventory.count.post Counter approves own count purchase.order.create purchase.order.approv e_* Self
- [x] **FR-SEC-016** `[M]` The System SHALL block, not merely warn, on the following combinations regardless of role configuration: approving one’s own requisition, approving one’s own discount, approving one’s own cash variance, and posting a count one performed where the tenant has en
- [x] **FR-SEC-017** `[S]` The System SHALL provide an SoD conflict report listing every user whose effective permissions contain an incompatible pair.
- [x] **FR-SEC-021** `[M]` PIN authentication SHALL be valid only on registered terminals within the employee’s permitted branches, and SHALL NOT grant access to the web dashboard.
- [x] **FR-SEC-023** `[M]` Multi-factor authentication SHALL be supported for dashboard access and SHALL be enforceable as mandatory per role.
- [x] **FR-SEC-024** `[M]` MFA SHALL be mandatory for any role holding security.user.manage, settings.tenant.manage, or api.key.manage.
- [x] **FR-SEC-025** `[M]` Password policy SHALL be configurable per tenant with a minimum of 10 characters, and SHALL check candidate passwords against a known-breached-password list.
- [x] **FR-SEC-026** `[M]` Sessions SHALL expire after a configurable idle period: default 15 minutes on POS, 60 minutes on dashboard, 8 hours on KDS.
- [x] **FR-SEC-027** `[M]` The System SHALL support forced logout of a user’s sessions across all devices by an administrator.
- [x] **FR-SEC-028** `[M]` Terminals SHALL be individually registered, and the System SHALL support revoking a terminal’s registration, immediately invalidating its credentials and wiping its local data on next contact.
- [x] **FR-SEC-030** `[M]` The System SHALL provide a general approval mechanism used by discounts, refunds, purchase orders, waste, count adjustments, expenses, and price changes.
- [x] **FR-SEC-031** `[M]` Approval requests SHALL specify: the requesting user, the action, the affected entity, the value, the required approver permission, and an expiry.
- [x] **FR-SEC-032** `[M]` Approvals SHALL be obtainable synchronously (manager PIN on the terminal) or asynchronously (push notification to the manager’s mobile device), with the terminal remaining usable while awaiting an asynchronous decision.
- [x] **FR-SEC-033** `[M]` Approval decisions SHALL record approver, timestamp, decision, and any comment, and SHALL be immutable.
- [x] **FR-SEC-034** `[S]` The System SHALL support escalation: if no decision is made within a configured period, the request escalates to the next approval level.
- [x] **FR-SEC-035** `[M]` Where an operation must proceed offline and no approver is present, the System SHALL support a configurable policy: block the operation, or permit it with mandatory retrospective approval flagged in an exception report. Rationale: An offline terminal cannot re
- [ ] **FR-SEC-040** `[M]` All network traffic SHALL use TLS 1.3 with TLS 1.2 as the minimum fallback.
- [x] **FR-SEC-042** `[M]` Sensitive fields (national identifiers, bank details, API secrets) SHALL be encrypted at the application layer with envelope encryption and per-tenant data keys, in addition to volume encryption.
- [ ] **FR-SEC-043** `[M]` Encryption keys SHALL be managed by a managed KMS, SHALL be rotated at least annually, and SHALL never be committed to source control or logged.
- [x] **FR-SEC-045** `[M]` Every API endpoint SHALL enforce authorisation server-side. Client-side permission checks are presentation only and SHALL NOT be relied upon.
- [x] **FR-SEC-047** `[M]` All user input SHALL be validated against an explicit schema at the API boundary, rejecting unknown fields rather than ignoring them.
- [ ] **FR-SEC-049** `[M]` Dependencies SHALL be scanned for known vulnerabilities on every build, and builds SHALL fail on critical findings.
- [ ] **FR-SEC-050** `[M]` Secrets SHALL be injected at runtime from a secret manager, never present in images or repositories.
- [ ] **FR-SEC-051** `[S]` The System SHALL undergo an external penetration test before general availability and annually thereafter.
- [x] **FR-SEC-052** `[M]` The System SHALL support IP allow-listing for API access and for dashboard access at the Enterprise tier.
- [x] **FR-SEC-053** `[M]` Security-relevant events SHALL be forwarded to a SIEM-compatible sink, and Enterprise tenants SHALL be able to receive their own security event stream.
- [x] **FR-SEC-060** `[M]` The System SHALL classify data by sensitivity and apply corresponding controls: Class Examples Controls Public Menu items, prices Standard Internal Sales figures, stock levels Tenant isolation, RBAC Confidential Costs, margins, supplier terms RBAC with explici
- [x] **FR-SEC-062** `[M]` The System SHALL support data subject requests: access (export), rectification, and erasure (anonymisation preserving financial records).

## AUD — Audit  (6)

- [ ] **FR-AUD-001** `[M]` ..026, FR-SEC-018 Make the product sellable to groups Support ≥ 100 branches per tenant with sub-2s consolidated reporting
- [x] **FR-AUD-002** `[M]` Each audit entry SHALL contain: Field Content id ULID tenant_id, branch_id Scope
- [x] **FR-AUD-006** `[M]` The following actions SHALL always generate audit entries: authentication success and failure, permission changes, role changes, price changes, recipe changes, discounts, comps, voids, refunds, cash variances, stock adjustments, count postings, waste records, 
- [x] **FR-AUD-007** `[M]` Audit log access SHALL itself be audited.
- [x] **FR-AUD-008** `[M]` The audit log SHALL be searchable and filterable by actor, entity, action, date range, branch, and correlation ID, and SHALL be exportable by users with audit.view plus report.export.
- [x] **FR-AUD-010** `[M]` Support staff access to tenant data SHALL require an explicit impersonation session with a recorded reason, a time limit, tenant-visible notification, and full audit capture of every action performed. Rationale: Vendor support access is a legitimate necessity 

## LOC — Localisation  (18)

- [x] **FR-LOC-001** `[M]` ..038, CR-03 Provide defensible internal control 100% of sensitive actions produce audit entries
- [x] **FR-LOC-002** `[M]` The Arabic interface SHALL use clear Modern Standard Arabic, not a regional dialect.
- [x] **FR-LOC-003** `[M]` Layout direction SHALL follow the selected language: full RTL mirroring for Arabic, LTR for English, applied to layout, iconography with directional meaning, progress indicators, and navigation.
- [x] **FR-LOC-004** `[M]` The System SHALL correctly render bidirectional text: an Arabic dish name containing a Latin brand name, or an English item name containing an Arabic word, SHALL render with correct ordering per the Unicode Bidirectional Algorithm. Rationale: Bidirectional ren
- [x] **FR-LOC-005** `[M]` Numeral rendering SHALL be configurable between Western (0123456789) and Arabic-Indic (٩٨٧٦٥٤٣٢١٠), independently for the interface and for printed documents.
- [x] **FR-LOC-006** `[M]` All user-authored content — item names, descriptions, categories, modifiers, reason codes, station names, expense categories — SHALL be storable in every enabled language, with a designated fallback.
- [x] **FR-LOC-007** `[M]` Where a translation is missing, the System SHALL display the fallback language content rather than an empty string or a key.
- [x] **FR-LOC-008** `[M]` Language SHALL be selectable per user, per terminal, and per printed document type independently. A branch may run an English-language dashboard, an Arabic POS, an Urdu kitchen ticket, and a bilingual customer receipt.
- [x] **FR-LOC-009** `[S]` The System SHALL support additional languages by translation pack: French, Turkish, Urdu, Bengali, Hindi, Tagalog. Rationale: Kitchen staff in Gulf restaurants frequently read Urdu, Bengali, or Tagalog more fluently than Arabic or English. Kitchen ticket langu
- [x] **FR-LOC-010** `[M]` Dates, times, numbers, and currency SHALL be formatted per locale, and the System SHALL support both Gregorian and Hijri calendar display where the country pack enables it.
- [x] **FR-LOC-011** `[M]` Arabic typography SHALL use fonts selected and tested for legibility at small sizes on thermal printers and at 2-metre viewing distance on kitchen displays.
- [x] **FR-LOC-012** `[M]` Thermal printing of Arabic SHALL be tested across the supported printer matrix, with the System supporting both native Arabic font rendering and image-based rendering as a fallback for printers with poor Arabic support. Rationale: Many thermal printers in the 
- [x] **FR-LOC-020** `[M]` All jurisdiction-specific behaviour SHALL be driven by the country pack. No country-specific logic SHALL be compiled into core application code.
- [x] **FR-LOC-021** `[M]` Country packs SHALL be versioned with effective dates, and historical transactions SHALL be interpreted under the pack version in force at their transaction time.
- [x] **FR-LOC-024** `[M]` Country packs SHALL be distributed to offline terminals in advance of their effective date and SHALL activate locally by date.
- [x] **FR-LOC-025** `[M]` The tax engine referenced by a pack SHALL be one of a registered set of strategy implementations. Adding a genuinely novel tax model requires a new strategy implementation; changing rates, classes, or rounding does not.
- [x] **FR-LOC-030** `[S]` The System SHALL provide a country pack authoring and validation tool so that a new pack can be produced, tested against the conformance suite, and certified without core code changes.
- [x] **FR-LOC-031** `[M]` A country pack SHALL NOT be activatable in production until it passes the full conformance suite and is signed by an authorised release key.

## POS — Point of Sale  (74)

- [x] **FR-POS-001** `[M]` The System SHALL allow creation of an order in the following types: dine- in, takeaway, delivery, drive-through, pickup, and aggregator-injected.
- [x] **FR-POS-002** `[M]` The System SHALL assign a human-readable order number, unique within a branch within a business day, generated locally without requiring server connectivity. Order number format: <branch_code>-<business_day_seq> where the sequence is drawn from a locally-held 
- [x] **FR-POS-003** `[M]` For dine-in orders, the System SHALL require table assignment before firing to the kitchen.
- [x] **FR-POS-004** `[S]` The System SHALL support assigning order lines to seat numbers within a dine-in order, to enable seat-level splitting and service.
- [x] **FR-POS-005** `[M]` The System SHALL allow multiple orders to be open simultaneously on one terminal and SHALL allow switching between them without data loss.
- [x] **FR-POS-006** `[M]` The System SHALL allow an order to be parked (set aside) and resumed by the same or another authorised user on the same or another terminal within the branch.
- [x] **FR-POS-007** `[M]` The System SHALL record opened_by, served_by, and closed_by employee identities on every order. 8.2.2 Item Selection
- [x] **FR-POS-010** `[M]` The System SHALL present the menu as a configurable grid of categories and items, with per-branch layout, colour coding, and item images.
- [x] **FR-POS-011** `[M]` The System SHALL support item lookup by: category navigation, text search (Arabic and English, diacritic- and hamza-insensitive), barcode scan, PLU code, and a configurable favourites/quick-keys panel.
- [x] **FR-POS-012** `[M]` Arabic search SHALL normalise أ إ آ ا to a single form, ة to ه, ى to ي, and SHALL ignore tashkeel, so that a cashier typing “شاورما” finds “ْرَماوَش اِ”. Rationale: Arabic text entry on a POS during a rush is error-prone and orthographic variation is the norm.
- [x] **FR-POS-013** `[M]` The System SHALL support items with multiple variants (size, preparation) and SHALL require variant selection before the line is added.
- [x] **FR-POS-014** `[M]` The System SHALL support fractional quantities for items sold by weight, with input from a connected scale where available.
- [x] **FR-POS-015** `[M]` The System SHALL support open-price items where the price is entered at sale time, restricted by permission and bounded by configurable min/max.
- [x] **FR-POS-016** `[M]` The System SHALL support open-description items (“miscellaneous”) mapped to a configured revenue category and tax class. 8.2.3 Modifiers
- [x] **FR-POS-020** `[M]` The System SHALL present modifier groups attached to an item immediately upon selection, in configured order, enforcing minimum and maximum selection counts.
- [x] **FR-POS-021** `[M]` Modifiers SHALL support three semantic kinds: Kind Effect on Price Effect on Recipe Addition (“extra cheese”) + delta Adds ingredient quantity Removal (“no onion”) 0 or − delta Removes ingredient quantity Substitution (“chicken instead of beef”) ± delta Replac
- [x] **FR-POS-022** `[M]` Modifier price deltas SHALL be configurable per price list, per branch, and per order type. A modifier may be free for dine-in and charged for delivery.
- [x] **FR-POS-023** `[S]` The System SHALL support nested modifier groups to a depth of 2 (e.g. “Add sauce” → “which sauce” → “how much”).
- [x] **FR-POS-024** `[M]` Removal modifiers SHALL reduce ingredient consumption in the inventory depletion calculation. A “no cheese” burger SHALL NOT deplete cheese. Rationale: This is a differentiator that competitors handle poorly. Over a month, an outlet selling 3,000 sandwiches wi
- [x] **FR-POS-025** `[S]` The System SHALL support free-text kitchen notes per line, with a configurable per-branch option to disable them.
- [x] **FR-POS-026** `[C]` The System SHALL support a library of predefined note chips (“no ice”, “well done”, “separate packaging”) to reduce free-text usage. 8.2.4 Combos and Meal Deals
- [x] **FR-POS-030** `[S]` The System SHALL support combo items composed of slots, where each slot offers a choice among configured options, with optional price deltas for premium choices.
- [x] **FR-POS-031** `[S]` Combo pricing SHALL support fixed price, sum-of-components-minus- discount, and component-price-override strategies.
- [x] **FR-POS-032** `[S]` Combo revenue SHALL be allocable to component items for reporting purposes, using a configurable allocation basis (equal, by list price, by cost). Rationale: Without allocation, a combo shows as a single line and the sales report cannot answer “how many burger
- [x] **FR-POS-035** `[M]` The System SHALL support firing an order to the kitchen either automatically upon line entry (fast-casual mode) or explicitly by user action (table-service mode), configurable per branch and per order type.
- [x] **FR-POS-036** `[S]` The System SHALL support courses, allowing lines to be grouped and fired independently in sequence.
- [x] **FR-POS-037** `[S]` The System SHALL support a “hold and fire” instruction where a course is sent to the kitchen but marked not to start until released.
- [x] **FR-POS-038** `[M]` Adding a line to an already-fired order SHALL create an amendment ticket to the kitchen clearly marked as an addition, not a reprint of the whole order. Rationale: Reprinting an entire ticket when one item is added is the single most common cause of duplicate 
- [x] **FR-POS-040** `[M]` Price for an item SHALL be resolved by the following precedence, evaluated at order time: 1. Manual price override (permission-gated, audited) 2. Active promotion for the customer and context 3. Time-based price list active at the order timestamp (happy hour) 
- [x] **FR-POS-042** `[M]` The System SHALL record which price list and which rule produced the price for each line, for audit and reporting. 8.3.2 Discounts
- [x] **FR-POS-045** `[M]` The System SHALL support discounts at line level and order level, expressed as percentage or fixed amount.
- [x] **FR-POS-046** `[M]` Every discount SHALL require selection of a reason from a configurable list.
- [x] **FR-POS-047** `[M]` The System SHALL enforce configurable approval thresholds: Threshold Dimension Configuration Maximum percentage without approval Per role, per branch Maximum absolute amount without approval Per role, per branch Maximum discounts per shift per employee Per rol
- [x] **FR-POS-048** `[M]` Approval SHALL be obtainable by manager PIN entry on the terminal, by manager card swipe, or by remote approval request to the manager’s mobile app, without abandoning the order.
- [x] **FR-POS-049** `[M]` The System SHALL record for every discount: amount, percentage, reason, applying employee, approving employee, timestamp, and order context.
- [x] **FR-POS-050** `[S]` The System SHALL support “comp” (complimentary) as distinct from discount: a comped item is given free, the revenue is zero, but the cost is still recognised and inventory is still depleted. Rationale: Conflating comps and discounts destroys the ability to ana
- [x] **FR-POS-051** `[M]` Discount stacking SHALL be controlled by configuration: promotions may be marked exclusive, and the System SHALL apply the most favourable single discount when exclusivity is set.
- [x] **FR-POS-055** `[S]` The System SHALL support automatic service charge as a percentage, configurable per branch, per order type, and conditional on guest count.
- [x] **FR-POS-056** `[S]` The System SHALL support tip entry at payment, on the payment terminal, and post-payment adjustment where the acquirer supports it.
- [x] **FR-POS-057** `[S]` The System SHALL support tip pooling configuration and SHALL produce a tip distribution report per shift.
- [x] **FR-POS-058** `[M]` The System SHALL correctly apply the country pack’s rule on whether service charge is itself taxable, as this differs by jurisdiction.
- [x] **FR-POS-060** `[M]` The System SHALL support the following tender types: cash, card (via integrated terminal), card (manual/external terminal), digital wallet, gift card, loyalty points, store credit, voucher, bank transfer, on-account (credit customer), and aggregator-settled.
- [x] **FR-POS-061** `[M]` The System SHALL support split payment across multiple tenders on a single order, with running balance display.
- [x] **FR-POS-062** `[M]` The System SHALL support splitting a bill by: equal division among N parties, by seat, by selected items, and by arbitrary amount.
- [x] **FR-POS-063** `[M]` For cash payment, the System SHALL compute change due and SHALL apply the country pack’s cash rounding rule, recording any rounding adjustment as a separate ledger amount.
- [x] **FR-POS-064** `[M]` Integrated card payment SHALL be initiated from the POS, and the System SHALL handle terminal timeout, decline, partial approval, and communication failure without leaving the order in an indeterminate state.
- [x] **FR-POS-066** `[M]` The System SHALL NOT store, log, or transmit card PANs, CVV, or magnetic stripe data. Only the last 4 digits, card scheme, authorisation code, and terminal reference SHALL be retained.
- [x] **FR-POS-067** `[S]` The System SHALL support on-account sales to registered credit customers with a configurable credit limit, blocking sales that would exceed it without override permission.
- [x] **FR-POS-070** `[M]` The System SHALL distinguish four correction operations: Operation When Inventory Effect Financial Effect Line void (pre-fire) Before kitchen None None Line void (post- fire) After kitchen started Depletion stands; waste record prompted Removed from bill Order
- [x] **FR-POS-071** `[M]` Post-fire voids SHALL prompt the user to classify the disposition of the produced item: returned to stock (if applicable), wasted, or given to staff. The classification SHALL create the corresponding inventory record. Rationale: This is where uncontrolled syst
- [x] **FR-POS-072** `[M]` Refunds SHALL reference the original order and SHALL NOT permit a refund exceeding the original amount, in aggregate across all refunds against that order.
- [x] **FR-POS-073** `[M]` Refunds SHALL require a reason and, above a configurable threshold, manager approval.
- [x] **FR-POS-074** `[M]` Refunds SHALL be returned to the original tender type by default; refunding to a different tender SHALL require elevated permission and SHALL be flagged in the fraud detection report.
- [x] **FR-POS-075** `[M]` All voids, cancellations, and refunds SHALL generate audit entries containing the actor, approver, reason, amount, and full before/after state.
- [x] **FR-POS-080** `[S]` The System SHALL provide a graphical floor plan editor allowing definition of areas, tables, shapes, capacities, and positions.
- [x] **FR-POS-081** `[S]` The floor plan SHALL display live table state: available, seated, ordered, food served, bill requested, payment in progress, needs cleaning.
- [x] **FR-POS-082** `[S]` The System SHALL support merging tables, splitting a table’s order, and transferring an order between tables, each with an audit record.
- [x] **FR-POS-083** `[S]` The System SHALL display time-since-seated and time-since-last-course per table, to support service pacing.
- [x] **FR-POS-084** `[C]` The System SHALL support server section assignment, restricting or highlighting tables per assigned server.
- [x] **FR-POS-090** `[M]` A cashier SHALL be required to open a shift, declaring an opening float, before processing sales.
- [x] **FR-POS-091** `[M]` The System SHALL support mid-shift cash operations: pay-in (adding cash to drawer), pay-out (removing cash for an expense), and safe drop (removing excess cash to the safe), each with reason and amount.
- [x] **FR-POS-092** `[M]` Safe drops SHALL be enforceable by a configurable drawer limit that triggers a prompt or a block when exceeded.
- [x] **FR-POS-093** `[M]` The System SHALL produce an X report (non-resetting mid-shift summary) on demand for authorised users.
- [x] **FR-POS-094** `[M]` Shift close SHALL require a physical cash count. The System SHALL support both blind count (expected amount hidden until after entry) and open count, configurable per branch.
- [x] **FR-POS-095** `[M]` Blind count SHALL be the default configuration. Rationale: If the cashier can see the expected amount before counting, a shortage can be concealed by “counting” the expected number. Blind count is a basic internal control and its absence is a finding in any op
- [x] **FR-POS-096** `[M]` Shift close SHALL compute and record cash variance, and SHALL require a reason and manager acknowledgement when variance exceeds a configurable tolerance.
- [x] **FR-POS-097** `[M]` Denomination-level counting SHALL be supported, with the System computing the total from denomination counts.
- [x] **FR-POS-100** `[M]` The System SHALL print a customer receipt containing all elements mandated by the branch’s country pack, including tax registration number, invoice sequence, tax breakdown, and any required QR code.
- [x] **FR-POS-101** `[M]` Receipt layout SHALL be template-driven per country pack and per brand, supporting logo, custom header/footer text, and language selection.
- [x] **FR-POS-102** `[M]` The System SHALL support bilingual receipts with configurable layout: Arabic only, English only, or both with defined ordering.
- [x] **FR-POS-103** `[M]` The System SHALL support digital receipt delivery by SMS, WhatsApp, email, and QR code, in addition to or instead of printing.
- [x] **FR-POS-104** `[S]` The System SHALL support receipt reprint, with reprints clearly marked as duplicates and logged.
- [x] **FR-POS-105** `[M]` Kitchen tickets SHALL print in the kitchen’s configured language, which may differ from the customer receipt language.
- [x] **FR-POS-106** `[M]` The System SHALL handle printer failure gracefully: queue the job, alert the user, permit continuation of the sale, and retry automatically, never blocking the transaction.

## KDS — Kitchen Display  (23)

- [x] **FR-KDS-001** `[M]` The System SHALL support definition of preparation stations per branch, with configurable name, display colour, and capacity. Standard station types: Grill, Fryer, Cold/Salad, Hot line, Beverage, Barista, Dessert, Bakery, Shawarma/Rotisserie, Packaging, Expedi
- [x] **FR-KDS-010** `[M]` The System SHALL route each order line to one or more stations, resolved by the following precedence: 1. Explicit line-level station override 2. Modifier-driven routing rule (a “make it crispy” modifier may reroute) 3. Menu item’s assigned station for this bra
- [x] **FR-KDS-011** `[M]` A single order line SHALL be routable to multiple stations when the item requires multi-station preparation (a burger requiring grill and packaging).
- [x] **FR-KDS-012** `[S]` The System SHALL support a Prep-Time-Aware coordination mode in which items on one order are released to their stations at staggered times, calculated backwards from a target completion time, so that all components finish together. target_ready = fire_time + m
- [x] **FR-KDS-013** `[S]` The System SHALL support an Expediter (Pass) display showing complete orders, with per-station completion state, for final assembly and quality check.
- [x] **FR-KDS-020** `[M]` The KDS SHALL display tickets as cards containing: order number, order type, elapsed time, table or customer reference, item lines with quantity and modifiers, and preparation notes.
- [x] **FR-KDS-021** `[M]` Modifiers SHALL be visually distinguished from item names, with removals (- no onion) rendered differently from additions (+ extra cheese).
- [x] **FR-KDS-022** `[M]` Tickets SHALL be colour-coded by elapsed time against a configurable target: within target (neutral), approaching (amber), exceeded (red), critically exceeded (red, flashing).
- [x] **FR-KDS-023** `[M]` The System SHALL support the following ticket sort orders, configurable per station: oldest first (FIFO), by target completion time, by order type priority, and by course sequence.
- [x] **FR-KDS-024** `[M]` Staff SHALL be able to mark an individual item ready (“bump item”) or an entire ticket ready (“bump all”).
- [x] **FR-KDS-025** `[M]` The System SHALL provide a recall function restoring the most recently bumped tickets, retained for a configurable period (default 30 minutes).
- [x] **FR-KDS-026** `[M]` Bump actions SHALL require a deliberate interaction (long-press, double- tap, or a dedicated confirm zone) to prevent accidental bumping from splashes or brushes against the screen. Rationale: Kitchen screens get touched by accident constantly — an elbow, a sl
- [x] **FR-KDS-027** `[S]` The System SHALL support order priority flags (rush, VIP, remake) with distinct visual treatment.
- [x] **FR-KDS-028** `[S]` Amendments to a fired order SHALL appear as a visually distinct update on the existing ticket, with an audible and visual alert, never as a new ticket.
- [x] **FR-KDS-029** `[M]` Cancelled lines SHALL be struck through and highlighted on the station display, with an alert, and SHALL remain visible for a configurable period so the cook stops preparing.
- [x] **FR-KDS-030** `[S]` The System SHALL support “all-day” counts: an aggregate view showing total outstanding quantity per item across all active tickets at this station.
- [x] **FR-KDS-031** `[S]` The KDS SHALL support an icon-and-image mode for kitchens where staff literacy in the configured language cannot be assumed.
- [x] **FR-KDS-040** `[M]` The System SHALL record the following timestamps per ticket and per line: created, routed, first viewed, started, ready, bumped, and served.
- [x] **FR-KDS-041** `[M]` The System SHALL compute and report: average preparation time by item, by station, by hour, by employee, and by order type.
- [x] **FR-KDS-042** `[M]` The System SHALL define and report “ticket time” as bump time minus fire time, and “order time” as last-line-ready minus order-open.
- [x] **FR-KDS-043** `[S]` The System SHALL identify the bottleneck station per hour, defined as the station with the highest ratio of queue depth to throughput.
- [x] **FR-KDS-044** `[S]` The System SHALL support configurable per-item target preparation times, defaulting to the recipe’s prep_time_seconds.
- [x] **FR-KDS-045** `[C]` The System SHALL provide a capacity warning when queued items at a station exceed configured throughput capacity for the next 15 minutes.

## MNU — Menu & Recipes  (38)

- [x] **FR-MNU-001** `[M]` The System SHALL support a menu hierarchy of: Menu → Category → Sub-category (optional) → Item → Variant.
- [x] **FR-MNU-002** `[M]` A tenant SHALL be able to define multiple menus (e.g. Breakfast, Main, Late Night, Ramadan, Delivery) and assign each to branches, order types, and time windows.
- [x] **FR-MNU-003** `[M]` Where multiple menus are active simultaneously for a context, resolution SHALL follow explicit priority ordering, and the System SHALL warn on configuration that produces ambiguity.
- [x] **FR-MNU-004** `[M]` Menu items SHALL support the following attributes: Attribute Purpose Names (localised, per language) Display on POS, KDS, receipt, aggregator — each independently overridable Description (localised) Customer-facing menu, QR menu Kitchen name (localised) Short 
- [x] **FR-MNU-005** `[M]` Item names SHALL be independently configurable for each surface (POS, KDS, customer receipt, aggregator listing), because the appropriate name differs by context. Rationale: A customer receipt should read “Grilled Chicken Sandwich with Garlic Sauce.” The KDS s
- [x] **FR-MNU-006** `[M]` Variants SHALL support independent pricing, independent recipes, independent barcodes, and independent availability.
- [x] **FR-MNU-007** `[S]` The System SHALL support item-level and category-level sort order, with drag-and-drop configuration and a live POS preview.
- [x] **FR-MNU-010** `[M]` Modifier groups SHALL be defined once and attached to multiple items, with per-item overrides for price and default selection.
- [x] **FR-MNU-011** `[M]` Modifier groups SHALL support: minimum selections, maximum selections, required flag, allow-repeat flag, default selection, and free-quantity threshold (first two free, third charged).
- [x] **FR-MNU-012** `[M]` Individual modifiers SHALL support linkage to a stock item and a consumption quantity, so their inventory impact is computed.
- [x] **FR-MNU-013** `[S]` Modifiers SHALL support a “recipe delta” specification, expressing changes to the parent recipe rather than an independent consumption: modifier: "Extra Cheese" price_delta: 500 # 5.00 recipe_delta: - component: cheddar_slice operation: add quantity: 20 unit: 
- [x] **FR-MNU-020** `[M]` The System SHALL support named price lists, each with a scope (tenant, brand, branch, or branch group), a validity window, an optional recurrence schedule, and a priority.
- [x] **FR-MNU-021** `[M]` The System SHALL support order-type-specific pricing, so delivery prices may differ from dine-in prices for the same item.
- [x] **FR-MNU-022** `[M]` The System SHALL support time-based pricing with recurring schedules (e.g. weekdays 15:00–18:00), evaluated in the branch’s timezone.
- [x] **FR-MNU-023** `[M]` Price changes SHALL be schedulable with a future effective date and SHALL propagate to offline terminals in advance of that date, activating locally at the correct local time. Rationale: A price change that requires connectivity at the moment it takes effect w
- [x] **FR-MNU-024** `[M]` The System SHALL maintain full price change history: who changed what, from what to what, when, and effective when.
- [x] **FR-MNU-025** `[S]` The System SHALL support bulk price operations: percentage increase across a category, rounding to a configured price point (e.g. always end in .95), and CSV import with a preview-and-confirm step.
- [x] **FR-MNU-026** `[S]` The System SHALL warn when a price change would move an item’s contribution margin below a configurable threshold, or below its cost.
- [x] **FR-MNU-030** `[M]` The System SHALL support manual availability toggling (“86-ing”) per item, per branch, with an optional automatic re-enable time.
- [x] **FR-MNU-031** `[M]` The System SHALL automatically mark an item unavailable when any non-optional ingredient’s stock reaches zero, if automatic availability is enabled for that branch.
- [x] **FR-MNU-032** `[M]` Automatic unavailability SHALL be overridable by an authorised user, with the override recorded.
- [x] **FR-MNU-033** `[S]` The System SHALL compute and display “remaining sellable quantity” per item, being the minimum across ingredients of (available stock ÷ required quantity per portion). Rationale: “We can sell 14 more of these” is far more actionable to a manager than “cheese i
- [x] **FR-MNU-034** `[S]` Availability state SHALL propagate to connected aggregator platforms within 60 seconds where the aggregator API supports it.
- [x] **FR-MNU-035** `[C]` The System SHALL support daily quantity limits per item (“only 20 specials today”), decrementing on sale and auto-disabling at zero.
- [x] **FR-MNU-040** `[M]` The System SHALL support recipes for menu item variants, for sub- recipes (prep items), and for central-kitchen production items.
- [x] **FR-MNU-041** `[M]` Recipes SHALL specify components as either stock items or other recipes (sub-recipes), with quantity and unit.
- [x] **FR-MNU-042** `[M]` The System SHALL detect and reject circular sub-recipe references, displaying the full cycle path.
- [x] **FR-MNU-043** `[M]` Recipes SHALL support a yield specification: the quantity produced, and a yield percentage representing preparation loss.
- [x] **FR-MNU-044** `[M]` Recipe lines SHALL support a per-component wastage percentage representing trim loss (e.g. peeling potatoes loses 18%). Rationale: Yield and trim loss are where naive costing systems become useless. A kilogram of purchased potatoes does not produce a kilogram 
- [x] **FR-MNU-045** `[M]` Recipes SHALL be versioned. Publishing a new version SHALL supersede but not delete the prior version, and completed orders SHALL retain their reference to the version in force at sale time.
- [x] **FR-MNU-046** `[M]` Recipe cost SHALL be automatically recomputed when any component’s valuation changes, and the recomputation SHALL cascade through dependent sub-recipes and parent recipes.
- [x] **FR-MNU-047** `[S]` The System SHALL support recipe scoping, allowing a branch to hold a variant recipe differing from the brand standard, with the deviation visible in a compliance report.
- [x] **FR-MNU-048** `[S]` The System SHALL support recipe scaling: displaying a recipe scaled to an arbitrary output quantity for batch production.
- [x] **FR-MNU-049** `[S]` The System SHALL store localised preparation instructions and reference images per recipe, viewable from the KDS.
- [x] **FR-MNU-050** `[C]` The System SHALL compute nutritional information per portion by aggregating component nutritional data where supplied. This is informational only and is explicitly not certified. BR-MNU-012 — An item MAY be sold with an incomplete or absent recipe. The System 
- [x] **FR-MNU-055** `[S]` The System SHALL classify menu items on the Boston-matrix menu engineering model using popularity (units sold relative to menu average) and profitability (contribution margin relative to menu average): Classification Popularity Margin Recommended Action Star H
- [x] **FR-MNU-056** `[S]` The classification SHALL be computable per branch, per day-part, and per date range.
- [x] **FR-MNU-057** `[C]` The System SHALL analyse modifier attachment rates and suggest price adjustments for modifiers whose attachment rate exceeds a threshold (indicating under- pricing) or falls below one (indicating over-pricing).

## INV — Inventory  (50)

- [x] **FR-INV-001** `[M]` The System SHALL maintain a stock item master with the following attributes: Attribute Notes Code / SKU Unique per tenant Names (localised) Category Hierarchical: Food → Protein → Poultry Base unit of measure Immutable after first movement Purchase unit(s) Wit
- [x] **FR-INV-002** `[M]` The base unit of measure SHALL be immutable once any stock movement exists for the item. Rationale: Changing the base unit after movements exist retroactively reinterprets every historical quantity. A change from kilograms to grams would multiply history
- [x] **FR-INV-003** `[M]` The System SHALL support multiple purchase units per item with independent conversion factors, so an item may be bought in cases of 12 from one supplier and cases of 24 from another.
- [x] **FR-INV-004** `[M]` The System SHALL support mass↔volume conversion for an item where a density factor is configured, and SHALL reject such conversion where it is not.
- [x] **FR-INV-005** `[S]` The System SHALL support supplier-specific item codes and barcodes, so that a supplier’s invoice or delivery note can be matched automatically.
- [x] **FR-INV-010** `[M]` The System SHALL maintain current stock levels per (item, location) pair as a projection over the stock movement ledger.
- [x] **FR-INV-011** `[M]` Stock levels SHALL be reconcilable to the movement ledger at any point in time, and a scheduled job SHALL verify the reconciliation daily and alert on divergence.
- [x] **FR-INV-012** `[M]` The System SHALL support three costing methods, configurable per item: Method Computation Best For Weighted Average (existing_value + received_value) / (existing_qty + received_qty) recomputed on each receipt Most food items; simple and stable FIFO Consumption
- [x] **FR-INV-013** `[M]` Where an item is batch-tracked, FIFO valuation SHALL follow batch receipt order, and consumption SHALL record which batch was consumed.
- [x] **FR-INV-014** `[M]` The System SHALL permit negative stock levels, recording them and raising an alert, rather than blocking the transaction that causes them.
- [x] **FR-INV-015** `[M]` The System SHALL report total inventory value per location, per category, and per item, at any historical date, computed from the movement ledger.
- [x] **FR-INV-020** `[M]` For batch-tracked items, the System SHALL create a batch record on receipt or production, carrying: batch number, production date, expiry date, quantity, unit cost, supplier, and originating document.
- [x] **FR-INV-021** `[M]` The System SHALL default the expiry date from the item’s configured shelf life, allowing override at receipt.
- [x] **FR-INV-022** `[M]` The System SHALL support two consumption strategies, configurable per item: • FIFO — consume the oldest received batch first. • FEFO — consume the batch with the nearest expiry first.
- [x] **FR-INV-023** `[M]` FEFO SHALL be the default for items with expiry tracking enabled. Rationale: FIFO and FEFO diverge whenever a later delivery has an earlier expiry — which happens constantly in fresh produce and dairy, because suppliers rotate their own stock. Using FIFO on pe
- [x] **FR-INV-024** `[M]` The System SHALL generate expiry alerts at configurable horizons per item category (default: 7, 3, and 1 days before expiry).
- [x] **FR-INV-025** `[M]` The System SHALL provide an expiry action worklist showing items approaching expiry, with quantity, value, and one-tap actions: mark wasted, transfer to another location, or create a markdown promotion.
- [x] **FR-INV-026** `[S]` The System SHALL support automatic write-off of expired batches at day close, configurable per item category, creating waste records with reason expired.
- [x] **FR-INV-027** `[S]` The System SHALL support batch traceability reporting: given a batch, list every order that consumed it (forward trace); given an order, list every batch consumed (backward trace). Rationale: This is a food-safety and legal requirement in an incident. If a sup
- [x] **FR-INV-030** `[M]` ..048, FR-CST- 010..022 Eliminate connectivity as a failure mode < 0.1% of business days report a POS outage attributable to connectivity
- [x] **FR-INV-031** `[M]` Inter-location transfers SHALL be modelled as a two-step process — dispatch and receipt — creating paired movements, with quantity in transit visible between them.
- [x] **FR-INV-032** `[M]` The receiving location SHALL be able to record a received quantity differing from the dispatched quantity, creating a transfer discrepancy record requiring investigation and approval.
- [x] **FR-INV-033** `[S]` Transfers SHALL support a printed or digital transfer note with barcode/QR for scanning at receipt.
- [x] **FR-INV-034** `[M]` Transfers between locations with different costing bases SHALL transfer at the sending location’s cost, with the difference posted to a transfer variance account where configured.
- [x] **FR-INV-035** `[M]` Manual stock adjustments SHALL require a reason code, SHALL be permission-gated, and SHALL require approval above a configurable value threshold.
- [x] **FR-INV-040** `[M]` The System SHALL support stock count sessions covering: a full location, a category, a storage area, or an ad-hoc item list.
- [x] **FR-INV-041** `[M]` The System SHALL support two count modes: • Blind count — expected quantity is hidden during counting. • Open count — expected quantity is displayed.
- [x] **FR-INV-042** `[M]` Blind count SHALL be the default and SHALL be enforceable as mandatory by policy configuration.
- [x] **FR-INV-043** `[M]` The System SHALL support counting on a mobile device with barcode scanning, offline-capable, syncing on completion.
- [x] **FR-INV-044** `[M]` The System SHALL freeze the expected quantity at the moment a count session opens, and SHALL account for movements occurring during the count window so that the variance calculation is not corrupted by concurrent activity. Rationale: A count that takes 90 minu
- [x] **FR-INV-045** `[M]` On posting, the System SHALL compute per-item variance in quantity and value, and SHALL create count_adjustment movements bringing recorded stock to counted stock.
- [x] **FR-INV-046** `[M]` Variances exceeding a configurable threshold (by percentage or value) SHALL require a recount or a written explanation before posting.
- [x] **FR-INV-047** `[M]` Count posting SHALL be permission-gated and SHALL be an approval- requiring action for high-value adjustments.
- [x] **FR-INV-048** `[S]` The System SHALL support cycle counting: a rolling schedule that counts high-value or high-variance items frequently and low-risk items rarely, so that a full count is never required. Class Criterion Count Frequency A Top 20% by value or high historical varian
- [x] **FR-INV-049** `[S]` The System SHALL provide a count sheet ordered by physical storage location to minimise walking, configurable by the tenant.
- [x] **FR-INV-050** `[M]` Count sessions SHALL retain full history, including counted values, counter identity, timestamps, recounts, and approvals.
- [x] **FR-INV-051** `[M]` A scheduled reconciliation job SHALL verify that the sum of movements equals the stock level projection for every (item, location) pair, and SHALL raise a platform alert on any divergence.
- [x] **FR-INV-055** `[M]` The System SHALL support waste recording at any point: from the POS (void disposition), from the kitchen (KDS), from a stock screen, and from a mobile device.
- [x] **FR-INV-056** `[M]` Every waste record SHALL capture: item, quantity, unit, reason code, location, employee, timestamp, and computed value. Photographs SHALL be optionally attachable.
- [x] **FR-INV-057** `[M]` The System SHALL provide a configurable reason code taxonomy, defaulting to: Reason Category Typical Root Cause Expired Storage Over-ordering, poor rotation Spoiled Storage Temperature failure, poor handling Damaged in delivery Supplier Supplier handling Prepa
- [x] **FR-INV-058** `[M]` Waste above a configurable value threshold SHALL require manager approval before posting.
- [x] **FR-INV-059** `[S]` The System SHALL distinguish “true waste” from “controlled consumption” (staff meals, tastings, marketing samples), reporting them separately so that the waste percentage is not inflated by legitimate consumption.
- [x] **FR-INV-060** `[S]` The System SHALL provide waste analysis by item, reason, employee, station, shift, day-part, and branch, with trend comparison.
- [x] **FR-INV-061** `[C]` The System SHALL detect anomalous waste patterns using statistical baselines — for example, waste of a high-value item consistently recorded by one employee during a single shift pattern — and raise them for review. Rationale: Theft is very often recorded as w
- [x] **FR-INV-065** `[M]` The System SHALL maintain per-location reorder points and reorder quantities per item.
- [x] **FR-INV-066** `[M]` The System SHALL generate low-stock alerts when available quantity falls below the reorder point.
- [x] **FR-INV-067** `[S]` The System SHALL compute a suggested order quantity using: forecast_demand = average_daily_usage(last N days, day-of-week weighted) × (supplier_lead_time_days + review_period_days) safety_stock = z × σ(daily_usage) × √(lead_time) target_level = forecast_demand
- [x] **FR-INV-068** `[S]` The suggestion SHALL be capped by remaining shelf life: the System SHALL NOT suggest ordering more of a perishable item than can be consumed before expiry at forecast usage.
- [x] **FR-INV-069** `[S]` The System SHALL incorporate known future demand — scheduled events, catering orders, promotions — into the forecast where recorded.
- [x] **FR-INV-070** `[C]` The System SHALL adjust forecasts for known seasonality, including Ramadan, Eid, and local holidays defined in the country pack. Rationale: In MENA markets, Ramadan alters demand patterns by 200–400% and inverts the day-part distribution entirely. A forecastin

## PRC — Purchasing  (33)

- [x] **FR-PRC-001** `[M]` The System SHALL implement the procure-to-pay cycle above, with configurable steps that may be skipped per tenant policy.
- [x] **FR-PRC-002** `[M]` A tenant SHALL be able to operate in “simple mode” where a purchase order and goods receipt are combined into a single receiving action, for small operations that do not raise formal POs. Rationale: A single-branch café that buys vegetables from the market eac
- [x] **FR-PRC-005** `[M]` The System SHALL maintain a supplier master with: code, legal name, trading name, tax registration number, addresses, contacts, payment terms, currency, delivery lead time, minimum order value, delivery days, and status.
- [x] **FR-PRC-006** `[M]` The System SHALL maintain supplier price lists per item, with unit, pack size, price, validity window, and optional volume break tiers.
- [x] **FR-PRC-007** `[M]` The System SHALL support multiple suppliers per item with a preference ranking, and SHALL display comparative pricing when ordering.
- [x] **FR-PRC-008** `[S]` The System SHALL track price history per supplier per item and SHALL alert when a received price differs from the agreed price by more than a configurable tolerance. Rationale: Supplier price creep is one of the most common and least detected margin leaks. A s
- [x] **FR-PRC-009** `[S]` The System SHALL maintain a supplier scorecard computing: Metric Computation On-time delivery rate Deliveries within promised window ÷ total deliveries Fill rate Quantity received ÷ quantity ordered Price stability Standard deviation of price changes over peri
- [x] **FR-PRC-010** `[S]` The System SHALL support approved-supplier lists per item category, and SHALL warn or block when ordering a category from a non-approved supplier.
- [x] **FR-PRC-011** `[S]` The System SHALL store supplier compliance documents (food safety certificates, licences, insurance) with expiry dates and expiry alerting.
- [x] **FR-PRC-015** `[S]` Branches SHALL be able to raise purchase requisitions for central review, supporting the common group structure where branches request and head office buys.
- [x] **FR-PRC-016** `[S]` The System SHALL support consolidating requisitions from multiple branches into a single supplier purchase order, retaining branch attribution for delivery and cost allocation.
- [x] **FR-PRC-017** `[M]` Purchase orders SHALL contain: supplier, delivery location, expected delivery date, lines with item, quantity, unit, unit price, tax, and total.
- [x] **FR-PRC-018** `[M]` The System SHALL support a configurable approval workflow for purchase orders based on total value: Value Band Approver Below threshold 1 Auto-approved Threshold 1 – 2 Branch Manager Threshold 2 – 3 Operations Director Above threshold 3 Tenant Owner
- [x] **FR-PRC-019** `[M]` The approval workflow SHALL enforce segregation of duties: the requester SHALL NOT be an approver of their own requisition or order.
- [x] **FR-PRC-020** `[M]` Approval SHALL be actionable from the mobile app and from an email link with a signed, single-use, time-limited token.
- [x] **FR-PRC-021** `[S]` Approved purchase orders SHALL be transmittable to suppliers by email (PDF plus structured attachment), WhatsApp, or supplier portal where integrated.
- [x] **FR-PRC-022** `[S]` The System SHALL generate suggested purchase orders from reorder-point analysis (FR-INV-067), grouped by preferred supplier, presented for review and adjustment before approval.
- [x] **FR-PRC-023** `[M]` Purchase orders SHALL be amendable before receipt, with amendment history retained and re-approval required if the value increases beyond the approved band.
- [x] **FR-PRC-030** `[M]` The System SHALL support receiving against a purchase order, receiving without a purchase order (direct receipt), and receiving a partial quantity.
- [x] **FR-PRC-031** `[M]` At receipt the System SHALL capture per line: quantity received, unit, batch number, production date, expiry date, unit price if differing from PO, and rejection quantity with reason.
- [x] **FR-PRC-032** `[M]` Receipt SHALL create stock movements of type purchase_receipt and, for batch-tracked items, SHALL create batch records.
- [x] **FR-PRC-033** `[M]` The System SHALL enforce configurable over-receipt tolerance, requiring approval to receive more than the ordered quantity beyond the tolerance.
- [x] **FR-PRC-034** `[S]` The System SHALL support receiving on a mobile device with barcode scanning and camera capture of delivery notes.
- [x] **FR-PRC-035** `[S]` The System SHALL support temperature recording at receipt for chilled and frozen items, with configurable acceptable ranges and automatic rejection prompts outside them.
- [x] **FR-PRC-036** `[M]` Rejected goods SHALL create a rejection record with reason and SHALL NOT enter stock, and SHALL generate a supplier credit expectation.
- [x] **FR-PRC-037** `[S]` The System SHALL support supplier returns after receipt, creating a negative stock movement and a credit note expectation.
- [x] **FR-PRC-040** `[M]` The System SHALL support recording supplier invoices against goods receipts.
- [x] **FR-PRC-041** `[M]` The System SHALL perform a three-way match across purchase order, goods receipt, and supplier invoice, evaluating: Check Tolerance Quantity: invoice vs receipt Configurable, default 0% Unit price: invoice vs PO Configurable, default 2% Total: computed vs state
- [x] **FR-PRC-042** `[M]` Invoices matching within tolerance SHALL be eligible for payment approval. Invoices outside tolerance SHALL enter a dispute state requiring resolution.
- [x] **FR-PRC-043** `[S]` The System SHALL support supplier credit notes, applied against outstanding invoices.
- [x] **FR-PRC-044** `[S]` The System SHALL maintain a supplier account statement showing invoices, credits, payments, and outstanding balance, with an ageing breakdown (current, 30, 60, 90+ days).
- [x] **FR-PRC-045** `[S]` The System SHALL generate a payment proposal listing invoices due within a horizon, respecting payment terms and available early-settlement discounts.
- [x] **FR-PRC-046** `[C]` The System SHALL support invoice capture by photograph with OCR extraction of supplier, date, invoice number, line items, and totals, presented for human verification before posting. Rationale: OCR is presented as an accelerator, never as an authority. An OCR 

## CST — Costing & Profitability  (31)

- [x] **FR-CST-001** `[M]` On order completion, the System SHALL compute COGS by expanding each order line’s recipe to base ingredients, applying modifier recipe deltas, and valuing consumption at the item’s current cost per the configured costing method.
- [x] **FR-CST-002** `[M]` COGS SHALL be recorded on the order line as unit_cost_snapshot and SHALL NOT be recomputed retroactively when ingredient costs change.
- [x] **FR-CST-003** `[M]` The System SHALL report food cost percentage as: Food Cost % = COGS ÷ Net Sales × 100 where Net Sales = Gross Sales − Discounts − Refunds − Tax
- [x] **FR-CST-004** `[M]` Food cost percentage SHALL be reportable by item, category, branch, brand, day-part, order type, and date range.
- [x] **FR-CST-005** `[M]` The System SHALL compute contribution margin per item: Contribution Margin = Selling Price (ex-tax) − Direct Cost Contribution Margin % = Contribution Margin ÷ Selling Price (ex- tax) × 100 Total Contribution = Contribution Margin × Units Sold
- [x] **FR-CST-006** `[S]` The System SHALL support inclusion of configurable non-recipe direct costs in the margin calculation: packaging (per order type), delivery commission (per channel), and disposables. Rationale: A burger with a 68% margin dine-in may have a 31% margin on a deliv
- [x] **FR-CST-007** `[S]` The System SHALL compute channel profitability, showing revenue, COGS, commission, packaging, and net contribution per sales channel.
- [x] **FR-CST-010** `[M]` For a defined period and location, the System SHALL compute theoretical usage per stock item as the sum, across all sold items, of recipe-expanded ingredient quantities.
- [x] **FR-CST-011** `[M]` For the same period and location, the System SHALL compute actual usage as: Actual Usage = Opening Count + Purchases Received + Transfers In + Production Output
- [x] **FR-CST-012** `[M]` The System SHALL compute variance: Variance Quantity = Actual Usage − Theoretical Usage Variance Value = Variance Quantity × Current Unit Cost Variance Percentage = Variance Quantity ÷ Theoretical Usage × 100
- [x] **FR-CST-013** `[M]` Recorded waste SHALL be presented as a separate column so that the report distinguishes explained from unexplained variance: Unexplained Variance = Variance Quantity − Recorded Waste Quantity
- [x] **FR-CST-014** `[M]` The variance report SHALL be sortable by variance value descending, so that the largest financial losses appear first regardless of quantity. Rationale: Sorting by quantity variance surfaces flour and salt. Sorting by value surfaces the beef, the salmon, and t
- [x] **FR-CST-015** `[S]` The System SHALL classify variance by likely cause using the following heuristics, presented as hypotheses rather than conclusions: Signature Likely Cause Consistent positive variance on one item across all shifts Recipe understates actual portion Variance con
- [x] **FR-CST-016** `[S]` The System SHALL compute variance at a per-shift granularity where opening and closing counts are available at that granularity, and SHALL fall back to the count period otherwise.
- [x] **FR-CST-017** `[S]` The System SHALL provide a variance trend view showing an item’s variance percentage over successive count periods.
- [x] **FR-CST-020** `[M]` The System SHALL report waste by value and quantity, grouped by item, reason, category, employee, station, day-part, shift, and branch.
- [x] **FR-CST-021** `[M]` The System SHALL compute waste as a percentage of both COGS and net sales.
- [x] **FR-CST-022** `[S]` The System SHALL compute a rolling baseline of expected waste per item and location, and SHALL flag deviations beyond a configurable number of standard deviations.
- [x] **FR-CST-023** `[S]` The System SHALL produce a “cost of waste” summary translating waste into the revenue required to offset it: Revenue Required to Offset = Waste Value ÷ (Average Contribution Margin %) Rationale: “You wasted 4,200 EGP this month” is abstract. “You wasted 4,200 
- [x] **FR-CST-024** `[C]` The System SHALL correlate waste by reason with operational factors (staffing level, order volume, new employee presence, equipment fault reports) to support root- cause analysis.
- [x] **FR-CST-030** `[S]` The System SHALL compute labour cost per shift from attendance records and configured hourly rates.
- [x] **FR-CST-031** `[S]` The System SHALL compute: Metric Formula Labour Cost % Labour Cost ÷ Net Sales × 100 Sales per Labour Hour Net Sales ÷ Hours Worked Covers per Labour Hour Orders (or Guests) ÷ Hours Worked Prime Cost COGS + Labour Cost Prime Cost % Prime Cost ÷ Net Sales × 100
- [x] **FR-CST-032** `[S]` The System SHALL display sales and labour on a common hourly axis so over- and under-staffing by hour is visible. Rationale: Prime cost is the number experienced operators watch, because it captures the two variable costs that management actually controls. A p
- [x] **FR-CST-035** `[S]` The System SHALL produce a branch profitability summary: Gross Sales − Discounts − Refunds = Net Sales (excl. tax) − COGS = Gross Profit − Labour Cost = Contribution After Labour − Recorded Operating Expenses = Branch Operating Profit
- [x] **FR-CST-036** `[S]` The System SHALL support recording branch operating expenses (rent, utilities, maintenance) with category, recurrence, and allocation.
- [x] **FR-CST-037** `[S]` The System SHALL support branch ranking by any metric, with configurable normalisation (absolute, per seat, per square metre, per labour hour) so that branches of different sizes are comparable.
- [x] **FR-CST-038** `[C]` The System SHALL compute a break-even sales level per branch from fixed costs and average contribution margin, and SHALL show progress against it during the month.
- [x] **FR-CST-040** `[S]` The System SHALL monitor and flag the following patterns for review. Every flag is a prompt for human investigation, never an accusation. Pattern Signal Excessive voids Void count or value per employee exceeding peer baseline by >2σ Post-payment voids Any void
- [x] **FR-CST-041** `[M]` Anomaly flags SHALL be visible only to users holding an explicit governance.view_anomalies permission.
- [x] **FR-CST-042** `[M]` The System SHALL present anomaly flags with the underlying evidence — the specific transactions, timestamps, and comparison baseline — so that a manager can evaluate them rather than accept them. Rationale: An unexplained accusation against an employee is wors
- [x] **FR-CST-043** `[S]` Baselines SHALL be computed per branch and per role, not globally, because normal void rates differ enormously between a fast-food counter and a fine-dining room.

## BRN — Branches & Central Kitchen  (30)

- [x] **FR-BRN-001** `[M]` The System SHALL support an unlimited number of branches per brand and an unlimited number of brands per tenant, subject to plan limits.
- [x] **FR-BRN-002** `[M]` Each branch SHALL hold its own: inventory, cash drawers, staff roster, operating hours, timezone, currency, tax configuration, and country pack assignment.
- [x] **FR-BRN-003** `[M]` Branches in different countries SHALL operate under different country packs within one tenant, and consolidated reporting SHALL handle multi-currency correctly.
- [x] **FR-BRN-004** `[M]` Consolidated multi-currency reports SHALL display both the original currency amounts and a converted total, with the conversion rate, rate source, and rate date shown explicitly. Rationale: A consolidated total that silently converts currencies at an unstated 
- [x] **FR-BRN-005** `[M]` The System SHALL support branch groups (regions, clusters, franchise territories) as a reporting and permission-scoping dimension.
- [x] **FR-BRN-006** `[S]` The System SHALL support central menu and price management with per- branch override capability, and the System SHALL report which branches deviate from the brand standard.
- [x] **FR-BRN-007** `[S]` The System SHALL support central recipe management with the same override-and-report pattern.
- [x] **FR-BRN-008** `[S]` The System SHALL support a branch template: a new branch may be created by copying configuration (menu, stations, roles, settings, printers) from an existing branch.
- [x] **FR-BRN-010** `[S]` The System SHALL provide a branch scorecard comparing branches on: net sales, transaction count, average order value, food cost %, labour cost %, prime cost %, waste %, variance value, void/discount rates, and average service time.
- [x] **FR-BRN-011** `[S]` Comparison SHALL support normalisation by seat count, floor area, labour hours, and trading hours, so branches of different sizes are meaningfully comparable.
- [x] **FR-BRN-012** `[S]` The System SHALL rank branches on any metric and SHALL indicate movement against the prior period.
- [x] **FR-BRN-013** `[S]` The System SHALL highlight outliers, defined as branches deviating beyond a configurable number of standard deviations from the group mean on any tracked metric.
- [x] **FR-BRN-014** `[C]` The System SHALL support like-for-like comparison, excluding branches open for less than a configurable maturity period from group averages.
- [x] **FR-BRN-015** `[M]` The System SHALL support stock transfers between any two locations within a tenant, per FR-INV-031.
- [x] **FR-BRN-016** `[S]` The System SHALL support transfer requests: a branch requests stock, the source location approves and dispatches.
- [x] **FR-BRN-017** `[S]` The System SHALL suggest transfers where one location holds excess stock approaching expiry and another location shows a shortage of the same item.
- [x] **FR-BRN-020** `[S]` The System SHALL model central kitchens as locations that consume input stock and produce output stock.
- [x] **FR-BRN-021** `[S]` Production SHALL be driven by a production order specifying output item, target quantity, and target date.
- [x] **FR-BRN-022** `[S]` A production order SHALL expand its recipe to compute required inputs, SHALL check availability, and SHALL flag shortages before production begins.
- [x] **FR-BRN-023** `[S]` On completion, a production order SHALL record actual output quantity, consume input stock, produce output stock, and create an output batch with production date and expiry.
- [x] **FR-BRN-024** `[S]` The System SHALL compute production yield variance:
- [x] **FR-BRN-025** `[S]` Production output cost SHALL be computed as the sum of consumed input costs plus configurable production overhead (labour, energy) per unit or per batch.
- [x] **FR-BRN-026** `[S]` The System SHALL generate a production plan from branch demand forecasts and current branch stock, indicating what the central kitchen should produce for the next production cycle.
- [x] **FR-BRN-027** `[S]` The System SHALL support distribution orders allocating produced quantities to branches, generating transfer movements and, where relevant, delivery manifests.
- [x] **FR-BRN-028** `[S]` Where produced quantity is insufficient for all branch requests, the System SHALL support allocation rules: proportional, by priority ranking, or manual.
- [x] **FR-BRN-029** `[S]` The System SHALL maintain full batch traceability from raw material receipt through production to the branch and to the customer order.
- [x] **FR-BRN-030** `[C]` The System SHALL support internal transfer pricing between central kitchen and branch, enabling the central kitchen to be evaluated as a cost centre or a profit centre per tenant policy.
- [x] **FR-BRN-035** `[C]` The System SHALL support franchise branches with restricted configuration authority: franchisees may operate but may not modify brand-controlled menu, recipes, or pricing.
- [x] **FR-BRN-036** `[C]` The System SHALL compute franchise royalties as a configurable percentage of net sales, with reporting per franchisee per period.
- [x] **FR-BRN-037** `[C]` The System SHALL provide franchisor visibility into franchisee operational compliance: menu deviation, price deviation, recipe deviation, and mandated-supplier usage.

## HRM — Workforce  (29)

- [x] **FR-HRM-001** `[M]` The System SHALL maintain employee records containing: employee code, names (localised), national/residency identifier, contact details, emergency contact, date of birth, hire date, termination date, position, department, home branch, permitted branches, emplo
- [x] **FR-HRM-002** `[M]` The System SHALL support employment types: full-time, part-time, casual, contractor, and trainee, with different rules for scheduling and overtime.
- [x] **FR-HRM-003** `[M]` The System SHALL store compensation basis (hourly rate, monthly salary, or per-shift rate) with effective dating, and SHALL restrict visibility of compensation to holders of an explicit permission.
- [x] **FR-HRM-004** `[S]` The System SHALL store document references with expiry dates (residency permit, work permit, health certificate, food-handling licence) and SHALL alert before expiry. Rationale: In GCC markets, expired residency or health certificates create immediate regulato
- [x] **FR-HRM-005** `[M]` Employees SHALL be assignable to multiple branches with a designated home branch, supporting the common practice of staff covering shifts across a group.
- [x] **FR-HRM-006** `[M]` Employee records SHALL be deactivatable but SHALL NOT be deletable while historical transactions reference them.
- [x] **FR-HRM-010** `[S]` The System SHALL support creating shift schedules by branch, week, position, and employee.
- [x] **FR-HRM-011** `[S]` The System SHALL support shift templates and week-pattern copying to avoid rebuilding a schedule each week.
- [x] **FR-HRM-012** `[S]` The System SHALL validate schedules against configurable rules and warn or block on violation: Rule Default Maximum consecutive working days 6 Minimum rest between shifts 11 hours Maximum shift length 12 hours Maximum weekly hours before overtime 48 Minimum st
- [x] **FR-HRM-013** `[S]` The System SHALL project scheduled labour cost for the week and compare it against a configurable target percentage of forecast sales.
- [x] **FR-HRM-014** `[S]` The System SHALL forecast required staffing per hour from historical sales patterns for the same weekday and season, and SHALL overlay this against the drafted schedule.
- [x] **FR-HRM-015** `[S]` The System SHALL publish schedules to employees by mobile notification and SHALL record acknowledgement.
- [x] **FR-HRM-016** `[C]` The System SHALL support shift swap requests between employees, subject to rule validation and manager approval.
- [x] **FR-HRM-017** `[S]` The System SHALL support leave requests, approval workflow, and a leave balance per configured leave type.
- [x] **FR-HRM-020** `[M]` The System SHALL support clock-in and clock-out via: POS terminal with PIN, mobile app with geofence validation, and biometric device integration where available.
- [x] **FR-HRM-021** `[M]` The System SHALL record clock events with timestamp, method, terminal or device, and — where mobile — GPS coordinates.
- [x] **FR-HRM-022** `[M]` The System SHALL detect and flag: late arrival beyond a grace period, early departure, missing clock-out, clock-in outside the geofence, and clock-in with no scheduled shift.
- [x] **FR-HRM-023** `[M]` The System SHALL prevent a clock-in more than a configurable interval before the scheduled shift start, to prevent inflated paid hours.
- [x] **FR-HRM-024** `[S]` Missing clock-outs SHALL be auto-closed at a configurable maximum shift length, flagged for manager correction, and SHALL NOT silently accrue hours.
- [x] **FR-HRM-025** `[M]` Manual attendance corrections SHALL require a reason, SHALL be permission-gated, and SHALL create an audit entry retaining the original value.
- [x] **FR-HRM-026** `[S]` The System SHALL support break tracking, distinguishing paid from unpaid breaks per configuration.
- [x] **FR-HRM-027** `[C]` The System SHALL support photo capture at clock-in as a deterrent to buddy-punching, subject to explicit configuration and employee notice. Rationale: Buddy-punching (one employee clocking in for another) is the most common form of labour fraud. Geofencing add
- [x] **FR-HRM-030** `[S]` The System SHALL compute per-employee metrics: total sales, order count, average order value, items per order, upsell attachment rate, average service time, void count and value, discount count and value, and cash variance.
- [x] **FR-HRM-031** `[S]` The System SHALL compute kitchen employee metrics from KDS data: items prepared, average preparation time by item, and remake count.
- [x] **FR-HRM-032** `[S]` The System SHALL support ranking employees on any metric within a branch, position, and period.
- [x] **FR-HRM-033** `[M]` The System SHALL compute worked hours, split into regular and overtime per the branch’s country pack overtime rules.
- [x] **FR-HRM-034** `[M]` Overtime beyond a configurable threshold SHALL require pre-approval, and unapproved overtime SHALL be flagged in a separate report rather than silently included.
- [x] **FR-HRM-035** `[M]` The System SHALL export payroll data in configurable formats (CSV with mappable columns, plus provider-specific templates) containing employee identifier, period, regular hours, overtime hours, absence, tips allocated, and deductions recorded.
- [x] **FR-HRM-036** `[S]` The System SHALL NOT compute net pay, tax withholding, or statutory contributions. It exports inputs to payroll; it is not a payroll engine.

## FIN — Cash & Finance  (27)

- [x] **FR-FIN-001** `[M]` The System SHALL model cash drawers as branch-level entities, with one open cash session per drawer at any time.
- [x] **FR-FIN-002** `[M]` A cash session SHALL be bound to exactly one employee. Two employees SHALL NOT share an open session on the same drawer.
- [x] **FR-FIN-003** `[S]` The System SHALL support shared-drawer mode where a branch policy permits multiple cashiers on one drawer, in which case accountability attaches to the shift rather than the individual, and this SHALL be visibly indicated as a reduced control environment.
- [x] **FR-FIN-004** `[M]` Expected cash SHALL be computed as: Expected Cash = Opening Float + Cash Sales + Cash Tips (if placed in drawer) + Pay-ins − Cash Refunds − Pay-outs − Safe Drops ± Cash Rounding Adjustments
- [x] **FR-FIN-005** `[M]` Cash variance SHALL be computed as Counted Cash − Expected Cash and SHALL be recorded on the session.
- [x] **FR-FIN-006** `[M]` Variance beyond a configurable tolerance SHALL require a reason and approval by a user with cash.variance.approve, who SHALL NOT be the session owner.
- [x] **FR-FIN-007** `[M]` Cash sessions SHALL be immutable once closed. Corrections SHALL be recorded as adjusting entries referencing the session.
- [x] **FR-FIN-010** `[M]` The System SHALL record, per session and per day, totals by tender type: cash, each card scheme, each wallet, gift card, voucher, on-account, and aggregator-settled.
- [x] **FR-FIN-011** `[S]` The System SHALL support reconciliation of card totals against the payment terminal’s batch settlement report, flagging differences.
- [x] **FR-FIN-012** `[S]` The System SHALL support reconciliation of aggregator-settled orders against aggregator payout statements, computing expected payout net of commission and flagging discrepancies. Rationale: Aggregator payout reconciliation is a real and under-served pain. Aggr
- [x] **FR-FIN-015** `[S]` The System SHALL support recording branch operating expenses with category, amount, payment method, supplier, date, attachment, and approval status.
- [x] **FR-FIN-016** `[S]` Petty cash paid from the drawer SHALL be recorded as a pay-out linked to the expense record, so that the drawer reconciles.
- [x] **FR-FIN-017** `[S]` Expenses above a configurable threshold SHALL require approval before posting.
- [x] **FR-FIN-018** `[S]` The System SHALL support recurring expense templates for rent, utilities, and subscriptions.
- [x] **FR-FIN-020** `[M]` The System SHALL support a business-day close operation per branch.
- [x] **FR-FIN-021** `[M]` Day close SHALL be blocked while any cash session remains open, and SHALL list the blocking sessions.
- [x] **FR-FIN-022** `[M]` Day close SHALL produce a Z report containing: gross sales, discounts, refunds, net sales, tax by rate, sales by category, sales by tender, sales by order type, transaction count, average order value, void and comp summary, cash reconciliation, and variance su
- [x] **FR-FIN-023** `[M]` Z reports SHALL be sequentially numbered per branch, immutable, and retrievable for any historical date.
- [x] **FR-FIN-024** `[M]` The System SHALL support a configurable business-day boundary per branch (e.g. 04:00), so that late-night trading is attributed to the correct operating day.
- [x] **FR-FIN-025** `[S]` Day close SHALL be performable automatically at the configured boundary where the branch enables it, with any open sessions force-closed and flagged.
- [x] **FR-FIN-026** `[M]` Day close SHALL trigger: fiscal document finalisation, inventory day-end snapshot, report pre-aggregation, and accounting export generation where configured.
- [x] **FR-FIN-030** `[M]` Tax SHALL be computed by the country pack’s tax engine, never by hard- coded logic.
- [x] **FR-FIN-031** `[M]` The System SHALL support tax-inclusive and tax-exclusive pricing, configurable per branch and per price list.
- [x] **FR-FIN-032** `[M]` The System SHALL support multiple simultaneous tax components (e.g. VAT plus municipality fee plus service tax), each with its own rate, base, and rounding.
- [x] **FR-FIN-033** `[M]` The System SHALL support tax classes per item (standard, reduced, zero- rated, exempt) and SHALL support order-type-dependent rates where the jurisdiction differentiates dine-in from takeaway.
- [x] **FR-FIN-034** `[M]` Tax SHALL be computed at line level and summed, not computed on the order total. Rationale: Computing tax on the order total rather than per line produces amounts that differ by one or two minor units from line-level computation, and tax authorities that valid
- [x] **FR-FIN-035** `[M]` The rounding mode and rounding point SHALL be specified by the country pack and SHALL be applied consistently across POS, server, receipt, and fiscal submission.

## CRM — Customers & Loyalty  (26)

- [x] **FR-CRM-001** `[M]` The System SHALL maintain customer records with: name, phone (primary identifier), email, addresses, date of birth, preferred language, tags, and consent flags.
- [x] **FR-CRM-002** `[M]` Phone number SHALL be the primary identifier, unique within a tenant, stored in E.164 format.
- [x] **FR-CRM-003** `[M]` Customer creation from the POS SHALL require no more than phone number and name, completable in under 15 seconds. Rationale: Every additional required field reduces capture rate. A form demanding email, birthday, and address at the counter will be filled in wi
- [x] **FR-CRM-004** `[M]` The System SHALL maintain per-customer order history with full detail, retrievable from the POS.
- [x] **FR-CRM-005** `[S]` The System SHALL compute per-customer: total spend, order count, average order value, first and last order dates, favourite items, preferred branch, preferred order type, and preferred day-part.
- [x] **FR-CRM-006** `[S]` The System SHALL support multiple delivery addresses per customer with labels and delivery notes.
- [x] **FR-CRM-007** `[S]` The System SHALL support customer blocking, preventing on-account sales or delivery to a flagged customer, with reason and audit record.
- [x] **FR-CRM-008** `[M]` The System SHALL record explicit consent flags per communication channel and per purpose, with timestamp and source, and SHALL NOT send marketing communication absent recorded consent.
- [x] **FR-CRM-009** `[M]` The System SHALL support customer data export and erasure requests, with erasure anonymising the customer record while retaining transactional and fiscal records as legally required. Rationale: Erasure cannot delete a sales transaction, because tax law require
- [x] **FR-CRM-015** `[S]` The System SHALL support a points-based loyalty programme with configurable earn rate, redemption rate, expiry, and eligibility rules.
- [x] **FR-CRM-016** `[S]` Points SHALL be earnable on net spend excluding tax and excluding already-discounted amounts, configurable per tenant.
- [x] **FR-CRM-017** `[S]` Points SHALL be redeemable as a tender type at the POS, converting to a monetary discount at the configured rate.
- [x] **FR-CRM-018** `[S]` The System SHALL support tiered loyalty with configurable thresholds, tier benefits, and tier review periods.
- [x] **FR-CRM-019** `[S]` The System SHALL support a stamp-card model (“buy 9 coffees, get the 10th free”) as an alternative to points, configurable per item or item group.
- [x] **FR-CRM-020** `[M]` Loyalty balances SHALL be maintained as an append-only transaction ledger, not as a mutable balance field. Rationale: A mutable balance combined with offline operation is a duplication vulnerability: a customer redeems the same points at two branches while bot
- [x] **FR-CRM-021** `[M]` Offline loyalty accrual SHALL be permitted. Offline redemption SHALL be permitted up to a configurable per-transaction limit, with the risk of overdraw accepted and reported on sync.
- [x] **FR-CRM-022** `[S]` The System SHALL provide the customer a loyalty balance view via a QR code on the receipt leading to a lightweight web page requiring no app installation.
- [x] **FR-CRM-025** `[S]` The System SHALL support a promotion engine with conditions and effects. Conditions: date and time range, day of week, branch set, order type, channel, minimum order value, specific items or categories present, minimum quantity, customer tag or tier, first ord
- [x] **FR-CRM-026** `[S]` Promotions SHALL support usage limits: total redemptions, per-customer redemptions, and per-day redemptions.
- [x] **FR-CRM-027** `[M]` Promotion evaluation SHALL be deterministic and identical offline and online, and is covered by the shared conformance suite.
- [x] **FR-CRM-028** `[S]` The System SHALL support single-use and multi-use coupon codes, with bulk generation and per-code tracking.
- [x] **FR-CRM-029** `[S]` The System SHALL report promotion performance: redemptions, incremental revenue, discount cost, margin impact, and redeeming customer profile.
- [x] **FR-CRM-030** `[S]` Promotion stacking SHALL be governed by explicit configuration; the default SHALL be non-stackable with best-value selection.
- [x] **FR-CRM-035** `[C]` The System SHALL compute RFM segmentation (Recency, Frequency, Monetary) and SHALL classify customers into actionable segments: champions, loyal, at-risk, hibernating, and new.
- [x] **FR-CRM-036** `[C]` The System SHALL compute a churn indicator based on a customer’s own historical inter-purchase interval rather than a global threshold.
- [x] **FR-CRM-037** `[C]` The System SHALL support exporting a segment for a marketing campaign, subject to consent flags.

## RPT — Reporting  (17)

- [ ] **FR-RPT-002** `[M]` The System SHALL maintain pre-aggregated rollups at hourly, daily, weekly, and monthly grain for the core fact tables.
- [ ] **FR-RPT-003** `[M]` Rollups SHALL be incrementally updated as new transactions arrive, and SHALL be fully rebuildable from source on demand.
- [x] **FR-RPT-004** `[M]` Every report SHALL display the timestamp of the data it reflects, and SHALL indicate when data is not yet complete for the period shown. Rationale: A manager looking at today’s sales at 14:00 must understand that the figure is partial. Systems that display an 
- [ ] **FR-RPT-005** `[M]` Dimension tables SHALL be slowly-changing (Type 2) for attributes that affect historical interpretation — item category, employee position, branch region — so that reclassifying an item today does not silently restate last year.
- [x] **FR-RPT-030** `[M]` The System SHALL provide role-appropriate default dashboards.
- [x] **FR-RPT-031** `[S]` The Executive dashboard SHALL present: net sales against target, prime cost %, branch ranking, top and bottom performing items, exception count, and trend sparklines.
- [x] **FR-RPT-032** `[S]` The Branch Manager dashboard SHALL present: today’s sales against forecast, hourly sales curve with labour overlay, food cost trend, items requiring reorder, expiry watch, open exceptions, and staff on shift.
- [x] **FR-RPT-033** `[S]` The System SHALL provide a live operations view: open orders, table states, kitchen queue depth, average current wait, and active terminals.
- [x] **FR-RPT-034** `[C]` Dashboards SHALL be customisable by the user through widget selection and arrangement, with a tenant-level default layout per role.
- [x] **FR-RPT-040** `[S]` The System SHALL support scheduled report delivery by email and by mobile push, with configurable recipients, schedule, and format.
- [x] **FR-RPT-041** `[S]` The System SHALL support a daily digest (“morning brief”) delivered at a configurable time, summarising the prior business day in a form readable on a phone in under 30 seconds.
- [x] **FR-RPT-042** `[M]` Every aggregate figure SHALL support drill-down to the contributing transactions in no more than four interactions.
- [x] **FR-RPT-043** `[M]` The System SHALL support export in CSV, XLSX, and PDF, with exports of more than 50,000 rows processed asynchronously and delivered by notification.
- [x] **FR-RPT-044** `[M]` All exports SHALL be logged in the audit trail with the requesting user, filters applied, and row count.
- [x] **FR-RPT-045** `[S]` The System SHALL support configurable alerts delivered in real time: Alert Default Trigger Cash variance exceeds tolerance On shift close Discount exceeds threshold On application Void after payment Immediately Stock reaches zero On depletion
- [x] **FR-RPT-046** `[M]` Alerts SHALL be rate-limited and de-duplicated per recipient per type per period. Rationale: Alert fatigue is the standard failure mode of operational alerting. A manager receiving forty notifications a day will disable them within a week, at which point the o
- [x] **FR-RPT-047** `[C]` The System SHALL support a natural-language query interface over the reporting layer, translating questions such as “which branch had the worst food cost last week” into parameterised queries, with the generated query shown to the user for verification.

## OFF — Offline & Sync  (6)

- [x] **FR-OFF-002** `[M]` Mode transitions SHALL NOT interrupt an in-progress order.
- [x] **FR-OFF-003** `[M]` The POS SHALL operate in Isolated mode for a minimum of 72 hours without functional degradation of sales capture.
- [x] **FR-OFF-017** `[M]` Where a jurisdiction requires a strictly gapless fiscal document sequence, the country pack SHALL specify the sequence strategy: Strategy Mechanism Used Where Server-assigned on sync Local document held as provisional; fiscal number assigned at sync Jurisdicti
- [x] **FR-OFF-018** `[M]` Unused numbers in an expired pre-allocated block SHALL be reported as void to the fiscal authority where required, and SHALL never be silently discarded. Rationale: Fiscal sequence gaps are the most common compliance failure in offline- capable POS systems. A 
- [x] **FR-OFF-043** `[M]` Conflicts that cannot be resolved automatically SHALL be recorded in a conflict register, SHALL raise an alert, and SHALL be presented to a manager for manual resolution with both versions displayed.
- [x] **FR-OFF-050** `[M]` Business logic that must produce identical results on client and server SHALL be specified as a language-neutral test corpus, executed by both the Dart client test suite and the TypeScript server test suite in CI. Scope of the corpus: price resolution, modifie

## INT — Integrations  (3)

- [x] **FR-INT-004** `[M]` Integration failures SHALL be visible in an integration health dashboard showing per-connector status, last success, error rate, and queue depth.
- [x] **FR-INT-006** `[M]` Each connector SHALL implement a circuit breaker: after a configured failure threshold, calls are suspended and queued, with periodic probing for recovery.
- [ ] **IR-INT-064** `[S]` The System SHALL support customer-facing displays showing order contents and total.
