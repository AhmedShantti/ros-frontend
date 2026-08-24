/**
 * The English dictionary, and — because `Copy` is inferred from it — the
 * shape every other language must satisfy.
 *
 * Every figure, threshold and requirement identifier in this file is
 * traceable to ROS-SRS-001 v1.0. When a claim changes here, the tag beside
 * it must still point at the requirement that authorises it. Nothing on
 * this site is allowed to promise something the document does not specify.
 */
export const en = {
  dirNote: "English · left to right",

  meta: {
    title: "TRENDOW — Restaurant Operating System",
    description:
      "One sale, nine effects. TRENDOW links sales, kitchen, recipes, inventory, purchasing, staff, cash and tax in a single system — Arabic-first, and fully operational offline.",
  },

  nav: {
    home: "Home",
    modules: "Modules",
    flows: "Flows",
    segments: "Who it's for",
    platform: "Platform",
    architecture: "Architecture",
    quality: "Quality",
    pricing: "Pricing",
    spec: "The document",
    contact: "Book a demo",
    menu: "Menu",
    close: "Close",
    /** Shown under each destination in the full-screen menu. */
    desc: {
      home: "One sale, nine effects",
      modules: "Seventeen module codes",
      flows: "Six use cases, step by step",
      platform: "Offline, Arabic, audit, integrations",
      architecture: "Drivers, domain, patterns, API",
      quality: "Testing, gates, SLOs, incidents",
      segments: "Four buyers, five personas",
      pricing: "Three tiers, per branch",
      spec: "The reference key",
      contact: "Bring your worst month",
    },
    /** Labels the language switch for assistive technology. The two
     *  option labels are the language names themselves, so they are not
     *  translated — "English" is "English" in either interface. */
    langAria: "Language",
    overlayTitle: "Where to",
    overlayNote:
      "Every page traces back to ROS-SRS-001 v1.0 — 212 functional and 148 non-functional requirements.",
  },

  ui: {
    replay: "Replay",
    live: "Live",
    tracedTo: "Traced to",
    readMore: "Read the requirement family",
    scroll: "Scroll",
  },

  hero: {
    eyebrow: "Restaurant Operating System · v1.0",
    titleA: "A Complete",
    titleB: "Restaurant Operating System.",
    titleC: "Everything you need to manage your restaurant, in one system.",
    lede: "From sales and kitchen operations to inventory, purchasing, employees and reporting, the system brings your entire operation together — giving you greater control, clearer visibility and faster decisions. Keep your restaurant running, even when the internet goes down.",
    ctaPrimary: "Book a demo",
    ctaSecondary: "Explore the system",
    /** Cycles under the headline. One list, one place on the page. */
    cycle: [
      "the kitchen",
      "the stock room",
      "the recipe",
      "the cash drawer",
      "the tax authority",
      "the roster",
      "the audit trail",
      "the customer's balance",
    ],
    thesis:
      "Every sale is a transaction against the entire business, not merely against the cash drawer.",
    thesisSpec: "SRS §1.2",

    /** The four figures under the hero. `to` drives the count-up. */
    stats: [
      { to: 212, suffix: "", k: "Functional requirements" },
      { to: 148, suffix: "", k: "Non-functional requirements" },
      { to: 72, suffix: " h", k: "Offline with no server" },
      { to: 17, suffix: "", k: "Modules, one transaction" },
    ],

    docket: {
      title: "Downtown Branch",
      order: "Order DTN-0417",
      type: "Dine-in · Table 6",
      lines: [
        { name: "Chicken shawarma", qty: "×2", price: "90.00" },
        { name: "— extra cheese", qty: "", price: "10.00" },
        { name: "Soft drink", qty: "×1", price: "20.00" },
      ],
      totalLabel: "Paid",
      total: "120.00",
      currency: "EGP",
      cashier: "Cashier 07 · Shift B",
      offline: "Recorded offline",
    },

    effectsTitle: "What the same sale did everywhere else",
    effectsHint: "Nine effects, one transaction, no human intervention.",
    effects: [
      {
        module: "Sales",
        spec: "SRS §1.2",
        text: "A sales-ledger record in the branch's operating currency.",
      },
      {
        module: "Kitchen",
        spec: "FR-KDS-010",
        text: "Two tickets routed: shawarma to the grill, drink to beverage.",
      },
      {
        module: "Inventory",
        spec: "FR-INV-030",
        text: "200 g chicken, 50 g cheese and 1 packaging unit left branch stock.",
      },
      {
        module: "Costing",
        spec: "FR-CST-001",
        text: "Cost of goods recognised at 39.00 — a 32.5% food cost on this ticket.",
      },
      {
        module: "Cash",
        spec: "FR-FIN-002",
        text: "Payment attributed to cashier 07, shift B, drawer 2.",
      },
      {
        module: "Tax",
        spec: "FR-FIN-030",
        text: "A tax record computed by the branch's country pack, queued for the authority.",
      },
      {
        module: "Workforce",
        spec: "FR-HRM-030",
        text: "The sale attributed to a server for performance measurement.",
      },
      {
        module: "Audit",
        spec: "FR-AUD-001",
        text: "An immutable audit entry — actor, device, business time, system time.",
      },
      {
        module: "Customers",
        spec: "FR-CRM-020",
        text: "Loyalty ledger appended and purchase history updated on the linked customer.",
      },
    ],
    alert: {
      label: "And one thing nobody asked for",
      text: "Cheese on hand covers 17 more orders. It runs out tomorrow at 15:00.",
      spec: "FR-MNU-033",
    },
  },

  /** The centred wordmark band that sits in the middle of the home page. */
  brand: {
    kicker: "The system behind the counter",
    line: "One sale. An entire operation moving with it.",
    sub: "Every order reaches the kitchen, updates inventory, calculates cost and records payments and reporting — automatically, inside one connected system. And it keeps trading when the internet goes down.",
    marks: [
      "Designed for Arabic",
      "Works offline",
      "Recipe-linked inventory",
      "Multi-branch",
      "Complete reporting",
    ],
  },

  /** The integration ribbon under the hero. Names only — no claims. */
  ribbon: {
    label: "Certified terminals, aggregators, ledgers and hardware",
    items: [
      "Network International",
      "Geidea",
      "PayTabs",
      "Fawry",
      "Amwal",
      "Checkout.com",
      "Talabat",
      "HungerStation",
      "Jahez",
      "Careem",
      "Deliveroo",
      "Elmenus",
      "Noon Food",
      "QuickBooks",
      "Xero",
      "Odoo",
      "Zoho Books",
      "ETA Egypt",
      "ZATCA",
      "UAE FTA",
      "ESC/POS",
    ],
  },

  numbers: {
    eyebrow: "The diagnosis",
    title: "Four numbers can decide whether a restaurant profits or quietly drains itself",
    lede: "Sales can look strong and the operation can look stable while profit erodes in the details nobody sees.",
    note: "Food cost, labour, waste and margin are not just percentages. They are the indicators that show where your restaurant earns and where it loses value.",
    items: [
      {
        k: "Food cost %",
        v: "COGS ÷ net sales",
        note: "What fraction of revenue the ingredients ate.",
        spec: "FR-CST-003",
      },
      {
        k: "Variance",
        v: "actual − theoretical",
        note: "The single most diagnostic number in restaurant operations. Uncomputable unless sales, recipes and stock live in one system with one clock.",
        spec: "FR-CST-012",
      },
      {
        k: "Labour per sales hour",
        v: "net sales ÷ hours worked",
        note: "Whether the roster matches the demand curve. Prime cost above ~65% of net sales is a warning; above 70% the business generally cannot cover rent.",
        spec: "FR-CST-031",
      },
      {
        k: "Contribution margin",
        v: "price ex-tax − direct cost",
        note: "Which dishes actually make money, by item and day-part — and what a 25% aggregator commission does to that.",
        spec: "FR-CST-005",
      },
    ],
  },

  drift: {
    eyebrow: "The arithmetic",
    title: "Don't let cost eat your profit",
    lede: "The system surfaces food-cost shifts and variance the moment they happen, so you can step in at the right time and protect your margin. Move the slider to your monthly revenue.",
    revenueLabel: "Monthly revenue",
    targetLabel: "Target food cost 30% — controlled",
    typicalLabel: "Typical uncontrolled 34.5%",
    poorLabel: "Poorly controlled 38%",
    monthly: "per month",
    annual: "per year",
    lostLabel: "Margin lost to drift",
    verdictA: "That is money that leaves through the back door, not the till.",
    verdictB:
      "A system costing USD 100–200 per branch per month that recovers even one-third of it returns 3× to 9× its cost. This is arithmetic, not a promise.",
    spec: "SRS §2.2",
    workedTitle: "The worked example from the document",
    workedText:
      "A single-branch café at USD 40,000 a month with a 30% target. Typical uncontrolled drift of 4.5 percentage points costs USD 1,800 a month — USD 21,600 a year, frequently more than the owner's own annual drawings.",
  },

  diff: {
    eyebrow: "Why not the alternatives",
    title: "Four things we will not compromise",
    lede: "Built to work in real operating conditions, not only ideal ones — so your restaurant gets more continuity, tighter control and genuine readiness to grow.",
    items: [
      {
        n: "Arabic by design, not by translation",
        spec: "FR-LOC-001",
        text: "An interface built for Arabic from the start, with a natural, clear experience rather than a translated copy of a foreign system. The result: faster use, easier training and fewer mistakes inside the operation.",
      },
      {
        n: "Offline operation, with no interruption",
        spec: "FR-OFF-001",
        text: "Even when the connection drops, the system keeps recording orders, sending them to the kitchen, capturing payments, printing receipts and managing shifts, then syncs the data automatically when the internet returns. Because the peak hour does not wait for the connection to come back.",
      },
      {
        n: "Inventory moves with every sale",
        spec: "FR-CST-001",
        text: "Each item's ingredients are deducted automatically from its recorded recipe, so you keep a sharper view of consumption, cost and waste, and your decisions rest on actual data.",
      },
      {
        n: "Ready to expand, not tied to one market",
        spec: "FR-LOC-020",
        text: "Taxes, currencies, invoices, languages and each country's settings are handled as flexible configuration inside the system, not as constants fixed in the code. Which means expanding to a new branch or a new market does not require rebuilding the system.",
      },
    ],
  },

  compare: {
    eyebrow: "Competitive landscape",
    title: "Who we are actually up against",
    lede: "Between a system that depends on the internet, another that still needs a spreadsheet, and a third that never links selling to stock, the same problem repeats: an operation that is never complete. Ours was built to close those gaps from the ground up, inside one connected system.",
    cols: ["Strength", "Structural weakness we exploit"],
    firstCol: "Competitor",
    rows: [
      [
        "Foodics — KSA / regional",
        "Strong regional presence, good POS, ZATCA integration, payments bundling",
        "Inventory and recipe depth is shallow relative to the POS; heavy upsell model; limited Egypt fiscal depth",
      ],
      [
        "Marn — KSA",
        "Clean UX, ZATCA-native, competitive pricing",
        "Narrow feature set beyond POS; limited multi-country",
      ],
      [
        "Toast — US",
        "Deepest feature set in the industry, excellent hardware integration",
        "Not available or supported in MENA; no Arabic; no regional fiscal compliance; hardware lock-in",
      ],
      [
        "Square — US / global",
        "Frictionless onboarding, strong SMB brand",
        "Weak inventory and recipe module; no Arabic-first design; no MENA fiscal compliance",
      ],
      [
        "Lightspeed — global",
        "Strong inventory, good reporting",
        "Expensive; Arabic is a translation layer; poor offline story",
      ],
      [
        "Odoo POS — open source",
        "Cheap, extensible, ERP-integrated",
        "Requires an implementation partner; POS UX is weak; offline is unreliable; not restaurant-native",
      ],
      [
        "Local bespoke systems",
        "Cheap, locally supported, often installed on-premise",
        "No cloud, no multi-branch consolidation, no updates, single point of failure, offline-only",
      ],
      [
        "Excel + WhatsApp",
        "Free, universally understood",
        "The actual incumbent in Segments A and B. Underestimating it is the classic mistake.",
      ],
    ],
  },

  economics: {
    eyebrow: "Unit economics",
    title: "The targets the business is underwritten on",
    lede: "These targets do not only describe what the system does; they define how it becomes a product that can grow, sustain itself and return real money.",
    items: [
      { k: "Average revenue per branch", v: "USD 120 / month" },
      { k: "Gross margin", v: "≥ 78%" },
      { k: "Customer acquisition cost — Segment B", v: "≤ USD 700" },
      { k: "Payback period", v: "≤ 8 months" },
      { k: "Gross monthly churn", v: "≤ 2.0%" },
      { k: "Net revenue retention", v: "≥ 108%" },
    ],
    riskLabel: "A risk that has to be priced in",
    riskText:
      "Restaurants are a high-risk sector by nature, and the closure rates in it demand a model that does not rely on deferred profit. So the service is designed to be low-cost and able to return money from a customer from the start, rather than waiting on a margin that only materialises over years.",
  },

  modules: {
    eyebrow: "Seventeen modules, one transaction",
    title: "Modules",
    lede: "Seventeen modules that work independently inside one system, with no direct data overlap and no reliance on each other's tables. The result: a steadier system, and consistent numbers you can rely on.",
    pageLede:
      "The bigger the system gets, the more each part has to stay clear and independent. So every module runs inside tight boundaries, without tangling directly into the others — keeping the numbers consistent, the operation steadier and expansion less risky. Every capability is tied to its requirements in the baseline, across 212 functional and 148 non-functional requirements, which makes each part documented, traceable and built on a foundation you can depend on.",
    groups: [
      {
        id: "operations",
        name: "The operating core",
        note: "Where the transaction happens and where the cost is incurred.",
      },
      {
        id: "business",
        name: "Running the business",
        note: "People, money, locations, customers and the numbers about all four.",
      },
      {
        id: "platform",
        name: "Platform guarantees",
        note: "The parts that decide whether any of the above can be trusted.",
      },
    ],
    items: [
      {
        id: "pos",
        group: "operations",
        spec: "FR-POS",
        name: "Point of Sale",
        line: "Where the data starts, so it is built to be fast and clear — every second at the register shows up directly in the customer's experience and the flow of service.",
        points: [
          "Dine-in, takeaway, delivery, drive-through, pickup and aggregator-injected orders",
          "Order numbers drawn from a locally-held block of 500, renewed at 80% — no server required",
          "Price resolution by strict precedence: override, promotion, time-based list, order-type list, branch, brand, base",
          "Post-fire voids force a disposition — returned to stock, wasted, or given to staff",
          "A three-line dine-in order completable in six interactions",
        ],
      },
      {
        id: "kds",
        group: "operations",
        spec: "FR-KDS",
        name: "Kitchen Display",
        line: "Reduces the work to one clear question: what has to be prepared now, and at which station? So priorities stay obvious even under pressure.",
        points: [
          "Stations for grill, fryer, cold line, hot line, beverage, barista, dessert, bakery, shawarma, packaging and pass",
          "Routing resolved by line override, modifier rule, item, category, then branch fallback",
          "Prep-time-aware staggering, so the salad is not wilting while the steak cooks",
          "Bump requires a deliberate long-press — an elbow or a splash must not delete a ticket",
          "Recall restores a mis-bumped ticket within a 30-minute window",
        ],
      },
      {
        id: "menu",
        group: "operations",
        spec: "FR-MNU",
        name: "Menu & Recipes",
        line: "Links what you actually sell to the ingredients and recipes behind it, so every sale is countable and traceable from the ground up.",
        points: [
          "Menu → category → item → variant, with breakfast, delivery, late-night and Ramadan menus",
          "Item names configurable per surface: POS button, kitchen ticket, customer receipt, aggregator listing",
          "Recipes with sub-recipes, yield percentage and per-component trim loss",
          "Modifiers carry a price delta and a recipe delta — a 'no cheese' burger does not deplete cheese",
          "An item may be sold before its recipe is complete; incompleteness is a visible metric, not a block",
        ],
      },
      {
        id: "inventory",
        group: "operations",
        spec: "FR-INV",
        name: "Inventory",
        line: "It does not just show the quantity; it exposes the gap between what should be there and what actually is, so you see where the problem starts before it turns into a loss.",
        points: [
          "Purchase, base and recipe units with conversion factors; base unit immutable after the first movement",
          "FIFO, weighted average or standard costing, configurable per item",
          "Batch and expiry tracking, with FEFO the default for anything that spoils",
          "Blind counts by default, with the expected quantity frozen at session open",
          "Negative stock is recorded and alerted, never used to block a sale",
        ],
      },
      {
        id: "purchasing",
        group: "operations",
        spec: "FR-PRC",
        name: "Purchasing & Suppliers",
        line: "A disciplined, clear purchasing cycle from request to receipt, with no excess complexity and no steps that slow the operation down.",
        points: [
          "Requisition → quotation → purchase order → goods receipt → supplier invoice → payment",
          "Simple mode collapses ordering and receiving into one action for a café that buys at the market",
          "Three-way match with configurable tolerance: 0% on quantity, 2% on unit price",
          "Price-creep detection at receipt, against the agreed supplier price",
          "Supplier scorecard: on-time delivery, fill rate, price stability, rejection rate, invoice accuracy",
        ],
      },
      {
        id: "costing",
        group: "operations",
        spec: "FR-CST",
        name: "Costing, Waste & Profit",
        line: "The analytical heart of the system; it turns operating data into numbers that show where you earn, where the margin erodes, and what needs a decision.",
        points: [
          "COGS computed on completion and snapshotted — never retroactively rewritten",
          "Theoretical versus actual usage, with recorded waste shown separately so unexplained variance is isolated",
          "Variance sorted by value, not quantity — the beef, not the flour",
          "Channel-aware margin: what a 25% commission and packaging do to a 68% dine-in margin",
          "Anomaly flags shown with their evidence and baseline, because an unexplained accusation is worse than none",
        ],
      },

      {
        id: "workforce",
        group: "business",
        spec: "FR-HRM",
        name: "Workforce",
        line: "One file linking the employee to their job, attendance and shifts, so managing the team stays clear and the data stays consistent, without duplication.",
        points: [
          "Scheduling validated against rest, consecutive days, weekly hours and required certification",
          "Clock-in by terminal PIN, geofenced mobile, or biometric device",
          "Overtime split per the branch's country pack; unapproved overtime reported, never silently included",
          "Document expiry alerts for residency, work and food-handling certificates",
          "Payroll inputs exported. Net pay, withholding and contributions are explicitly out of scope.",
        ],
      },
      {
        id: "access",
        group: "business",
        spec: "FR-SEC",
        name: "Roles & Approvals",
        line: "Every employee sees only what they need, and every sensitive action passes through the right approval — tighter control, and less room for mistakes and overrides.",
        points: [
          "Fourteen predefined roles from Owner to Kitchen Staff, cloneable but not deletable",
          "Assignments scoped to a tenant, brand, branch set or single branch; permissions never leak across scopes",
          "Temporary elevation with automatic expiry — the only control that survives operational reality",
          "Segregation of duties: self-approving a requisition, discount, variance or your own count is blocked",
          "Manager PIN approves offline; remote approval falls back to an explicit tenant policy",
        ],
      },
      {
        id: "cash",
        group: "business",
        spec: "FR-FIN",
        name: "Cash & Tax",
        line: "Every cash movement tied to the person, the shift and the drawer, so you know who took it, when, and where each transaction went.",
        points: [
          "Drawer → session → declared float → blind close → variance, approved by someone other than the owner of the session",
          "Card, wallet, voucher and aggregator payout reconciliation against settlement statements",
          "Business-day boundary configurable per branch, so 03:00 trading lands on the right day",
          "Tax computed per line and summed, never on the order total — fiscal validators reject the difference",
          "Money is 64-bit integer minor units everywhere. Floating point is prohibited at every layer.",
        ],
      },
      {
        id: "branches",
        group: "business",
        spec: "FR-BRN",
        name: "Branches & Central Kitchen",
        line: "Run several branches and operating sites as one business, with a central view connecting performance and operations across every location.",
        points: [
          "Each branch holds its own stock, drawers, roster, hours, timezone, currency and country pack",
          "Central menu, pricing and recipes with controlled per-branch deviation, and a report of who deviates",
          "Production orders with yield variance; distribution orders with proportional or priority allocation",
          "Multi-currency consolidation that shows the rate, its source and its date",
          "A new branch created by copying an existing one — menu, stations, roles, settings, printers",
        ],
      },
      {
        id: "crm",
        group: "business",
        spec: "FR-CRM",
        name: "Customers & Loyalty",
        line: "Turn every visit into a deeper understanding of your customer; understand their relationship with the restaurant, then build an experience that brings them back.",
        points: [
          "Phone in E.164 as primary identifier; a customer created at the counter in under 15 seconds",
          "Loyalty held as an append-only ledger, never a mutable balance — that is how double redemption is caught",
          "Offline accrual always permitted; offline redemption capped, with overdraw reported on sync",
          "Promotion engine with explicit conditions and effects, non-stackable by default",
          "Erasure anonymises the customer and preserves the financial record, because tax law requires it",
        ],
      },
      {
        id: "reports",
        group: "business",
        spec: "FR-RPT",
        name: "Reporting",
        line: "Data you can understand, numbers you can trace, and reports that reach you on time — leading to a decision, not to more questions.",
        points: [
          "Any figure opens to the transactions behind it within four interactions",
          "The morning brief, readable on a phone in under 30 seconds, delivered at a configurable hour",
          "Star schema with Type-2 dimensions, so reclassifying an item today does not restate last year",
          "Every report states the timestamp of its data and flags a period that is not yet complete",
          "Alerts rate-limited and de-duplicated, because forty notifications a day means none are read",
        ],
      },

      {
        id: "audit",
        group: "platform",
        spec: "FR-AUD",
        name: "Audit & Compliance",
        line: "Every change leaves a clear, retrievable trace: who did what, when, and what changed — oversight that does not rest on guesswork.",
        points: [
          "An immutable entry for every state-changing operation, with before and after state",
          "Entries hash-chained per tenant; a scheduled job verifies the chain and raises a security alert on any break",
          "The application role holds INSERT and SELECT on the audit table, and never UPDATE or DELETE",
          "Vendor support access requires an impersonation session with a reason, a time limit and tenant-visible notice",
          "Retained for seven years or the jurisdiction's statutory period, whichever is longer",
        ],
      },
      {
        id: "offline",
        group: "platform",
        spec: "FR-OFF",
        name: "Offline & Sync",
        line: "Keep selling and operating when the internet drops, then let the system sync the data when the connection returns — without losing a single hour of trading.",
        points: [
          "Four modes — online, degraded, offline with a LAN, fully isolated — detected continuously, never interrupting an order",
          "POS and KDS discover each other by mDNS and elect a LAN coordinator, so the kitchen runs with no internet",
          "Hybrid logical clocks order events across devices whose wall clocks are wrong by hours",
          "Per-entity conflict strategy: add-wins for a shared table, server-authoritative for money, commutative for stock",
          "The server revalidates every price, tax and total — then accepts the sale anyway and raises an exception",
        ],
      },
      {
        id: "localisation",
        group: "platform",
        spec: "FR-LOC",
        name: "Localisation & Country Packs",
        line: "Arabic is an original part of the design, and each country's requirements are handled flexibly inside the system — ready for your market today, and the next one tomorrow.",
        points: [
          "Arabic and English first-class on POS, KDS, dashboard, receipts, tickets, exports and error messages",
          "Numerals switchable between Western and Arabic-Indic, set separately for screen and for print",
          "Kitchen ticket language independent of receipt language — French, Turkish, Urdu, Bengali, Hindi, Tagalog packs",
          "Arabic thermal printing tested across the printer matrix, with bitmap rendering as the always-correct fallback",
          "Packs are signed, versioned by effective date, and rejected in production until they pass the conformance suite",
        ],
      },
      {
        id: "integrations",
        group: "platform",
        spec: "FR-INT",
        name: "External Integrations",
        line: "Connect the system to the services your restaurant needs without becoming dependent on them; integration widens what you can do, it does not control how you operate.",
        points: [
          "Every external system behind an anti-corruption layer; external data structures never reach the domain",
          "Outbound effects dispatched through the transactional outbox, and idempotent by construction",
          "A last-transaction query before any payment retry, so a lost response never becomes a double charge",
          "Unmapped aggregator items are rejected loudly — the system never invents a menu item",
          "Circuit breaker per connector, with health visible: last success, error rate, queue depth",
        ],
      },
      {
        id: "platform",
        group: "platform",
        spec: "FR-PLT",
        name: "Platform & Tenancy",
        line: "Every business, its branches and its data run inside an independent, isolated space — one platform able to serve many businesses without mixing them.",
        points: [
          "Row-level security on every tenant-scoped table, forced, and independent of application filtering",
          "A generated CI suite attempts cross-tenant reads on every table and fails the build on any success",
          "Settings cascade platform → country pack → tenant → brand → branch → terminal, lockable at any level",
          "A settings inspector showing which level supplied an effective value, and what it would be at each",
          "Downgrade and suspension never destroy data: it becomes read-only, and stays exportable within 24 hours",
        ],
      },
    ],
  },

  segments: {
    eyebrow: "Who it's for",
    title: "Four operations, four different first weeks",
    lede: "The needs may overlap, but buying behaviour, price sensitivity and the feature that catches attention first differ completely from one segment to another.",
    pageLede:
      "TRENDOW is sold to four segments, each with a different onboarding that leads with whatever makes it see the value from day one.",
    profileLabel: "Profile",
    painLabel: "Primary pain",
    buyingLabel: "Buying behaviour",
    needsLabel: "What matters first",
    priceLabel: "Typical spend",
    items: [
      {
        tag: "A",
        name: "Independent single branch",
        profile:
          "One location, 5–20 staff, the owner is present daily and often operating. Revenue USD 15k–60k a month.",
        pain: "Does not know the true cost. Manages stock by looking at the shelves. Suspects theft and cannot prove it.",
        buying:
          "Price sensitive. Decides in days, not months. Buys on demonstration, not on RFP. Churns quickly if onboarding is hard — so self-service onboarding is mandatory for this segment to be profitable.",
        needs: [
          "A POS that just works",
          "Offline reliability",
          "Simple stock counts",
          "Food cost per item",
          "A daily Z report",
        ],
        price: "USD 65–95 / month",
      },
      {
        tag: "B",
        name: "Small chain, 2–10 branches",
        profile:
          "The owner has stepped back from daily operation. An operations manager exists. Revenue USD 100k–600k a month aggregate.",
        pain: "Cannot compare branches, cannot enforce one price list or one recipe, suspects a branch is losing money but cannot isolate it.",
        buying:
          "Evaluates two or three vendors. Cares about migration effort. Wants a reference customer. This is the segment where the business becomes economically attractive.",
        needs: [
          "Central menu and pricing",
          "Branch comparison",
          "Inter-branch transfers",
          "Consolidated purchasing",
          "Managers who see only their branch",
        ],
        price: "USD 110–150 / branch / month",
      },
      {
        tag: "C",
        name: "Multi-brand group & franchise",
        profile:
          "Several brands, often several countries, a central kitchen, 10–100+ locations.",
        pain: "Consolidation, standardisation, franchisee compliance, royalty calculation and central production planning.",
        buying:
          "Formal procurement. Security review. Contract negotiation. A three-to-nine-month sales cycle requiring an SLA, uptime commitments and often data residency guarantees. Long payback, high lifetime value.",
        needs: [
          "Multi-brand hierarchy",
          "Central kitchen production",
          "Franchise royalty reporting",
          "API access and SSO",
          "Audit log export",
        ],
        price: "USD 180–240 / branch / month",
      },
      {
        tag: "D",
        name: "Cloud kitchen & delivery-only",
        profile:
          "No dine-in. Several virtual brands out of one kitchen, all orders from aggregators.",
        pain: "Four to eight aggregator tablets, payouts that never reconcile, and cost that cannot be attributed across brands sharing one stock room.",
        buying:
          "Fast-growing segment with a high integration dependency. Wins and loses on how many aggregators are connected and how well payouts reconcile.",
        needs: [
          "Aggregator order injection",
          "Many brands, one inventory",
          "Payout reconciliation",
          "Prep-time analytics",
          "Station load balancing",
        ],
        price: "USD 130–180 / month",
      },
    ],
    incumbent: {
      title: "The real incumbent is not a software vendor",
      text: "In segments A and B it is a spreadsheet, a notebook and a WhatsApp group. Free, understood by everyone, and already installed. Any onboarding harder than that loses regardless of feature superiority — which is why a new branch must be able to take its first order within 30 minutes of signup.",
      spec: "NFR-USA-003",
    },
    personasTitle: "The five people the design is anchored to",
    personasLede:
      "Personas here are operating conditions, not demographics. Each one produced a hard requirement.",
    personas: [
      {
        who: "Mahmoud, cashier",
        cond: "Twenty-three. Nine-hour shift. During the 13:00–15:00 rush he processes an order every 40 seconds. His hands are sometimes wet. Eleven people are watching him.",
        broke:
          "A spinner. A modal that requires reading. A search that requires typing. An item three menu levels deep.",
        req: "NFR-USA-001",
        reqText:
          "A three-line order in ≤ 6 taps and ≤ 400 ms of cumulative interface latency.",
      },
      {
        who: "Amal, branch manager",
        cond: "Thirty-four. A 22-seat café with 11 staff. Arrives at 09:00, leaves at 23:00 on bad days. She counts the fridge, calls the supplier, covers a sick shift, and explains a variance to the owner.",
        broke:
          "Reports she has to build. Alerts that fire so often she ignores them. Any workflow needing a laptop when she has a phone and flour on the counter.",
        req: "FR-RPT-055",
        reqText: "Mobile manager workflows and a daily morning brief.",
      },
      {
        who: "Youssef, group operations director",
        cond: "Forty-one. Fourteen branches, two brands, two countries. He never opens the POS. On Monday he needs to know which three branches need him this week.",
        broke:
          "Reports that don't reconcile with the accountant. Currency confusion in consolidated views. Waiting for a report to generate.",
        req: "FR-RPT-042",
        reqText:
          "Ranking over listing, and drill-through from anomaly to transaction in under four clicks.",
      },
      {
        who: "Sameh, head chef",
        cond: "Forty-seven. Six stations. He knows his recipes but has never written them down to the gram. The KDS is either an aid or an obstacle, with no middle ground.",
        broke:
          "A screen that takes more than a second to read. Recipe management demanding precision he cannot supply on day one.",
        req: "BR-MNU-012",
        reqText:
          "Glanceable at two metres, and progressive recipe precision — sell first, complete the recipe later.",
      },
      {
        who: "Nadia, external accountant",
        cond: "Fifty-two. Books for eleven small businesses. Interacts with TRENDOW twice a month. Cares about one thing: whether the numbers reconcile and whether she can export them.",
        broke: "Records that changed after she reconciled them.",
        req: "CR-04",
        reqText:
          "Export mapped to her chart of accounts, immutable records, and a clear trail for every adjustment.",
      },
    ],
  },

  platform: {
    eyebrow: "Platform",
    title: "The parts that decide whether you trust the numbers",
    lede: "A restaurant system is judged on the worst night, not the average one. These are the guarantees underneath.",
    pillars: [
      {
        name: "Offline operation",
        spec: "FR-OFF-001",
        text: "Your restaurant keeps selling even when the connection stops. Four operating modes keep the work going: online, degraded, offline with a LAN, and fully isolated. When the internet is lost, orders keep running locally with numbers and sequence drawn from a pre-reserved block, then sync automatically when the network returns — no data loss, no gaps in the sequence, and no interruption to trading or fiscal compliance.",
        rows: [
          ["Sales available with the cloud down", "≥ 99.99%"],
          ["Fully isolated operation, no degradation", "≥ 72 hours"],
          ["Committed sale lost, any single device failure", "Zero"],
          ["Duplicate financial effect", "Zero, by idempotency"],
          ["5,000 queued operations synced at 2 Mbps", "≤ 5 minutes"],
          ["Local store capacity before degradation", "≥ 20,000 orders"],
        ],
      },
      {
        name: "Arabic & country packs",
        spec: "FR-LOC-001",
        text: "One system, ready to work the way each market works. Arabic and English are both native experiences inside the system, from the cashier and kitchen screens to the dashboard, receipts, reports and error strings. It also supports independent packs per country covering the invoice and receipt, local terminology, currency, taxes and legal text — including the requirements of Egypt's ETA, Saudi ZATCA and the UAE Federal Tax Authority.",
        rows: [
          ["Interface languages", "Arabic + English, RTL authored first"],
          ["Numerals", "Western or Arabic-Indic, screen and print separately"],
          ["Fiscal integrations shipped", "ETA · ZATCA · FTA"],
          ["Additional translation packs", "FR · TR · UR · BN · HI · TL"],
          ["Calendars", "Gregorian and Hijri, per pack"],
          ["New country pack", "≤ 6 engineer-weeks, no code change"],
        ],
      },
      {
        name: "Audit & access",
        spec: "FR-AUD-001",
        text: "Every movement inside the system leaves a trace that cannot be tampered with. Every state change is recorded in an immutable audit entry carrying the actor's identity, the device, business time, system time, and even who made the change during support sessions. Entries are tied into a hash chain that makes any tampering attempt detectable — even by someone with direct database access.",
        rows: [
          ["Sensitive actions producing an audit entry", "100%"],
          ["Audit chain", "SHA-256, verified on a schedule"],
          ["Tenant data isolation", "Enforced at the data layer"],
          ["Temporary role elevation", "Expires automatically"],
          ["Audit retention", "≥ 7 years"],
          ["Audit export", "Enterprise tier"],
        ],
      },
      {
        name: "Integrations",
        spec: "FR-INT-001",
        text: "An outside partner going down should not take your business down. Every integration runs behind an anti-corruption layer, a circuit breaker and an idempotency key, so the impact of any failure stays confined to that connector rather than the whole system. And each integration's health stays visible to you through its last success, error rate and queue depth — so you know the state of every connector before it turns into an operating problem.",
        rows: [
          ["Payments", "Network International · Geidea · PayTabs · Fawry"],
          ["Aggregators", "Talabat · HungerStation · Jahez · Careem · Deliveroo"],
          ["Accounting", "QuickBooks · Xero · Odoo · Zoho Books"],
          ["Notifications", "SMS · WhatsApp Business · email · push"],
          ["Hardware", "ESC/POS printers · drawers · scales · scanners"],
          ["Public API", "REST, OAuth 2.0, OpenAPI 3.1, webhooks"],
        ],
      },
    ],

    arch: {
      title: "Architecture, stated plainly",
      text: "The strength of a system shows not only in what it does, but in its ability to stay steady as the operation grows. TRENDOW is built as one coherent modular system: a single deployable artefact, independent modules with clear boundaries, communicating over an in-process event bus inside a single transaction. Rather than loading a nine-engineer team with the complexity of microservices, the sale stays one atomic, connected operation — because what looks like a technical failure in other systems can mean a lost order and lost money to a restaurant owner.",
      spec: "ADR-001 · SRS §5.2",
      stack: [
        ["Core API", "NestJS · TypeScript · modular monolith"],
        ["Primary datastore", "PostgreSQL 16, multi-AZ"],
        ["Cache, queue, jobs", "Redis 7 · BullMQ"],
        ["Management web app", "Next.js · React · TypeScript"],
        ["POS & KDS", "Flutter, offline-first, SQLite + Drift"],
        ["Identifiers", "ULID, client-generated, time-ordered"],
        ["Money", "64-bit integer minor units + ISO 4217"],
        ["Contracts", "OpenAPI 3.1, generated from the implementation"],
      ],
      decisionsTitle: "The decisions that were expensive to make",
      decisions: [
        [
          "ADR-001",
          "Modular monolith over microservices — nine engineers, and one atomic sale across six domains",
        ],
        [
          "ADR-003",
          "Shared schema with row-level tenant isolation, and a schema-per-tenant escape hatch",
        ],
        [
          "ADR-004",
          "Offline-first POS with a full local SQLite store; the server is a sync target, not a dependency",
        ],
        [
          "ADR-005",
          "Country rules as signed data, driven by registered strategy implementations",
        ],
        [
          "ADR-008",
          "Money as integer minor units. Floating point prohibited at every layer, client included.",
        ],
        [
          "ADR-010",
          "Append-only financial and inventory records; corrections reference the original",
        ],
      ],
    },

    perf: {
      title: "Performance targets",
      note: "Measured at p95 against the reference conditions: an Android 11 POS device with 4 GB RAM and a 10-inch 1280×800 screen, a 5 Mbps network at 80 ms RTT, and a 30-branch tenant doing 400 orders per branch per day across 800 menu items and 2,500 stock items.",
      rows: [
        ["Item added to rendered on screen", "≤ 100 ms"],
        ["Payment finalised, offline / online", "≤ 800 ms / 1.5 s"],
        ["POS cold start", "≤ 6 s"],
        ["Fired order shown on the kitchen screen", "≤ 1 s"],
        ["Recipe expansion and depletion, 30-line order", "≤ 200 ms"],
        ["Stock level query, 3,000 items", "≤ 500 ms"],
        ["Standard report, 31 days, one branch", "≤ 2 s"],
        ["Consolidated report, 100 branches, 31 days", "≤ 5 s"],
        ["API read / write endpoints", "≤ 200 ms / 400 ms"],
        ["Signup to first order", "≤ 30 min median"],
      ],
    },

    scale: {
      title: "Scale and availability",
      note: "Ceilings the architecture is required to reach, and the uptime it is required to hold while doing so.",
      scaleRows: [
        ["Tenants per regional deployment", "≥ 10,000"],
        ["Branches per tenant", "≥ 500"],
        ["Concurrent active terminals per region", "≥ 50,000"],
        ["Peak orders per second per region", "≥ 500"],
        ["Menu items per brand", "≥ 5,000"],
        ["Stock items per tenant", "≥ 20,000"],
      ],
      availRows: [
        ["Cloud service uptime, monthly", "≥ 99.9%"],
        ["Enterprise-tier commitment", "≥ 99.95%"],
        ["POS sales availability", "≥ 99.99%"],
        ["Recovery point / recovery time", "≤ 5 min / ≤ 60 min"],
        ["Planned maintenance", "≤ 4 h per month, 7 days notice"],
        ["Zero-downtime deployment", "Required for every release"],
      ],
    },

    packs: {
      title: "Country packs",
      lede: "A country pack is a signed, versioned bundle: currency and exponent, tax engine and classes, rounding mode and point, invoice template and sequence strategy, fiscal provider and retry policy, labour rules, calendar and observances, and the legal receipt footer. Three are implemented; seven are specified for Phase 3.",
      items: [
        {
          code: "EG",
          name: "Egypt",
          spec: "IR-LOC-EG-001",
          rows: [
            ["Currency", "EGP, exponent 2, symbol suffixed"],
            ["Pricing mode", "Tax-inclusive, computed per line"],
            ["Standard / reduced rate", "14% / 5%, plus zero and exempt"],
            ["Fiscal", "ETA e-Receipt (B2C), e-Invoice (B2B)"],
            ["Sequence", "Pre-allocated block of 500, unused reported void"],
            ["Week", "Starts Saturday, weekend Friday"],
          ],
          note: "Receipt, invoice, credit note and debit note are all supported, with the original correctly referenced on corrections. Authority downtime queues and retries; it never blocks a sale.",
        },
        {
          code: "SA",
          name: "Saudi Arabia",
          spec: "IR-LOC-SA-001",
          rows: [
            ["Standard", "ZATCA Fatoora Phase 2, by taxpayer wave"],
            ["B2C simplified invoice", "TLV / Base64 QR, reported within 24 h"],
            ["B2B standard invoice", "Clearance model, pre-issuance"],
            ["Invoice hash chain", "PIH maintained across offline periods"],
            ["Certificates", "Stamp lifecycle managed, expiry alerted"],
          ],
          note: "The clearance model requires a synchronous authority round-trip before an invoice may be issued, which conflicts directly with offline operation. The pack therefore restricts B2B standard invoices to online operation while B2C simplified invoices work offline. This is a legal reality, surfaced in the interface rather than worked around.",
        },
        {
          code: "AE",
          name: "United Arab Emirates",
          spec: "IR-LOC-AE-001",
          rows: [
            ["Tax", "FTA VAT, with zero-rated and exempt handled"],
            ["Additional components", "Municipality fee, tourism dirham"],
            ["Invoice", "All FTA-mandated fields, Arabic where required"],
            ["E-invoicing mandate", "Provider interface already abstracted"],
          ],
          note: "Multiple simultaneous tax components each carry their own rate, base and rounding, which is what the emirate-level fees require.",
        },
      ],
      phase3Label: "Specified for Phase 3",
      phase3:
        "Jordan · Kuwait · Qatar · Bahrain · Oman · Morocco · Tunisia. Each requires currency and exponent, tax model, invoice content rules, fiscal integration where mandated, labour rules and calendar — and none requires a change to core application code.",
    },

    security: {
      title: "Security & compliance",
      lede: "The threat model is STRIDE. The controls below are the ones a buyer's security review asks about, and the ones an operator's internal control depends on.",
      items: [
        {
          k: "Card data",
          v: "Never stored, logged or transmitted — no PAN, CVV, stripe data or PIN blocks, anywhere, including logs, backups and crash reports. Only last four digits, scheme, authorisation code and terminal reference are retained.",
          spec: "CR-05 · FR-SEC-044",
        },
        {
          k: "Tenant isolation",
          v: "PostgreSQL row-level security, forced, on every tenant-scoped table, independent of application filtering. A request reaching the data layer without a tenant context fails closed.",
          spec: "FR-PLT-010",
        },
        {
          k: "Authorisation",
          v: "Enforced server-side on every endpoint. Client-side permission checks are presentation only and are never relied upon.",
          spec: "FR-SEC-045",
        },
        {
          k: "Cross-tenant probing",
          v: "A resource in another tenant returns 404, not 403 — because 403 would confirm it exists.",
          spec: "SRS §26.2",
        },
        {
          k: "Encryption",
          v: "TLS 1.3 in transit, TLS 1.2 as the minimum fallback. At rest everywhere, including the POS local database, which is unusable once a terminal's registration is revoked. Sensitive fields get envelope encryption with per-tenant keys.",
          spec: "FR-SEC-040..043",
        },
        {
          k: "Multi-factor",
          v: "Mandatory for any role holding user management, tenant settings or API key management. PIN authentication is terminal-bound and never grants dashboard access.",
          spec: "FR-SEC-021 · FR-SEC-024",
        },
        {
          k: "Segregation of duties",
          v: "Incompatible permission pairs are reported; approving your own requisition, discount, cash variance or count is blocked outright.",
          spec: "FR-SEC-016",
        },
        {
          k: "Verification",
          v: "SAST, DAST, dependency and secret scanning on every build, with a critical finding blocking the merge. External penetration test before general availability and annually thereafter.",
          spec: "FR-SEC-049 · FR-SEC-051",
        },
      ],
      complianceTitle: "Compliance mapping",
      complianceCols: ["Obligation", "How TRENDOW satisfies it"],
      complianceFirstCol: "Source",
      compliance: [
        [
          "PCI-DSS v4.0",
          "Card data protection",
          "Out of scope by design — processing stays on certified external terminals",
        ],
        [
          "OWASP ASVS 4.0 L2",
          "Application security",
          "Verified in the security test suite on every build",
        ],
        [
          "Egypt ETA",
          "E-invoice and e-receipt submission",
          "Country pack EG, with queued retry through the outbox",
        ],
        [
          "KSA ZATCA Phase 2",
          "Cryptographic stamp, QR, clearance",
          "Country pack SA, with the PIH chain maintained offline",
        ],
        [
          "UAE FTA",
          "VAT invoice content and retention",
          "Country pack AE",
        ],
        [
          "GDPR — EU tenants",
          "Lawful basis, data subject requests, DPA",
          "Consent records, DSR tooling, EU residency region",
        ],
        [
          "Local labour law",
          "Working time records",
          "Attendance and overtime records per country pack",
        ],
      ],
    },

    outage: {
      title: "Six hours with no internet, during peak trading",
      lede: "Use case UC-OFF-01 from the specification, as it is written: three POS terminals, two kitchen screens, one shared LAN, connectivity lost at 12:00.",
      spec: "SRS §21.11",
      steps: [
        {
          t: "12:00:00",
          h: "Detection",
          d: "Terminals detect loss of server reachability within 10 seconds and transition to Offline. A subtle indicator appears. No dialog interrupts the cashier.",
        },
        {
          t: "12:00:10",
          h: "LAN coordinator elected",
          d: "Devices discover each other by mDNS and elect Terminal 1 as coordinator, holding authoritative branch-local state for the outage.",
        },
        {
          t: "12:00–18:00",
          h: "412 orders taken",
          d: "Order entry, modifier selection, pricing, tax, discounts within manager-PIN authority, cash and card recording, receipt printing and kitchen routing all function normally.",
        },
        {
          t: "Kitchen",
          h: "Routing over the LAN",
          d: "Tickets reach the station screens inside the normal latency budget and bumps propagate back to the POS. No cloud round-trip is on the path.",
        },
        {
          t: "Loyalty",
          h: "A capped redemption",
          d: "A 4,000-point redemption exceeds the 2,000-point offline limit. The excess is declined with a clear message and the permitted amount is offered.",
        },
        {
          t: "Fiscal",
          h: "412 of 500 numbers used",
          d: "Receipts are issued from the terminal's pre-allocated fiscal block. The 88 unused numbers will be reported void rather than silently discarded.",
        },
        {
          t: "18:00",
          h: "Prioritised sync",
          d: "412 orders, 439 payments, 6 cash sessions and 1,204 audit events transmit in causal order in about 90 seconds. Financially significant operations go first.",
        },
        {
          t: "Revalidation",
          h: "Four two-piastre differences",
          d: "A price change published at 13:00 never reached the terminals. All four orders are accepted — the customer already paid and left — and four reconciliation exceptions are raised for a human.",
        },
        {
          t: "Result",
          h: "No sale lost, none duplicated",
          d: "Fiscal sequence intact. Three items went negative, correctly flagging an unrecorded goods receipt rather than blocking any of the sales that caused it.",
        },
      ],
    },
  },

  pricing: {
    eyebrow: "Commercial model",
    title: "Per branch, per month",
    lede: "Recipe-linked inventory is in every tier, including the cheapest one. Charging for it would be charging for the reason the product exists.",
    perMonth: "/ branch / month",
    ctaTier: "Start here",
    popular: "Most chosen",
    tiers: [
      {
        name: "Starter",
        price: "65",
        for: "One branch, owner-operated",
        highlights: [
          "1 POS terminal, 1 kitchen screen",
          "Full offline operation",
          "Menu, modifiers, recipes and food cost",
          "Basic inventory and waste",
          "300 API requests / minute",
          "Email support, 24h",
        ],
      },
      {
        name: "Professional",
        price: "129",
        for: "2–10 branches with an operations manager",
        highlights: [
          "3 POS terminals, 4 kitchen screens",
          "Full inventory, batch and expiry (FEFO)",
          "Purchasing and suppliers",
          "Scheduling and multi-branch consolidation",
          "Aggregators, custom roles, read-only API",
          "Chat support, 8h",
        ],
      },
      {
        name: "Enterprise",
        price: "199–240",
        for: "Multi-brand groups, franchises, central kitchens",
        highlights: [
          "Unlimited terminals and screens",
          "Central kitchen production and distribution",
          "Multi-brand hierarchy and franchise royalties",
          "Full fraud detection and audit export",
          "Full API, SSO (SAML/OIDC), IP allow-listing",
          "Dedicated support, 2h, 99.95% uptime",
        ],
      },
    ],
    matrixTitle: "What changes between tiers",
    matrixCols: ["Starter", "Professional", "Enterprise"],
    matrixFirstCol: "Capability",
    matrix: [
      ["POS terminals included", "1", "3", "Unlimited"],
      ["Kitchen screens included", "1", "4", "Unlimited"],
      ["Offline operation", "yes", "yes", "yes"],
      ["Menu & modifiers", "yes", "yes", "yes"],
      ["Recipes & food cost", "yes", "yes", "yes"],
      ["Inventory & counts", "Basic", "Full", "Full"],
      ["Batch & expiry (FEFO)", "no", "yes", "yes"],
      ["Purchasing & suppliers", "no", "yes", "yes"],
      ["Waste management", "Basic", "Full", "Full + anomaly detection"],
      ["Employee scheduling", "no", "yes", "yes"],
      ["Multi-branch consolidation", "—", "yes", "yes"],
      ["Central kitchen production", "no", "no", "yes"],
      ["Multi-brand", "no", "no", "yes"],
      ["Fraud detection", "no", "Basic", "Full"],
      ["Custom roles", "no", "yes", "yes"],
      ["API access", "no", "Read-only", "Full"],
      ["SSO (SAML/OIDC)", "no", "no", "yes"],
      ["Aggregator integration", "Add-on", "yes", "yes"],
      ["API requests / minute", "300", "1,200", "6,000"],
      ["Sync batch size", "500 ops", "2,000 ops", "5,000 ops"],
      ["Export rows / day", "100,000", "1,000,000", "10,000,000"],
      ["Support SLA", "Email, 24h", "Chat, 8h", "Dedicated, 2h"],
    ],
    addonsTitle: "Add-ons",
    addons: [
      [
        "Onboarding & setup",
        "USD 150–2,500 once",
        "Scales with menu and recipe complexity",
      ],
      ["Extra POS terminal", "USD 20 / month", ""],
      ["Extra kitchen screen", "USD 15 / month", ""],
      ["Aggregator connector", "USD 25 / month", "Per aggregator"],
      [
        "Benchmarking reports",
        "USD 40 / month",
        "Anonymised peer data, requires consent",
      ],
      [
        "Franchise royalty module",
        "USD 300 / month",
        "Per brand, Enterprise only",
      ],
    ],
    lifecycleTitle: "What happens if you stop paying",
    lifecycleLede:
      "Recorded as an engineering requirement, not a policy page. Restaurants have seasonal cash-flow problems, and a system that destroys a lapsed customer's data guarantees they never return.",
    lifecycleCols: ["What the system does"],
    lifecycleFirstCol: "State",
    lifecycle: [
      ["Trial", "Full features, watermarked receipts, 30 days"],
      ["Active", "Full features per plan"],
      ["Past due", "Full features, in-app banner, 14-day grace"],
      [
        "Restricted",
        "POS read-only: existing orders closable, no new orders, full export available",
      ],
      ["Suspended", "Login blocked, data retained, export available on request"],
      ["Terminating", "Read-only, export enabled, reversible 30-day countdown"],
    ],
    lifecycleNote:
      "Data beyond a plan's limits becomes read-only rather than being destroyed, and at any state except purged a tenant can export everything — CSV per entity plus a JSON manifest — within 24 hours of asking.",
    footnote:
      "Indicative pricing from the TRENDOW commercial model. Final pricing depends on country, branch count and hardware.",
  },

  spec: {
    eyebrow: "The document",
    title: "Everything on this site points back to one baselined specification",
    lede: "ROS-SRS-001 version 1.0, baselined on 4 August 2026. 212 functional and 148 non-functional requirements, written to be independently verifiable — a requirement that cannot be tested is not a requirement, and has been either rewritten or moved to the vision section.",
    note: "This page is the reference key for the tags used everywhere else on the site.",

    controlTitle: "Document control",
    controlRows: [
      ["Document ID", "ROS-SRS-001"],
      // The baseline was authored before the product was named. The ID is
      // a citation, so it stays exactly as the document carries it.
      ["Working name in the document", "ROS — Restaurant Operating System"],
      ["Product name", "TRENDOW"],
      ["Version", "1.0"],
      ["Status", "Baselined for Phase 1 development"],
      ["Baselined", "2026-08-04"],
      ["Standard basis", "IEEE 830-1998 · ISO/IEC/IEEE 29148:2018"],
      ["Architecture notation", "C4 Model · UML 2.5 · BPMN 2.0"],
      ["Primary language", "English technical, Arabic business summaries"],
      ["Functional requirements", "212"],
      ["Non-functional requirements", "148"],
      ["Classification", "Confidential — internal and investor distribution"],
    ],

    schemeTitle: "Requirement identification",
    schemeLede:
      "Format is TYPE-MODULE-NUMBER. Identifiers are never reused, even after deletion — a withdrawn requirement is marked and retained. FR-POS-042 is the forty-second functional requirement of the Point of Sale module.",
    typesTitle: "Types",
    types: [
      ["FR", "Functional requirement — something the system does"],
      ["NFR", "Non-functional requirement — a quality the system exhibits"],
      ["BR", "Business rule — a constraint from the business domain"],
      ["UC", "Use case"],
      ["DR", "Data requirement"],
      ["IR", "Integration requirement"],
      ["CR", "Constraint"],
    ],
    codesTitle: "Module codes",
    codes: [
      ["POS", "Point of Sale"],
      ["KDS", "Kitchen Display System"],
      ["MNU", "Menu & Recipe Management"],
      ["INV", "Inventory Management"],
      ["PRC", "Purchasing & Suppliers"],
      ["CST", "Costing, Waste & Profitability"],
      ["HRM", "Employee Management"],
      ["SEC", "Security, Roles & Permissions"],
      ["FIN", "Cash & Financial Management"],
      ["BRN", "Branch & Central Kitchen"],
      ["CRM", "Customer & Loyalty"],
      ["RPT", "Reporting & Analytics"],
      ["AUD", "Audit & Compliance"],
      ["OFF", "Offline Operation & Synchronisation"],
      ["LOC", "Localisation & Country Packs"],
      ["INT", "External Integrations"],
      ["PLT", "Platform, Tenancy & Administration"],
    ],
    priorityTitle: "Priority — MoSCoW",
    priorityCols: ["Meaning", "Release implication"],
    priorityFirstCol: "Priority",
    priority: [
      ["M — Must", "The product is not viable without it", "Phase 1"],
      [
        "S — Should",
        "Significant value; the product ships without it under protest",
        "Phase 1 or 2",
      ],
      ["C — Could", "Desirable; included if capacity permits", "Phase 2 or 3"],
      [
        "W — Won't, this time",
        "Explicitly deferred, recorded to prevent re-litigation",
        "Backlog",
      ],
    ],
    conventionsTitle: "Keywords",
    conventions: [
      ["SHALL / MUST", "An absolute requirement. Non-compliance is a defect."],
      [
        "SHOULD",
        "A strong recommendation. Deviation requires documented architectural justification.",
      ],
      ["MAY", "Genuinely optional. Implementer's discretion."],
    ],

    assumptionsTitle: "Assumptions",
    assumptionsLede:
      "Six assumptions the design rests on, each recorded with what breaks if it turns out to be false.",
    assumptionsCols: ["Assumption", "Impact if false"],
    assumptionsFirstCol: "ID",
    assumptions: [
      [
        "A-01",
        "Branches have at least intermittent connectivity — several hours a day",
        "The offline architecture already mitigates; the sync backlog grows but the system functions",
      ],
      [
        "A-02",
        "Tenants operate legally registered businesses with tax registration numbers",
        "Fiscal integration cannot complete; the tenant is restricted to non-fiscal mode",
      ],
      [
        "A-03",
        "Kitchen staff can read either Arabic or the branch's configured language",
        "Requires the icon-driven KDS mode specified as FR-KDS-031",
      ],
      [
        "A-04",
        "Card processing is performed by certified external terminals, not by TRENDOW",
        "Would force PCI-DSS Level 1 scope onto TRENDOW. This assumption is load-bearing.",
      ],
      [
        "A-05",
        "Tenants accept cloud hosting; on-premise is not offered in Phase 1",
        "Enterprise deals in regulated markets may require a private deployment SKU",
      ],
      [
        "A-06",
        "Recipe data is maintained by the tenant; TRENDOW does not supply a recipe library",
        "Onboarding effort increases; mitigated by import tooling and templates",
      ],
    ],

    constraintsTitle: "Constraints",
    constraintsCols: ["Constraint", "Type"],
    constraintsFirstCol: "ID",
    constraints: [
      [
        "CR-01",
        "The POS must operate for a minimum of 72 hours without server connectivity",
        "Technical",
      ],
      [
        "CR-02",
        "Arabic and English must be first-class languages with full RTL/LTR support, not translations",
        "Product",
      ],
      [
        "CR-03",
        "Country-specific tax logic must not be compiled into core application code",
        "Architectural",
      ],
      [
        "CR-04",
        "Financial records, once posted, are immutable. Corrections are compensating entries.",
        "Regulatory",
      ],
      [
        "CR-05",
        "The system must not store, process or transmit primary account numbers",
        "Security",
      ],
      ["CR-06", "The Phase 1 engineering team is capped at 9 engineers", "Organisational"],
      [
        "CR-07",
        "The POS must be operable on a 10-inch touchscreen at 1280×800 with no horizontal scrolling",
        "Hardware",
      ],
      [
        "CR-08",
        "Audit records must be retained for 7 years or the statutory period, whichever is longer",
        "Regulatory",
      ],
    ],

    scopeTitle: "Explicitly out of scope for Phase 1",
    scopeLede:
      "Recorded so it cannot be re-litigated, and so sales cannot promise it. A specification is defined as much by what it excludes.",
    scopeCols: ["Rationale", "Reconsider at"],
    scopeFirstCol: "Excluded",
    scope: [
      [
        "Full general ledger accounting",
        "Competing with accounting systems is a distraction; export is sufficient",
        "Phase 4",
      ],
      [
        "Payroll calculation",
        "Jurisdiction-specific labour law is a product in itself",
        "Phase 4",
      ],
      [
        "Own delivery driver dispatch and routing",
        "A distinct problem domain; partner instead",
        "Phase 3",
      ],
      [
        "White-label customer ordering app",
        "Aggregators dominate; low differentiation",
        "Phase 3",
      ],
      ["Table reservation and waitlist", "Adjacent, integrable", "Phase 2"],
      ["Hardware manufacturing", "Capital intensive", "Never"],
      [
        "In-house payment processing",
        "Regulatory burden and PCI scope",
        "Partner only",
      ],
      [
        "Nutrition and allergen certification",
        "Liability; data fields provided, not certification",
        "Phase 3",
      ],
      [
        "Franchise legal and contract management",
        "Not software-solvable at our scale",
        "Never",
      ],
    ],

    glossaryTitle: "Operative glossary",
    glossaryLede:
      "Terms defined here have precise meaning throughout the document and are not used loosely anywhere on this site.",
    glossary: [
      ["Tenant", "A commercial customer. Owns one or more brands. The data isolation boundary."],
      ["Brand", "A restaurant concept owned by a tenant, with its own menu and identity."],
      [
        "Branch",
        "A physical location where sales occur. Belongs to exactly one brand. Holds its own inventory, drawers and roster.",
      ],
      [
        "Central kitchen",
        "A production facility manufacturing semi-finished or finished goods and distributing them to branches.",
      ],
      [
        "Business day",
        "An operational day that may not align with the calendar day. A branch closing at 03:00 attributes those sales to the previous business day.",
      ],
      [
        "Fire",
        "The act of releasing an order or a course to the kitchen for preparation.",
      ],
      [
        "Ticket",
        "The kitchen-facing representation of an order, or a subset of one, routed to a single preparation station. It has its own lifecycle.",
      ],
      [
        "Modifier",
        "An addition, removal or substitution on an order line. Carries a price delta and a recipe delta.",
      ],
      [
        "Sub-recipe",
        "A recipe that is an ingredient of another recipe. Sauces, doughs, marinades, stocks. Also called a prep item.",
      ],
      [
        "Yield",
        "The output quantity a recipe produces, accounting for preparation loss.",
      ],
      [
        "Theoretical usage",
        "The inventory quantity that should have been consumed, computed from sales × recipes.",
      ],
      [
        "Actual usage",
        "The quantity that was consumed: opening count + received − closing count.",
      ],
      [
        "Variance",
        "Actual usage minus theoretical usage. The single most important operational metric in the system.",
      ],
      [
        "Comp",
        "An item given without charge, recorded at full cost. Distinct from a discount, which is a pricing decision.",
      ],
      [
        "Opening float",
        "Cash placed in a drawer before trading begins.",
      ],
      [
        "X report / Z report",
        "A mid-shift non-resetting summary, and the terminal report that closes a shift or business day and resets counters.",
      ],
      [
        "Country pack",
        "A signed, versioned bundle of a jurisdiction's tax rules, invoice format, currency, fiscal integration and legal text.",
      ],
      [
        "FIFO / FEFO",
        "First in, first out — by receipt date. First expired, first out — by expiry date. FEFO is the default for anything that spoils.",
      ],
      [
        "Outbox",
        "A durable local queue of state changes awaiting an effect outside the database, guaranteeing at-least-once delivery with no dual-write inconsistency.",
      ],
      [
        "HLC",
        "Hybrid logical clock. Combines physical and logical time so events order correctly across devices whose wall clocks are wrong.",
      ],
      [
        "Idempotency key",
        "A client-generated token guaranteeing an operation is applied at most once.",
      ],
      [
        "RBAC / ABAC / SoD",
        "Role-based access control, attribute-based access control, and segregation of duties.",
      ],
    ],

    actorsTitle: "Actors",
    actorsLede:
      "Eighteen human actors and seven system actors. Actors are the subjects of use cases and the anchor points of the permission model.",
    humanLabel: "Human actors",
    systemLabel: "System actors",
    humanActors: [
      ["ACT-01", "Platform Administrator", "Cross-tenant"],
      ["ACT-02", "Tenant Owner", "All brands and branches"],
      ["ACT-03", "Operations Director", "All branches of assigned brands"],
      ["ACT-04", "Brand Manager", "One brand"],
      ["ACT-05", "Branch Manager", "One branch"],
      ["ACT-06", "Shift Supervisor", "One branch, during shift"],
      ["ACT-07", "Cashier", "One terminal, during shift"],
      ["ACT-08", "Waiter / Server", "One branch, assigned tables"],
      ["ACT-09", "Kitchen Staff", "One station"],
      ["ACT-10", "Head Chef", "All stations, recipes"],
      ["ACT-11", "Storekeeper", "One branch or warehouse"],
      ["ACT-12", "Purchasing Officer", "Tenant-wide purchasing"],
      ["ACT-13", "Accountant", "Financial data, read and export"],
      ["ACT-14", "Auditor", "Read-only, all data and the audit log"],
      ["ACT-15", "HR Officer", "Employee records, attendance"],
      ["ACT-16", "Central Kitchen Manager", "Production and distribution"],
      ["ACT-17", "Franchisee", "Own branches, restricted configuration"],
      ["ACT-18", "Customer", "Receipt QR, loyalty portal, QR menu"],
    ],
    systemActors: [
      ["ACT-20", "Payment Terminal", "Authorisation request and response"],
      ["ACT-21", "Fiscal Authority Gateway", "Submission, UUID return"],
      ["ACT-22", "Delivery Aggregator", "Order injection, status callback"],
      ["ACT-23", "Accounting System", "Journal entry export"],
      ["ACT-24", "SMS / WhatsApp Gateway", "Notification dispatch"],
      ["ACT-25", "Thermal Printer", "Receipt and ticket rendering"],
      ["ACT-26", "Scheduler", "Day close, reorder suggestions, report delivery"],
    ],

    contextsTitle: "Bounded contexts",
    contextsLede:
      "Sixteen contexts. Within one, a term has a single unambiguous meaning; across two, the same word may mean different things, and translation happens explicitly at the boundary.",
    contextsCols: ["Core concern", "Language note"],
    contextsFirstCol: "Context",
    contexts: [
      ["Identity & Tenancy", "Who exists, who they are", "'User' is a login. Distinct from 'Employee'."],
      ["Organisation", "Physical and legal structure", "'Location' is abstract; branch and warehouse are concrete."],
      ["Catalogue", "What can be sold", "'Item' means sellable. In Inventory it means stockable."],
      ["Production Spec", "How things are made", "'Ingredient' links to an Inventory item, never copies it."],
      ["Sales", "Commercial transactions", "'Order' is a commercial agreement, not a kitchen task."],
      ["Kitchen Ops", "Producing the order", "'Ticket' is the kitchen's view of an order, with its own lifecycle."],
      ["Inventory", "Physical goods", "Stock level is a projection over an append-only movement log."],
      ["Procurement", "Acquiring goods", "Requisition, purchase order, goods receipt, supplier invoice."],
      ["Costing", "Money consumed", "Cost snapshots, variance reports, waste records."],
      ["Workforce", "People at work", "'Employee' is a person in a job. Distinct from 'User'."],
      ["Treasury", "Cash and settlement", "Drawer, cash session, expense, day close."],
      ["Customer", "Demand-side relationships", "Customer, loyalty account, promotion."],
      ["Fiscal", "Legal compliance of documents", "Tax document, country pack, submission record."],
      ["Analytics", "Derived understanding", "Read-only. Never a source of truth."],
      ["Governance", "Accountability", "Audit entry, approval request, policy."],
      ["Sync", "Distributed consistency", "Sync batch, device state, conflict record."],
    ],

    testsTitle: "Release-blocking scenarios",
    testsLede:
      "Fifteen scenarios whose failure prevents a release regardless of every other result. They exist because each one is a way the product could be wrong in a manner the customer would never forgive.",
    testsCols: ["Pass criterion"],
    testsFirstCol: "Scenario",
    tests: [
      [
        "CT-01 · 72-hour full offline operation, 500 orders, then sync",
        "Zero loss, zero duplication, fiscal sequence intact",
      ],
      [
        "CT-02 · Network partition mid-payment on an integrated terminal",
        "No double charge; the last-transaction query resolves it",
      ],
      [
        "CT-03 · Concurrent order edits on one table from two terminals",
        "Converges per the CRDT rules; no line lost",
      ],
      [
        "CT-04 · Power loss during a payment write",
        "Order recoverable; no partial state",
      ],
      [
        "CT-05 · Cross-tenant access attempt on every table",
        "All attempts return zero rows",
      ],
      [
        "CT-06 · Client / server conformance corpus",
        "Byte-identical results on every case",
      ],
      [
        "CT-07 · Recipe expansion with 5-level sub-recipes and modifiers",
        "Depletion matches manual calculation exactly",
      ],
      [
        "CT-08 · Stock count during active trading",
        "Variance excludes concurrent sales",
      ],
      [
        "CT-09 · Fiscal submission with authority downtime for 6 hours",
        "All documents submitted on recovery; nothing lost",
      ],
      [
        "CT-10 · Device clock set 3 hours ahead",
        "HLC ordering preserved; skew alerted; original timestamps retained",
      ],
      [
        "CT-11 · Multi-currency consolidated report",
        "Rates displayed; totals reconcile to source",
      ],
      [
        "CT-12 · Money allocation across split bills",
        "Sum of the parts exactly equals the whole, in all cases",
      ],
      [
        "CT-13 · Loyalty double-redemption from two offline terminals",
        "Detected on sync; policy applied; ledger consistent",
      ],
      [
        "CT-14 · Sync backlog of 20,000 operations after an extended outage",
        "Completes; no timeout; no memory exhaustion",
      ],
      [
        "CT-15 · Arabic receipt printing across the printer matrix",
        "Correct joining, correct ordering, no truncation",
      ],
    ],

    pyramidTitle: "Test pyramid",
    pyramid: [
      ["Unit — domain-heavy, no database", "~5,000"],
      ["Component — one module through its contract", "~1,400"],
      ["Contract & integration", "~600"],
      ["End-to-end", "~180"],
      ["Manual exploratory & UAT", "~50"],
    ],
    pyramidNote:
      "Domain-layer coverage is required at ≥ 90%, overall at ≥ 75%, and every functional requirement traces to at least one automated test.",

    volumeTitle: "Data volume, one mature tenant",
    volumeLede:
      "Thirty branches, 400 orders per branch per day, 3.2 lines per order. Stock movements dominate because a three-line order with recipes averaging six ingredients produces eighteen movements — which is exactly what makes traceability and variance possible.",
    volumeCols: ["Rows / day", "Rows / year", "Size / year"],
    volumeFirstCol: "Table",
    volume: [
      ["orders", "12,000", "4.4 M", "3.2 GB"],
      ["order_lines", "38,400", "14.0 M", "6.1 GB"],
      ["order_line_modifiers", "26,000", "9.5 M", "2.4 GB"],
      ["order_payments", "13,200", "4.8 M", "1.4 GB"],
      ["stock_movements", "155,000", "56.6 M", "18.5 GB"],
      ["audit_entries", "92,000", "33.6 M", "24.0 GB"],
      ["fact_sales_line", "38,400", "14.0 M", "4.0 GB"],
      ["Total", "—", "—", "~60 GB"],
    ],
  },

  contact: {
    eyebrow: "Book a demo",
    title: "Bring your worst month",
    lede: "The demo that decides this is not a feature tour. Bring one month of sales, your five best-selling dishes and their recipes, and we will show you your own food cost and variance.",
    name: "Your name",
    business: "Restaurant or group",
    phone: "Phone",
    email: "Email",
    branches: "Branches",
    branchOptions: ["1", "2–10", "11–50", "50+"],
    message: "What are you running today?",
    messagePlaceholder: "Current POS, spreadsheets, notebook — whatever it is.",
    submit: "Request the demo",
    sending: "Sending",
    /* The body always said nothing was sent; the title said the opposite,
       and a title is what people read. */
    successTitle: "Nothing was sent",
    sentTitle: "Request sent",
    sentText:
      "Your details reached us. Someone will be in touch to arrange the demo.",
    sendFailed:
      "That did not send. Check your connection and try again, or call us instead.",
    successText:
      "This site is a frontend prototype, so nothing was actually sent. Wire this form to your CRM or an email service to make it live.",
    reset: "Send another",
    required: "Fill in your name and a phone or email so we can reach you.",
    sidebarTitle: "What happens next",
    steps: [
      "A 30-minute call to understand the operation and the current stack.",
      "A demo on your menu and your recipes, not a sample restaurant.",
      "A pilot branch configured with you, live within a week.",
    ],
  },

  cta: {
    title: "Your food cost is a number you can know on Tuesday",
    text: "Don't wait for month-end to find out where your profit went. The system tracks food cost while you trade, so you catch any shift early and decide before it turns into a loss.",
    button: "Book a demo",
    secondary: "See pricing",
  },

  footer: {
    tagline: "Restaurant Operating System",
    built: "One connected system that ties the details of the operation together and keeps working offline, without depending on a central database — so operations stay stable, data stays available, and decisions stay clearer at all times.",
    indexTitle: "Every page",
    countsTitle: "What the baseline contains",
    top: "Back to top",
    docNote: "ROS-SRS-001 · 212 functional and 148 non-functional requirements",
    rights: "All rights reserved.",
  },

  specNote: "Traced to",
};

export type Copy = typeof en;
