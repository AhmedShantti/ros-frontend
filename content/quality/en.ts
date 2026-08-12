/**
 * Chapters 27, 28 and 29 of the baseline: the non-functional
 * requirements that are not performance, the testing strategy, and how
 * the thing is actually operated.
 *
 * These are the chapters a buyer's technical reviewer reads and a
 * marketing site normally omits, which is exactly why they are here.
 */
export const qualityEn = {
  quality: {
    eyebrow: "Quality & operations",
    title: "How it is verified, and how it is run",
    lede: "A performance target without a percentile and a reference condition is untestable. So is a quality claim without a gate that blocks the merge. Everything below is written to be enforced by a pipeline rather than asserted in a meeting.",
    pageLede:
      "Reproduced from chapters 27, 28 and 29 of the baseline: usability and accessibility, maintainability, observability, portability, the test strategy, the quality gates, the environments, the pipeline, and the incident model.",

    /* ---------------------------- NFRs ---------------------------- */
    usabilityTitle: "Usability & accessibility",
    usabilityLede:
      "Eleven requirements, each of them derived from a person in chapter 3 rather than from a style guide.",
    usabilityCols: ["Requirement"],
    usabilityFirstCol: "ID",
    usability: [
      ["NFR-USA-001", "A three-line order is completable in no more than 6 interactions"],
      ["NFR-USA-002", "Touch targets are at least 48 × 48 dp with at least 8 dp separation"],
      ["NFR-USA-003", "Signup to first order, 30 minutes median"],
      ["NFR-USA-004", "The POS is fully operable by a user who cannot read, via an image-based menu grid"],
      ["NFR-USA-005", "A new cashier is productive after 30 minutes of training or less"],
      ["NFR-USA-006", "KDS text conveying item identity is legible at 2 m on a 21-inch 1080p display, implying a 24 pt minimum"],
      ["NFR-USA-007", "The dashboard meets WCAG 2.1 Level AA"],
      ["NFR-USA-008", "Contrast is at least 4.5:1 for text and 3:1 for interface components"],
      ["NFR-USA-009", "The dashboard is fully keyboard-navigable"],
      ["NFR-USA-010", "Every destructive action is confirmable or undoable"],
      ["NFR-USA-011", "Every error message states what happened and what to do next"],
    ],

    maintainTitle: "Maintainability",
    maintainLede:
      "Targets that decide whether the ninth engineer can be productive in the same codebase as the first.",
    maintainCols: ["Requirement", "Target"],
    maintainFirstCol: "ID",
    maintain: [
      ["NFR-MAINT-001", "Unit test coverage, domain layer", "≥ 90%"],
      ["NFR-MAINT-002", "Unit test coverage, overall", "≥ 75%"],
      ["NFR-MAINT-003", "Cyclomatic complexity per function", "≤ 10, or ≤ 15 with justification"],
      ["NFR-MAINT-004", "Module boundary violations", "Zero, enforced in CI"],
      ["NFR-MAINT-005", "Critical or high vulnerabilities in dependencies", "Zero at release"],
      ["NFR-MAINT-006", "Public API documentation", "Generated from code; drift impossible"],
      ["NFR-MAINT-007", "New engineer to first merged PR", "≤ 5 working days"],
      ["NFR-MAINT-008", "Local environment startup", "≤ 10 minutes from clone"],
      ["NFR-MAINT-009", "Architecture Decision Records", "Required for every significant decision"],
    ],

    obsTitle: "Observability",
    obsLede:
      "The difference between an incident that takes twenty minutes and one that takes a day.",
    obs: [
      ["NFR-OBS-001", "All logs structured as JSON, carrying tenant, branch, correlation and causation identifiers"],
      ["NFR-OBS-002", "Distributed tracing across the API, the workers and the database"],
      ["NFR-OBS-003", "Rate, errors and duration metrics per endpoint and per handler"],
      ["NFR-OBS-004", "Business metrics emitted: orders per minute, sync backlog, fiscal failures, offline terminals"],
      ["NFR-OBS-005", "No personal data or secrets in logs, enforced by a redaction layer with an allowlist"],
      ["NFR-OBS-006", "An alert defined for every SLO breach, each with a documented runbook"],
      ["NFR-OBS-007", "A per-tenant health view available to support without database access"],
    ],

    portTitle: "Portability & compatibility",
    port: [
      ["NFR-PORT-001", "POS on Android 9+, iOS 15+, Windows 10+"],
      ["NFR-PORT-002", "KDS on Android 9+ and evergreen browsers"],
      ["NFR-PORT-003", "Dashboard on the two most recent versions of Chrome, Safari, Edge and Firefox"],
      ["NFR-PORT-004", "Dashboard responsive from 360 px to 2560 px"],
      ["NFR-PORT-005", "Deployment portable across major cloud providers, with no lock-in beyond managed Postgres, Redis and object storage"],
      ["NFR-PORT-006", "ESC/POS printer support across the certified hardware matrix"],
    ],

    /* --------------------------- Testing --------------------------- */
    testTitle: "Test strategy",
    testLede:
      "The domain layer is tested exclusively with unit tests requiring no database, no HTTP and no framework — because the rules that matter most are the ones that must never need infrastructure to verify.",
    testCols: ["Scope", "Environment", "Runs"],
    testFirstCol: "Category",
    testCategories: [
      ["Unit", "A single class or function; domain logic", "In-memory", "Every commit"],
      ["Component", "One module through its contract", "Ephemeral Postgres (testcontainers)", "Every commit"],
      ["Integration", "Cross-module flows, events, transactions", "Full stack, seeded data", "Every PR"],
      ["Contract", "API request and response against OpenAPI", "Schema validation", "Every PR"],
      ["Conformance", "Client and server logic parity", "Both runtimes", "Every PR"],
      ["Isolation", "Cross-tenant leakage", "Generated from the schema", "Every PR"],
      ["End-to-end", "Full user journeys", "Staging", "Nightly and pre-release"],
      ["Offline", "Partition simulation, sync, conflict", "Orchestrated devices", "Nightly"],
      ["Performance", "Load and soak against the NFR targets", "Production-like", "Weekly and pre-release"],
      ["Security", "SAST, DAST, dependency scan, secret scan", "CI", "Every commit / nightly"],
      ["Localisation", "RTL layout, bidi, truncation, printing", "Device matrix", "Pre-release"],
      ["Accessibility", "WCAG 2.1 AA", "Automated and manual", "Pre-release"],
      ["Disaster recovery", "Restore drill", "Isolated", "Quarterly"],
    ],

    conformanceTitle: "The shared conformance corpus",
    conformanceLede:
      "Business logic that must produce identical results on the Dart client and the TypeScript server is specified as a language-neutral test corpus, executed by both test suites in CI. Any divergence blocks the release.",
    conformanceScope:
      "Scope: price resolution · modifier price computation · discount application and distribution · promotion evaluation · tax computation and rounding · service charge · cash rounding · loyalty accrual · recipe expansion to base ingredients.",
    conformanceCode: `{
  "id": "tax-eg-inclusive-multi-rate-001",
  "description": "EG: tax-inclusive pricing, two rates, order discount distributed",
  "context": {
    "countryPack":  "EG-2026.1",
    "currency":     "EGP",
    "pricingMode":  "tax_inclusive",
    "roundingMode": "HALF_UP"
  },
  "input": {
    "lines": [
      { "itemId": "burger", "qty": 2, "unitPrice": 12000, "taxClass": "standard" },
      { "itemId": "water",  "qty": 1, "unitPrice": 1500,  "taxClass": "zero" }
    ],
    "orderDiscount": { "type": "percentage", "value": 10 }
  },
  "expected": {
    "subtotal":      25500,
    "discountTotal":  2550,
    "taxTotal":       2661,
    "grandTotal":    22950,
    "lineTax":   [2661, 0]
  }
}`,
    conformanceNote:
      "Every production discrepancy detected on sync is triaged, and where it reveals a logic divergence a new corpus case is added before the fix is merged. The corpus only ever grows.",

    testDataTitle: "Test data",
    testData: [
      "Reproducible seed datasets: a minimal single-branch café, a 12-branch chain, a multi-brand multi-country group, and a cloud kitchen with aggregators.",
      "Test data is synthetic. Production data is never copied into a non-production environment.",
      "Where production-shaped data is needed for performance testing, it is generated at production scale rather than copied — or anonymised through a documented, verified pipeline.",
    ],

    gatesTitle: "Quality gates",
    gatesLede:
      "A gate is not advice. Each of these stops the merge or stops the release, automatically, with no override path in the normal flow.",
    gatesMergeLabel: "Blocks the merge",
    gatesMerge: [
      "Any unit or component test failure",
      "Coverage below threshold",
      "Module boundary violation",
      "Lint or type error",
      "Critical or high dependency vulnerability",
      "A secret detected in the diff",
      "Isolation suite failure",
      "Conformance corpus divergence",
      "A migration exceeding the lock budget",
    ],
    gatesReleaseLabel: "Blocks the release",
    gatesRelease: [
      "End-to-end failure",
      "Performance regression greater than 20%",
      "Accessibility regression",
      "Any critical-scenario failure",
    ],

    /* --------------------------- DevOps ---------------------------- */
    envTitle: "Environments",
    envCols: ["Purpose", "Data", "Access"],
    envFirstCol: "Environment",
    environments: [
      ["Local", "Development", "Seed", "Engineer"],
      ["CI", "Automated verification", "Ephemeral", "Automation"],
      ["Development", "Integration of in-progress work", "Seed, reset nightly", "Engineering"],
      ["Staging", "Pre-production verification, UAT", "Production-shaped synthetic", "Engineering, QA, Product"],
      ["Sandbox", "Customer and partner integration testing", "Synthetic, tenant-isolated", "External developers"],
      ["Production", "Live", "Real", "Restricted, audited, break-glass"],
    ],

    pipelineTitle: "The pipeline",
    pipelineLede:
      "Timings are the budget, not an observation. A commit that takes longer than this is a defect in the pipeline.",
    pipelineCode: `commit
  ├─ lint · typecheck · format                    ~1 min
  ├─ unit tests (parallel shards)                 ~3 min
  ├─ component tests (testcontainers)             ~5 min
  ├─ architecture boundary tests                  ~1 min
  ├─ tenant isolation suite                       ~2 min
  ├─ conformance corpus (server + client)         ~2 min
  ├─ SAST · dependency scan · secret scan         ~3 min
  └─ build container images · sign · SBOM         ~4 min
        │
pull request
  ├─ integration tests                            ~8 min
  ├─ contract tests against OpenAPI               ~2 min
  ├─ migration dry-run with lock timing           ~3 min
  └─ preview environment deployed
        │
merge to main
  ├─ deploy to staging (automatic)
  ├─ E2E suite                                    ~22 min
  ├─ smoke tests
  └─ performance baseline comparison
        │
release (tagged, manual approval)
  ├─ migration (expand phase)
  ├─ canary deploy 5% → 25% → 100%
  ├─ automated rollback on SLO breach
  └─ post-deploy verification`,

    opsTitle: "Deployment rules",
    ops: [
      ["FR-OPS-001", "Deployments are zero-downtime and rollback-capable within 5 minutes"],
      ["FR-OPS-002", "Canary deployments roll back automatically on an error-rate or latency SLO breach, with no human intervention"],
      ["FR-OPS-003", "All infrastructure is defined as code, reviewed and version controlled. Manual production changes are prohibited outside a documented break-glass procedure."],
      ["FR-OPS-004", "Container images are signed, scanned, and accompanied by a software bill of materials"],
      ["FR-OPS-005", "Feature flags gate risky changes, permitting per-tenant rollout independent of deployment"],
      ["FR-OPS-010", "POS and KDS client releases support staged rollout by tenant, branch and terminal"],
      ["FR-OPS-011", "The client operates against the previous API version for at least one release cycle, so a client update failure never prevents trading"],
      ["FR-OPS-012", "Forced updates are supported for security-critical releases, deferrable until after the current shift closes"],
      ["FR-OPS-013", "Release notes are published per release, in Arabic and English, and are visible in the product"],
    ],
    opsNote:
      "Forcing an update mid-service is the fastest way to have a customer stop trusting the product. Even a security-critical update stays deferrable to a shift boundary — with the deferral bounded.",

    sloTitle: "Service level objectives",
    sloCols: ["Objective", "Alert"],
    sloFirstCol: "Indicator",
    slo: [
      ["API availability", "99.9% monthly", "Page at the 5-minute burn rate"],
      ["API p95 latency", "≤ 200 ms read, 400 ms write", "Warn at 1.5×, page at 3×"],
      ["Sync success rate", "≥ 99.5%", "Page below 98%"],
      ["Sync backlog age", "≤ 10 minutes p95", "Page above 60 minutes"],
      ["Fiscal submission success", "≥ 99% within the window", "Page on repeated failure"],
      ["Order processing errors", "≤ 0.1%", "Page above 0.5%"],
      ["Database replication lag", "≤ 10 s", "Warn at 30 s, page at 120 s"],
      ["Job queue depth", "≤ 1,000", "Warn at 5,000"],
      ["Terminal offline rate", "≤ 2%", "Warn above 5%"],
    ],

    incidentTitle: "Incident severity",
    incidentCols: ["Definition", "Response", "Resolution target"],
    incidentFirstCol: "Severity",
    incidents: [
      ["SEV-1", "Sales blocked for multiple tenants", "15 minutes", "4 hours"],
      ["SEV-2", "A major feature is unavailable; a workaround exists", "1 hour", "24 hours"],
      ["SEV-3", "A minor feature is degraded", "4 hours", "5 days"],
      ["SEV-4", "Cosmetic or low impact", "Next business day", "Next release"],
    ],
    incidentNote:
      "Every SEV-1 and SEV-2 produces a blameless post-incident review within five working days, with action items tracked to completion. A public status page reports current and historical availability.",

    costTitle: "Cost management",
    cost: [
      ["FR-OPS-030", "Infrastructure cost is attributable per tenant, enabling gross-margin measurement per customer and detection of unprofitable accounts"],
      ["FR-OPS-031", "An alert fires when a single tenant's infrastructure consumption exceeds a configured multiple of their subscription revenue"],
    ],
  },
};

export type Quality = typeof qualityEn;
