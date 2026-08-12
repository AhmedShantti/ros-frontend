"use client";

/**
 * The point of sale.
 *
 * Three panes: what you can sell, what is on the bill, and where everyone is
 * sitting. The floor takes over the left pane whenever no order is active,
 * because an idle POS should be showing the room rather than a menu nobody
 * can add to.
 */

import { useState } from "react";
import { LayoutGrid, UtensilsCrossed } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { useLive } from "@/lib/console/live/store";
import { TerminalBar } from "@/components/terminal/chrome";
import { ShiftControls, ShiftGate } from "@/components/terminal/shift";
import { PosFloor } from "@/components/terminal/pos-floor";
import { PosMenu } from "@/components/terminal/pos-menu";
import { PosOrderPane } from "@/components/terminal/pos-order";
import { PaymentSheet } from "@/components/terminal/pos-payment";
import { SegmentedControl, Spinner } from "@/components/console/ui";

export default function PosPage() {
  const { t } = useI18n();
  const { state, activeOrder, ready } = useLive();
  const [pane, setPane] = useState<"menu" | "floor">("floor");
  const [course, setCourse] = useState(1);
  const [paying, setPaying] = useState(false);

  // An order was just picked up or created: the menu is what you want next.
  const effectivePane = activeOrder ? pane : "floor";

  if (!ready) {
    return (
      <>
        <TerminalBar />
        <div className="text-fg-muted flex flex-1 items-center justify-center gap-2 text-sm">
          <Spinner /> {t("term.loading")}
        </div>
      </>
    );
  }

  if (!state.session) {
    return (
      <>
        <TerminalBar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ShiftGate />
        </div>
      </>
    );
  }

  return (
    <>
      <TerminalBar />

      <div className="border-line flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <SegmentedControl
          value={effectivePane}
          onChange={(next) => setPane(next)}
          label={t("pos.menu")}
          options={[
            { value: "floor", label: t("pos.floorPlan") },
            { value: "menu", label: t("pos.menu") },
          ]}
        />
        {activeOrder ? (
          <span className="text-fg-subtle hidden items-center gap-1.5 text-xs sm:inline-flex">
            {effectivePane === "menu" ? (
              <UtensilsCrossed size={13} aria-hidden />
            ) : (
              <LayoutGrid size={13} aria-hidden />
            )}
            {activeOrder.orderNumber}
          </span>
        ) : null}
        <div className="flex-1" />
        <ShiftControls />
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {effectivePane === "menu" && activeOrder ? (
          <PosMenu orderId={activeOrder.id} course={course} />
        ) : (
          <PosFloor />
        )}

        <PosOrderPane
          order={activeOrder}
          course={course}
          onCourseChange={setCourse}
          onPay={() => setPaying(true)}
        />
      </div>

      {paying && activeOrder ? (
        <PaymentSheet order={activeOrder} onClose={() => setPaying(false)} />
      ) : null}
    </>
  );
}
