/**
 * Chapters 5, 7, 24, 25 and 26 of the baseline: the architecture, the
 * domain model, the patterns, the data layer and the API.
 *
 * This is the part of the specification an engineer is handed on their
 * first day, so it is published rather than paraphrased.
 */
export const architectureEn = {
  architecture: {
    eyebrow: "Architecture",
    title: "The decisions that are expensive to reverse",
    lede: "Architecture is the set of decisions that cost the most to undo. Seven drivers determine every one of them, in priority order — and when two conflict, the higher-priority one wins and the trade-off is recorded.",
    pageLede:
      "Reproduced from chapters 5, 7, 24, 25 and 26 of the baseline. Where the document shows code or a schema, so does this page.",

    driversTitle: "Architectural drivers",
    driversLede:
      "In priority order. Rank 1 beats rank 7 every time, and the loser is written down rather than argued about again.",
    driversCols: ["Driver", "Consequence"],
    driversFirstCol: "Rank",
    drivers: [
      [
        "1",
        "The POS must never stop",
        "Offline-first client; the server is not on the critical path for a sale",
      ],
      [
        "2",
        "Financial and inventory data must be correct",
        "Strong transactional consistency in the core; no eventual consistency for money or stock",
      ],
      [
        "3",
        "Tenant data must be isolated",
        "Enforced at the data layer, not at the application layer alone",
      ],
      [
        "4",
        "A 9-engineer team must ship in 9 months",
        "Modular monolith; boring technology; one language where possible",
      ],
      [
        "5",
        "Country rules must change without deployment",
        "Externalised rule configuration; strategy pattern at every jurisdiction touchpoint",
      ],
      [
        "6",
        "Reporting must not degrade transactions",
        "Read/write separation; pre-aggregation; separate connection pools",
      ],
      [
        "7",
        "Any module must be extractable later",
        "Explicit boundaries; no cross-module table access; in-process bus with a network-ready contract",
      ],
    ],

    rulesTitle: "What 'modular' actually requires",
    rulesLede:
      "A monolith without discipline becomes a big ball of mud, at which point extraction is impossible and the decision above becomes a trap. These rules are enforced mechanically, not by convention.",
    rulesCols: ["Enforcement"],
    rulesFirstCol: "Rule",
    rules: [
      [
        "A module must not import from another module's internal directory",
        "ESLint boundary rule, failing the build",
      ],
      [
        "A module must not query another module's tables",
        "Per-module database role with table-level grants, verified in CI",
      ],
      [
        "Cross-module communication goes through a published interface or a domain event",
        "Architecture test suite",
      ],
      [
        "Every module publishes a versioned contract",
        "Code review checklist plus a CI check for the contract file",
      ],
      [
        "Shared code lives in shared/ and must not contain business logic",
        "Static analysis: no domain-type imports in shared/",
      ],
      [
        "Database migrations are owned by exactly one module",
        "Naming convention plus a CI ownership check",
      ],
    ],

    extractionTitle: "The extraction path",
    extractionLede:
      "When a module has to become a service — Reporting, Sync, Fiscal and Notification are the likely order — this is the whole procedure. Steps 1 and 2 are true from day one, which is why extraction is days rather than a rewrite.",
    extraction: [
      "The module already communicates only through its contract and its events.",
      "Replace the in-process event bus binding for that module with a network transport.",
      "Replace direct interface calls with an HTTP or gRPC client implementing the same interface.",
      "Split the schema; the module's tables move with it.",
      "Deploy separately.",
    ],

    commsTitle: "How modules talk",
    comms: [
      {
        k: "Synchronous — direct interface call",
        v: "Used when the caller needs the result to proceed and the operation must be in the same transaction. Sales must know an item's current price and tax class before it can create an order line.",
      },
      {
        k: "Asynchronous in-transaction — domain events",
        v: "Used when a state change must cause other state changes atomically. Events are collected on the aggregate and dispatched by the unit of work inside the same database transaction. There is no acceptable state in which a sale is recorded and inventory is not depleted.",
      },
      {
        k: "Asynchronous out-of-transaction — transactional outbox",
        v: "Used when a state change must cause an effect outside the database. The effect is written as a row in an outbox table inside the same transaction; a relay performs it and marks it done. At-least-once delivery, no dual-write inconsistency.",
      },
    ],
    outboxNote:
      "Without the outbox the common implementation is: commit, then call the external service. If the process dies between those steps the sale exists but was never submitted to the tax authority — a compliance breach invisible until an audit. The outbox eliminates that class of bug entirely, which is why FR-PLT-041 makes it mandatory.",
    outboxCode: `BEGIN;
  INSERT INTO orders ...;
  INSERT INTO stock_movements ...;
  INSERT INTO outbox (topic, payload, ...) VALUES ('fiscal.submit', {...});
COMMIT;
-- Relay picks up the outbox row, calls the tax authority, marks processed`,

    eventsTitle: "Event catalogue",
    eventsLede:
      "The core subset. One published event, several subscribers, and no module knowing who is listening.",
    eventsCols: ["Publisher", "Principal subscribers"],
    eventsFirstCol: "Event",
    events: [
      ["order.opened", "Sales", "Kitchen Ops · Analytics"],
      ["order.line.fired", "Sales", "Kitchen Ops"],
      ["order.line.voided", "Sales", "Kitchen Ops · Inventory · Governance"],
      [
        "order.completed",
        "Sales",
        "Inventory · Costing · Treasury · Fiscal · Customer · Analytics",
      ],
      [
        "order.refunded",
        "Sales",
        "Inventory · Costing · Treasury · Fiscal · Governance",
      ],
      ["discount.applied", "Sales", "Governance · Analytics"],
      ["ticket.bumped", "Kitchen Ops", "Sales · Analytics"],
      ["stock.received", "Procurement", "Inventory · Costing"],
      ["stock.moved", "Inventory", "Costing · Analytics"],
      ["stock.counted", "Inventory", "Costing · Governance"],
      ["waste.recorded", "Inventory", "Costing · Governance · Analytics"],
      ["recipe.version.published", "Production Spec", "Costing · Catalogue"],
      ["shift.opened / shift.closed", "Workforce", "Treasury · Analytics"],
      ["cash.variance.detected", "Treasury", "Governance · Analytics"],
      ["purchase_order.approved", "Procurement", "Governance · Analytics"],
      ["day.closed", "Treasury", "Analytics · Fiscal · Reporting"],
      ["sync.conflict.resolved", "Sync", "Governance"],
    ],

    envelopeTitle: "The mandatory event envelope",
    envelopeNote:
      "correlationId and causationId are what make a production incident diagnosable. Given a complaint about an incorrect stock level, an engineer must be able to trace backwards from the movement to the order to the terminal to the cashier to the sync batch. Without causation chaining that takes hours; with it, one query.",
    envelopeCode: `{
  "eventId":        "01J8XZ...",              // ULID, globally unique
  "eventType":      "order.completed",
  "eventVersion":   2,
  "occurredAt":     "2026-08-04T11:02:33.412Z",
  "recordedAt":     "2026-08-04T11:02:33.610Z",
  "tenantId":       "...",
  "branchId":       "...",
  "actorId":        "...",
  "actorType":      "user|system|device",
  "correlationId":  "...",   // ties an entire causal chain
  "causationId":    "...",   // the event or command that caused this
  "idempotencyKey": "...",
  "payload":        { }
}`,

    domainTitle: "Domain model",
    domainLede:
      "An aggregate is a cluster of entities with one root, treated as a single unit of consistency. Four rules govern every one of them.",
    domainRules: [
      "Reference other aggregates by identity only, never by object reference.",
      "One transaction modifies one aggregate. Cross-aggregate consistency comes from domain events, inside the same transaction where atomicity is required.",
      "Invariants that must always hold are enforced inside the aggregate boundary. Invariants that may be briefly violated live between aggregates.",
      "Keep aggregates small. A large aggregate causes lock contention and usually means a consistency boundary was drawn too widely.",
    ],

    valueTitle: "Shared kernel value objects",
    valueLede:
      "Immutable, compared by value, no identity. The type system is doing real work here: Money.plus(Quantity) does not compile, and adding EGP to SAR throws rather than producing a plausible wrong number.",
    valueRows: [
      [
        "Money",
        "64-bit integer minor units plus an ISO-4217 currency with its exponent. Floating point is prohibited for money at every layer, client included.",
      ],
      [
        "Quantity",
        "Arbitrary precision to 6 decimal places, paired with a unit of measure. Converts where dimensions are compatible, throws where they are not.",
      ],
      [
        "UnitOfMeasure",
        "Mass in grams, volume in millilitres, count in pieces, length in millimetres, time in seconds — each with derived units.",
      ],
      [
        "Others",
        "TaxRate · Percentage · DateRange · PhoneNumber · Address, and every identifier type.",
      ],
    ],
    valueBrTitle: "The rules that go with them",
    valueBr: [
      [
        "BR-CORE-001",
        "Arithmetic between different currencies raises an error. There is no implicit conversion.",
      ],
      [
        "BR-CORE-002",
        "allocate distributes an amount across ratios so the sum of results exactly equals the input, giving remainder minor units to the largest ratios first.",
      ],
      [
        "BR-CORE-003",
        "Quantities are stored with 6 decimal places of precision.",
      ],
      [
        "BR-CORE-004",
        "Converting between mass and volume requires an item-specific density factor, and fails if none is configured.",
      ],
    ],
    allocateNote:
      "allocate exists because splitting a bill of 100.00 three ways produces 33.33 + 33.33 + 33.33 = 99.99. One minor unit vanishes. Over a year of split bills that is a reconciliation discrepancy the accountant cannot explain, so allocation is exact by construction rather than by rounding.",
    precisionNote:
      "Six decimals is not fussiness. A recipe may specify 0.5 g of saffron per portion; at two decimal places that rounds to zero and the ingredient silently disappears from costing.",

    statesTitle: "The order state machine",
    statesLede:
      "The Order is the most important aggregate in the system. Everything else exists to support it or to be affected by it.",
    statesDiagram: `                    ┌──────────┐
                    │  DRAFT   │  created, nothing fired
                    └────┬─────┘
                         │ fire
                         ▼
                    ┌──────────┐        void_all
                    │   OPEN   │──────────────────┐
                    └────┬─────┘                  │
             ┌───────────┼───────────┐            │
             │ hold      │ pay       │ park       │
             ▼           ▼           ▼            │
       ┌──────────┐ ┌──────────┐ ┌────────┐       │
       │   HELD   │ │ PARTIALLY│ │ PARKED │       │
       └────┬─────┘ │   PAID   │ └───┬────┘       │
            │ resume└────┬─────┘     │ resume     │
            └────────────┤◀──────────┘            │
                         │ full payment           │
                         ▼                        ▼
                   ┌───────────┐            ┌───────────┐
                   │ COMPLETED │            │ CANCELLED │
                   └─────┬─────┘            └───────────┘
                         │ refund
                         ▼
              ┌────────────────────┐
              │ PARTIALLY_REFUNDED │──▶ REFUNDED
              └────────────────────┘`,
    statesBr: [
      [
        "BR-POS-001",
        "An order in COMPLETED is never modified. Corrections are a Refund referencing it.",
      ],
      [
        "BR-POS-002",
        "An order does not reach COMPLETED while paid_total plus comps is below grand_total.",
      ],
      [
        "BR-POS-003",
        "An order is not CANCELLED if any line was fired and bumped, unless a user with order.cancel_after_production approves and a reason is recorded.",
      ],
      [
        "BR-POS-004",
        "Item name, unit price, tax class, unit cost and recipe version are captured at the time of sale and are never recomputed from current master data.",
      ],
    ],
    snapshotNote:
      "Snapshotting is the difference between a report that can be reproduced and one that cannot. If a manager renames a dish and raises its price, last month's report must still show what was sold, at the price charged, with the cost incurred. Systems that join to live master data produce reports that silently change over time, which destroys trust in every number the system produces.",

    movementsTitle: "Stock movement types",
    movementsLede:
      "The immutable ledger of all inventory change. Every quantity in the system is derivable from this one table, and no row in it is ever updated or deleted.",
    movementsCols: ["Sign", "Trigger"],
    movementsFirstCol: "Type",
    movements: [
      ["purchase_receipt", "+", "Goods receipt posted"],
      ["purchase_return", "−", "Return to supplier"],
      ["sale_depletion", "−", "Order completed"],
      ["sale_reversal", "+", "Order refunded, or line voided after firing"],
      ["transfer_out", "−", "Inter-location transfer dispatch"],
      ["transfer_in", "+", "Inter-location transfer receipt"],
      ["production_input", "−", "Consumed by a production order"],
      ["production_output", "+", "Produced by a production order"],
      ["waste", "−", "Waste recorded"],
      ["count_adjustment", "±", "Stock count posted"],
      ["manual_adjustment", "±", "Manual correction, restricted permission"],
      ["opening_balance", "+", "Initial stock load"],
      ["expiry_writeoff", "−", "Automated expiry removal"],
    ],

    patternsTitle: "Patterns, and where they earn their keep",
    patternsLede:
      "A pattern is a named solution to a recurring problem, applied where that problem actually exists. Applied where it does not, it is pure cost: more indirection, more files, more concepts to learn, no benefit.",
    patternsCols: ["Where it is applied"],
    patternsFirstCol: "Pattern",
    patterns: [
      [
        "Clean / layered architecture",
        "Every module. Recipe expansion, variance computation and tax calculation are pure functions, testable in milliseconds with no database.",
      ],
      ["Modular monolith", "The Core API, with boundaries enforced in CI."],
      [
        "CQRS, selectively",
        "Commands go through aggregates; queries bypass the domain entirely and read purpose-shaped projections. Full CQRS with separate databases is explicitly not applied.",
      ],
      [
        "Event-driven, in-process",
        "A completed order affects six modules without Sales depending on any of them.",
      ],
      ["Transactional outbox", "Every external effect, without exception."],
      [
        "Anti-corruption layer",
        "Every integration. External data structures never reach the domain.",
      ],
      ["Aggregate", "Order, Recipe version, CountSession, CashSession, PurchaseOrder, ProductionOrder. Stock level is deliberately not one."],
      ["Value object", "Money, Quantity, UnitOfMeasure, TaxRate, Percentage, DateRange, PhoneNumber, Address, identifiers."],
      ["Repository", "Domain code persists and retrieves aggregates without knowing about SQL."],
      [
        "Specification",
        "One reorder rule drives the nightly job, the low-stock badge and the purchasing screen — it cannot drift between them.",
      ],
      [
        "Policy / strategy for business rules",
        "Discount approval, inventory costing, batch consumption, tax per country pack, reorder forecasting, conflict resolution.",
      ],
      ["Unit of work", "One use case, several repositories, one transaction, events dispatched before commit."],
      ["Factory", "Constructing an Order needs prices, tax classes, country pack, business day and order number — none of which belongs in a constructor."],
      ["State", "Order and Ticket lifecycles. Adding a state is adding a class, and the compiler enumerates every question it must answer."],
      ["Composite", "A recipe contains stock items and other recipes; both traverse uniformly for cost and expansion, to a depth limit of 10."],
      ["Decorator", "Idempotency, authorisation, metrics and logging layered onto handlers without modifying them."],
      ["Chain of responsibility", "The approval workflow."],
      ["Saga / process manager", "Fiscal submission with retry, central kitchen production and distribution, aggregator order acceptance."],
      ["Event sourcing, selectively", "Stock movements and loyalty transactions only — the two places where history is the answer, writers must not conflict, and offline devices must append without coordination."],
      ["Materialised projection", "stock_levels, reporting rollups, dashboard aggregates. Each has a documented rebuild and a reconciliation job."],
      ["Optimistic concurrency", "Aggregates carry a version. Pessimistic locking is used only for order-number allocation and count-session exclusivity."],
      ["Soft delete", "Master data is deactivated while transactions reference it. Hard deletion needs no references and an audited admin operation."],
    ],

    resilienceTitle: "Resilience patterns",
    resilience: [
      ["Retry with exponential backoff and jitter", "Sync, fiscal submission, aggregator push, notification"],
      ["Circuit breaker", "Every external connector"],
      ["Bulkhead", "Separate connection and worker pools for transactional, analytical, sync and integration work"],
      ["Timeout", "Every external call and every database statement, with explicit budgets"],
      ["Dead letter queue", "Failed outbox entries after retries are exhausted, with an operator review interface"],
      ["Idempotency key", "Every command that can be retried"],
      ["Graceful degradation", "Loss of reporting, notifications or aggregators never blocks order capture"],
      ["Backpressure", "Sync batch size limits and queue depth thresholds"],
    ],

    antiTitle: "Anti-patterns explicitly rejected",
    antiLede:
      "An architecture is defined as much by what it excludes. Each of these is written down so it cannot be reintroduced by accident.",
    antiCols: ["Why it is rejected here"],
    antiFirstCol: "Anti-pattern",
    anti: [
      ["Anemic domain model", "Rules scattered into services means no single place enforces an invariant; Order could not guarantee its own totals"],
      ["Shared database between modules", "Destroys boundaries and makes extraction impossible; enforced against by per-module grants"],
      ["Distributed transactions (2PC)", "Fragile, poorly supported, and unnecessary given the modular monolith"],
      ["Floating-point money", "Guarantees eventual reconciliation failures"],
      ["Client-trusted totals", "The server revalidates everything financially significant"],
      ["UI-only permission checks", "Every endpoint authorises server-side"],
      ["A generic utils module", "Becomes a dumping ground and a hidden dependency hub"],
      ["Country logic in if (country === 'EG')", "Makes expansion a development project; violates CR-03"],
      ["Synchronous fan-out to external systems inside a request", "Couples user-facing latency to third-party availability"],
      ["Premature microservices", "See ADR-001"],
      ["Nullable everything in the database", "Makes invariants unexpressible at the schema level"],
    ],

    dataTitle: "Data architecture",
    dataLede:
      "PostgreSQL schemas group tables by bounded context, which gives a clear namespace and lets each module hold its own database role.",
    schemasCols: ["Contents"],
    schemasFirstCol: "Schema",
    schemas: [
      ["identity", "tenants · users · sessions · terminals · api_keys"],
      ["org", "brands · branches · warehouses · central_kitchens · stations · tables · settings"],
      ["catalogue", "menus · categories · menu_items · variants · modifier_groups · modifiers · combos · price_lists"],
      ["production", "recipes · recipe_versions · recipe_lines · yield_profiles"],
      ["inventory", "stock_items · uom · stock_batches · stock_movements · stock_levels · count_sessions · waste_records"],
      ["procurement", "suppliers · supplier_prices · requisitions · purchase_orders · goods_receipts · supplier_invoices"],
      ["sales", "orders · order_lines · order_line_modifiers · order_discounts · order_payments · refunds"],
      ["kitchen", "tickets · ticket_lines · station_routing_rules"],
      ["workforce", "employees · schedules · scheduled_shifts · attendance_records · clock_events"],
      ["treasury", "drawers · cash_sessions · cash_movements · expenses · day_closes"],
      ["crm", "customers · addresses · loyalty_accounts · loyalty_transactions · promotions"],
      ["fiscal", "country_packs · tax_documents · fiscal_submissions"],
      ["governance", "audit_entries · approval_requests · approval_decisions · anomaly_flags"],
      ["sync", "sync_batches · sync_operations · idempotency_keys · conflict_records · device_state"],
      ["platform", "outbox · jobs · notifications · feature_flags · migrations"],
      ["analytics", "fact_* · dim_* · rollup_*"],
    ],

    appendOnlyTitle: "Append-only, enforced by the database",
    appendOnlyNote:
      "Orders, payments, stock movements and audit entries are never updated or deleted. Corrections are new records referencing the original. This is not a convention — the grants are revoked and rules block the statements outright.",
    appendOnlyCode: `REVOKE UPDATE, DELETE ON inventory.stock_movements FROM app_role;
CREATE RULE no_update AS ON UPDATE TO inventory.stock_movements DO INSTEAD NOTHING;
CREATE RULE no_delete AS ON DELETE TO inventory.stock_movements DO INSTEAD NOTHING;

ALTER TABLE sales.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales.orders FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales.orders
    USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);`,

    partitionTitle: "Partitioning and retention",
    partitionCols: ["Partition key", "Interval", "Online retention"],
    partitionFirstCol: "Table",
    partition: [
      ["sales.orders", "business_day", "Monthly", "24 months, then archived"],
      ["sales.order_lines", "business_day", "Monthly", "24 months"],
      ["inventory.stock_movements", "occurred_at", "Monthly", "24 months"],
      ["governance.audit_entries", "occurred_at", "Monthly", "12 months, then cold storage"],
      ["analytics.fact_sales_line", "date_key", "Monthly", "36 months"],
      ["sync.sync_operations", "created_at", "Weekly", "90 days"],
    ],

    migrationTitle: "Migrations: expand, migrate, contract",
    migrationLede:
      "Every schema change is a versioned, forward-only migration that is backward compatible with the previously deployed application version. A breaking change follows five deploys, not one.",
    migration: [
      "Expand — add the new column or table, nullable, with no constraint. Deploy.",
      "Backfill — populate in throttled batches to avoid lock escalation and replication lag.",
      "Dual write — the application writes both old and new. Deploy.",
      "Migrate — switch reads to the new. Deploy. Observe.",
      "Contract — stop writing the old, and drop it after a soak period. Deploy.",
    ],
    migrationNote:
      "Any migration exceeding a five-second lock is rejected, and adding a NOT NULL column to a large table uses a nullable column plus a backfill plus a validated constraint — never a single blocking statement.",

    backupTitle: "Backup and recovery",
    backup: [
      ["Recovery point objective", "≤ 5 minutes"],
      ["Recovery time objective", "≤ 60 minutes"],
      ["Backup frequency", "Continuous WAL archiving + daily base backup"],
      ["Retention", "35 days point-in-time · 12 monthly · 7 annual"],
      ["Restore testing", "Quarterly full restore drill, timing recorded"],
      ["Cross-region copy", "Encrypted, within the same residency jurisdiction"],
      ["Single-tenant restore", "Supported without restoring the whole database"],
    ],

    apiTitle: "API design",
    apiLede:
      "REST over HTTPS, JSON, versioned in the path. The conventions below are not stylistic — several of them exist because getting them wrong costs money or leaks data.",
    apiCols: ["Convention"],
    apiFirstCol: "Aspect",
    api: [
      ["Versioning", "URL path /v1/…; breaking changes increment the major version"],
      ["Naming", "Plural, kebab-case resources: /v1/purchase-orders"],
      ["Field naming", "camelCase in JSON"],
      ["Timestamps", "RFC 3339 with an explicit offset"],
      ["Money", '{ "amount": 12500, "currency": "EGP", "exponent": 2 } — never a float'],
      ["Quantities", 'Decimal string to preserve precision: "1.250000"'],
      ["Identifiers", "ULID as a string"],
      ["Pagination", "Cursor-based; offset only for small result sets"],
      ["Idempotency", "Idempotency-Key header required on all POST and PATCH"],
      ["Concurrency", "If-Match with an ETag on updates"],
      ["Correlation", "X-Correlation-Id accepted and echoed; generated if absent"],
      ["Rate limits", "X-RateLimit-Limit, -Remaining and -Reset headers"],
      ["Documentation", "OpenAPI 3.1 generated from the implementation, so it cannot drift"],
      ["Deprecation", "Announced ≥ 180 days before removal, with a Deprecation header"],
    ],

    statusTitle: "Status codes",
    statusCols: ["Use"],
    statusFirstCol: "Code",
    status: [
      ["200", "Success with a body"],
      ["201", "Created; Location header set"],
      ["202", "Accepted for asynchronous processing; a status URL is returned"],
      ["204", "Success, no body"],
      ["400", "Malformed request"],
      ["401", "Not authenticated"],
      ["403", "Authenticated but not authorised"],
      ["404", "Not found — or not visible in this tenant scope"],
      ["409", "Conflict: version mismatch or state conflict"],
      ["422", "Semantically invalid: a business rule was violated"],
      ["429", "Rate limited; Retry-After set"],
      ["503", "Dependency unavailable; Retry-After set"],
    ],
    statusNote:
      "Cross-tenant access returns 404 rather than 403 on purpose. A 403 confirms that a resource exists in another tenant, and in a multi-tenant system that leaks information about a competitor.",

    errorTitle: "The error model",
    errorNote:
      "Every error is RFC 7807 Problem Details with a stable machine-readable code alongside the human-readable title, localised per the request's Accept-Language header, and never leaking a stack trace, SQL, an internal hostname or another tenant's data.",
    errorCode: `{
  "type":   "https://api.trendow.app/errors/discount-approval-required",
  "title":  "Discount requires approval",
  "status": 422,
  "detail": "A discount of 25% exceeds the 15% limit for role 'cashier'.",
  "instance": "/v1/orders/01J8XZ.../discounts",
  "code":   "DISCOUNT_APPROVAL_REQUIRED",
  "correlationId": "01J8XZ...",
  "errors": [
    { "field": "discount.percentage", "code": "EXCEEDS_LIMIT",
      "message": "Maximum permitted is 15%.", "limit": 15 }
  ],
  "meta": { "requiredPermission": "pos.discount.approve" }
}`,

    idempotencyTitle: "Idempotency",
    idempotency: [
      "Every POST and PATCH accepts an Idempotency-Key header, and it is mandatory on all financially significant endpoints.",
      "The key, the request fingerprint and the response are stored for at least 30 days.",
      "A repeated key with an identical fingerprint returns the stored response with Idempotent-Replay: true.",
      "A repeated key with a different fingerprint returns 409 Conflict, because that indicates a client defect rather than a retry.",
    ],

    endpointsTitle: "Representative endpoints",
    endpointsCode: `# Orders
POST   /v1/orders                              Create an order
POST   /v1/orders/{id}/lines                   Add a line
DELETE /v1/orders/{id}/lines/{lineId}          Void a line (reason required)
POST   /v1/orders/{id}/fire                    Fire to kitchen
POST   /v1/orders/{id}/discounts               Apply a discount
POST   /v1/orders/{id}/payments                Record a payment
POST   /v1/orders/{id}/complete                Complete
POST   /v1/orders/{id}/refunds                 Refund

# Inventory
GET    /v1/inventory/levels                    Current levels
GET    /v1/inventory/movements                 Movement ledger
POST   /v1/inventory/transfers                 Create a transfer
POST   /v1/inventory/counts                    Open a count session
POST   /v1/inventory/counts/{id}/post          Post the count
POST   /v1/inventory/waste                     Record waste

# Catalogue
GET    /v1/menu                                Effective menu for a context
POST   /v1/menu-items/{id}/availability        Toggle availability
POST   /v1/recipes/{id}/versions/{v}/publish   Publish a recipe version

# Procurement
POST   /v1/purchase-orders/{id}/approve        Approve
POST   /v1/goods-receipts                      Receive goods
GET    /v1/supplier-invoices/{id}/match        Three-way match result

# Sync
POST   /v1/sync/batch                          Upload an operation batch
GET    /v1/sync/changes                        Download reference-data changes
GET    /v1/sync/status                         Device sync state`,
  },
};

export type Architecture = typeof architectureEn;
