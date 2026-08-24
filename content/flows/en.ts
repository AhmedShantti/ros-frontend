/**
 * The use cases, as the specification writes them: actor, preconditions,
 * trigger, main flow, alternate flows, postconditions.
 *
 * These are the parts of the document that describe the system working
 * rather than the system existing, so they are quoted at step level
 * rather than summarised — a summarised use case is a brochure.
 */
export const flowsEn = {
  flows: {
    eyebrow: "Use cases",
    title: "Every step in running your restaurant is worked out in advance",
    lede: "Six flows that mirror the operation as it actually happens, from the moment an order is taken through to its effect on the kitchen, inventory, cost and reporting.",
    pageLede:
      "Every hand-off between modules is designed and connected in advance, so operations stay clear, data stays consistent, and trading keeps moving even in the most complicated scenarios.",

    labels: {
      actor: "Actor",
      pre: "Preconditions",
      trigger: "Trigger",
      main: "Main flow",
      alt: "Alternate flows",
      post: "Postconditions",
      outcomes: "Alternate outcomes",
      notInBuild: "Specified, not in this build",
      notInBuildNote:
        "This flow is written out in the specification and is not implemented in this prototype. The steps below describe what the system is designed to do, not something you can click through today.",
    },

    outageTitle: "And the seventh, on the platform page",
    outageText:
      "UC-OFF-01 — six hours with no internet during peak trading, 412 orders taken, then a prioritised sync that loses nothing and duplicates nothing.",
    outageCta: "Read the outage timeline",

    items: [
      {
        id: "uc-pos-01",
        code: "UC-POS-01",
        notInBuild: false,
        name: "Process a dine-in order",
        chapter: "SRS §8.10",
        actor: "Cashier",
        pre: "Shift is open; the terminal is authenticated; the menu is loaded.",
        trigger: "The customer is seated; the flow runs through to the order being paid in full.",
        steps: [
          "The cashier selects a table from the floor plan, and the system opens a new order with a sequential number tied to that table.",
          "The cashier selects the guest count, and the system records it against the order.",
          "The cashier adds the items, and for each item the system presents its required modifier groups, enforcing the minimum and maximum selection.",
          "The system computes price per FR-POS-040 and clearly displays line tax, the branch country's tax, and the running total.",
          "The cashier settles the order in full or in part, according to the tender selected.",
          "The cashier fires the order to the kitchen; the system creates a KDS ticket per item under FR-KDS-010 and routes each ticket straight to the prep station set in recipe.station.",
          "When the kitchen finishes, the system receives ticket.bumped and updates the line states to ready.",
          "The waiter fires the subsequent courses of the order.",
          "The customer requests the bill, and the waiter prints a pre-bill, which is not a fiscal document.",
          "The waiter or cashier starts the payment, and the system presents the available tenders for selection.",
          "The payment is captured, and the system validates that the amount paid is not less than the total due.",
          "Once settlement completes, the order moves to COMPLETED and the system publishes order.completed.",
          "The operating effects start automatically: inventory is depleted by recipe, COGS is recognised, entries post to the cash journal, the tax document is generated, loyalty points are accrued, and the audit entry is written.",
          "The system prints the fiscal receipt and queues fiscal submission through the outbox where required.",
          "The table is released automatically in the system once its state is ready for it.",
        ],
        alts: [
          "3a — The item is unavailable. It shows as disabled with the reason, and cannot be added to the order until it is available again.",
          "6a — No connectivity. Every step continues locally without interrupting trading, and outbound events queue in the local outbox.",
          "11a — Insufficient balance on the card. The system displays the remaining amount and allows it to be completed with another tender.",
          "11b — Partial payment. The order stays partially open and the system displays the remaining balance precisely.",
          "13a — An ingredient's stock is insufficient. The system proceeds according to the configured inventory policy: either allow the negative balance and raise an alert, or block the sale, per the inventory settings.",
        ],
        note: "Blocking a sale is not an arbitrary decision; it is direct protection of the restaurant's profitability. When stock falls below the permitted threshold, the system blocks the item from being sold — avoiding selling what cannot be prepared, and protecting the customer experience.",
        post: "The order is closed in full and becomes immutable, inventory reflects actual consumption, the cash session balance is updated, a complete audit trail is retained, and the tax document is generated.",
      },

      {
        id: "uc-kds-01",
        code: "UC-KDS-01",
        notInBuild: false,
        name: "Prepare and complete a multi-station order",
        chapter: "SRS §9.6",
        actor: "Kitchen staff (grill, fryer) · Expediter",
        pre: "Stations are configured; the KDS terminals are authenticated.",
        trigger: "order.line.fired is received.",
        steps: [
          "The system evaluates routing rules per line. Burger to grill, fries to fryer, both to packaging, and the ticket summary to the expediter.",
          "If staggered release is enabled, the system computes release times and holds the shorter-prep items back.",
          "The grill display shows the burger line with its elapsed timer starting.",
          "Grill staff long-press to mark started, where that is configured, then long-press again to bump when done.",
          "The system records ready_at for that line and publishes ticket.bumped.",
          "The fryer completes the same way.",
          "The expediter display shows the order as fully prepared once every station line is bumped, and highlights it for assembly.",
          "The expediter bumps the order. All order lines move to served, order time is computed, and the POS is notified.",
          "The POS floor plan updates the table state to food served.",
        ],
        alts: [
          "3a — Elapsed time exceeds target. The card turns amber, then red, and a delayed-order alert reaches the manager's dashboard after a configurable threshold.",
          "4a — Wrong bump. Staff use recall to restore the ticket within the retention window, 30 minutes by default.",
          "5a — Network outage between the KDS and the server. The bump is stored locally and published on reconnection with its original timestamp preserved.",
          "6a — The line is voided at the POS after firing. It is struck through on the station display with an audible alert, and the POS prompts for waste disposition.",
        ],
        note: "Kitchen screens get touched by accident constantly — an elbow, a sleeve, a splash of water. Single-tap bumping causes tickets to vanish and food not to be made, which is why the bump requires a deliberate interaction.",
        post: "Every line is served, the order time is recorded, and the timing data feeds preparation-time reporting by item, station, hour and employee.",
      },

      {
        id: "uc-inv-01",
        code: "UC-INV-01",
        notInBuild: false,
        name: "Perform a weekly stock count",
        chapter: "SRS §11.10",
        actor: "Storekeeper · Branch Manager",
        pre: "Items are configured with storage locations; the user holds inventory.count.",
        trigger: "The weekly count falls due, or a variance investigation calls for one.",
        steps: [
          "The manager creates a count session, choosing the scope — say the walk-in chiller — and the mode, blind by default.",
          "The system snapshots the expected quantities and timestamps the session open.",
          "The system generates a count sheet ordered by storage position and pushes it to the mobile app.",
          "The storekeeper counts, scanning each item's barcode and entering the quantity in any configured unit. The system converts to base units.",
          "The storekeeper submits. The session state becomes submitted.",
          "The system applies any movements that occurred between snapshot and submission, computes adjusted expected quantities, and calculates variance per item in quantity and in value.",
          "Items exceeding the variance threshold are flagged and presented to the manager.",
          "The manager either triggers a recount for the flagged items or records an explanation.",
          "The manager posts the count. The system creates count_adjustment movements, publishes stock.counted, and writes audit entries.",
          "The costing module recomputes variance analysis and updates the theoretical-versus-actual report.",
        ],
        alts: [
          "4a — The device is offline. The count is stored locally and synced on reconnection; the session snapshot remains authoritative.",
          "4b — An item not on the sheet is found. The storekeeper adds it ad hoc and the system includes it in the session.",
          "7a — Variance exceeds the block threshold. Posting is prevented until a recount, or approval by a user holding inventory.approve_high_variance.",
          "9a — Two counts for the same scope are submitted concurrently. The system rejects the second with a conflict error; sessions for overlapping scope are mutually exclusive.",
        ],
        note: "A count that takes 90 minutes while the restaurant is trading would otherwise show a variance equal to everything sold during the count. Reconciling against the snapshot at session open, then applying subsequent movements, is what stops the result from being noise.",
        post: "Recorded stock equals counted stock, every adjustment carries a reason and an approver, and the count session retains its full history including recounts.",
      },

      {
        id: "uc-prc-01",
        code: "UC-PRC-01",
        notInBuild: true,
        name: "Weekly order to delivery",
        chapter: "SRS §12.7",
        actor: "Branch Manager · Purchasing Officer · Storekeeper",
        pre: "Reorder points and supplier price lists are configured.",
        trigger: "The scheduled overnight reorder analysis runs.",
        steps: [
          "The system runs the reorder analysis overnight and generates suggested orders grouped by supplier.",
          "The branch manager reviews the suggestions, adjusts quantities, and submits them as a requisition.",
          "The purchasing officer consolidates requisitions across branches for the same supplier.",
          "The system creates a purchase order and routes it through the approval chain for its value band.",
          "The approver approves from mobile. The PO moves to approved and transmission is enqueued through the outbox.",
          "The supplier receives the PO by email, with a PDF and a structured attachment.",
          "Goods arrive. The storekeeper opens the PO on a mobile device, scans items, enters received quantities, batch numbers and expiry dates, and records the chiller temperature.",
          "Two items arrive short and one is rejected for damage. The storekeeper records both.",
          "The storekeeper posts the receipt. The system creates stock movements and batches, publishes stock.received, and updates weighted-average costs.",
          "The costing module recomputes affected recipe costs, cascading through sub-recipes.",
          "The supplier invoice arrives and is recorded. The system performs the three-way match.",
          "One line's price is 6% above the PO price, exceeding the 2% tolerance. The invoice enters disputed.",
          "The purchasing officer contacts the supplier, obtains a credit note, records it, and the invoice matches.",
          "The invoice enters the payment proposal for its due date.",
        ],
        alts: [
          "7a — Delivery arrives with no PO in the system, an emergency purchase. The storekeeper performs a direct receipt, which is flagged in the unauthorised-purchase report.",
          "7b — Chiller temperature is out of range. The system prompts for rejection or acceptance with justification, and records the reading either way.",
          "11a — The invoice references a receipt already fully invoiced. The system rejects it as a probable duplicate and surfaces the original.",
        ],
        note: "Supplier price creep is one of the most common and least detected margin leaks: a 4% rise every second month, checked by nobody, becomes 25% over a year and gets attributed to portion control. Price-variance detection at receipt makes it visible on the day it happens.",
        post: "Stock reflects what physically arrived, recipe costs reflect what was actually paid, and every discrepancy has a document behind it.",
      },

      {
        id: "uc-cst-01",
        code: "UC-CST-01",
        notInBuild: true,
        name: "Investigate a food cost increase",
        chapter: "SRS §13.8",
        actor: "Operations Director",
        pre: "Counts have been posted for the period; recipes are published.",
        trigger:
          "The weekly scorecard shows Branch 3 at 36.2% food cost against a 31% target.",
        steps: [
          "The director opens the branch scorecard and drills into food cost.",
          "The system displays food cost by category, showing proteins at 44% against a 38% target while every other category is within tolerance.",
          "The director drills into proteins and opens the variance report for the period.",
          "The system lists items by variance value: chicken breast shows 18.4 kg of unexplained variance, valued at 2,760 EGP.",
          "The director opens the chicken breast detail. Theoretical usage 142 kg, actual usage 164.2 kg, recorded waste 3.8 kg, unexplained 18.4 kg.",
          "The director views the variance-by-shift breakdown. The variance is concentrated in the evening shift on four of seven days.",
          "The director checks the sales mix and finds no recipe or menu change in the period.",
          "The cause-hypothesis panel indicates variance concentrated in one shift pattern — portion control or unrecorded consumption.",
          "The director opens the audit log filtered to that shift pattern and reviews voids, comps and waste records.",
          "The director schedules a portion-control audit and a targeted count of chicken at shift handover.",
          "Two weeks later the variance falls to 2.1 kg. The trend view records the improvement.",
        ],
        alts: [
          "The investigation reveals the supplier changed to a product with higher trim loss. Resolution: update the recipe's wastage percentage. The variance disappears and the food cost target is revised.",
          "The investigation reveals a goods receipt was never entered. Resolution: enter the receipt. The variance was an artefact of missing data, not of loss.",
        ],
        note: "The variance report is sorted by value, not quantity. Sorting by quantity surfaces flour and salt; sorting by value surfaces the beef, the salmon and the imported cheese. It sounds like a trivial interface decision and it determines whether the report changes behaviour or gets closed after ten seconds.",
        post: "The cause is identified, the corrective action is recorded, and the trend view carries the before and after so the correction can be proved.",
      },
    ],
  },
};

export type Flows = typeof flowsEn;
