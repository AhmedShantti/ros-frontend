"use client";

/**
 * Which kitchen events deserve a sound and a flash.
 *
 * The display re-renders every second, so "something happened" has to be
 * worked out by comparing what is on screen now with what was on screen a
 * moment ago. The first pass only records: a screen that has just been
 * switched on must not chime for every ticket already waiting.
 */

import { useEffect, useRef, useState } from "react";
import type { Id, KitchenTicket } from "@/lib/console/types";
import type { KdsAlertSetup } from "@/lib/console/live/kds";
import { urgencyFor } from "@/lib/console/live/engine";
import type { KdsSound } from "@/components/terminal/kds-audio";

interface Seen {
  voided: number;
  cancelled: boolean;
  critical: boolean;
}

const FLASH_MS = 8_000;

export function useKdsAlerts({
  tickets,
  nowMs,
  alerts,
  overCapacity,
  play,
}: {
  tickets: KitchenTicket[];
  nowMs: number;
  alerts: KdsAlertSetup;
  overCapacity: boolean;
  play: (sound: KdsSound) => void;
}): Set<Id> {
  const seen = useRef<Map<Id, Seen> | null>(null);
  const wasOver = useRef(false);
  const [flash, setFlash] = useState<Map<Id, number>>(new Map());

  useEffect(() => {
    if (!nowMs) return;
    const first = seen.current === null;
    const previous = seen.current ?? new Map<Id, Seen>();
    const next = new Map<Id, Seen>();
    const sounds = new Set<KdsSound>();
    const lit: Id[] = [];

    for (const ticket of tickets) {
      const elapsed = ticket.held ? 0 : Math.max(0, Math.floor((nowMs - Date.parse(ticket.firedAt)) / 1000));
      const record: Seen = {
        voided: ticket.lines.filter((line) => line.state === "voided").length,
        cancelled: ticket.state === "cancelled",
        critical: urgencyFor(elapsed, ticket.targetSeconds) === "critical",
      };
      next.set(ticket.id, record);
      if (first) continue;

      const before = previous.get(ticket.id);
      if (!before) {
        // FR-KDS-028 — an amendment alerts differently, and lights the card it updates.
        if (ticket.amendment) {
          if (alerts.amendment) sounds.add("amendment");
          lit.push(ticket.id);
          if (ticket.amendsTicketId) lit.push(ticket.amendsTicketId);
        } else if (record.cancelled) {
          if (alerts.cancellation) sounds.add("cancel");
          lit.push(ticket.id);
        } else {
          if (alerts.newTicket) sounds.add("new");
          lit.push(ticket.id);
        }
        continue;
      }
      // FR-KDS-029 — a line struck off, or the whole order cancelled, mid-cook.
      if (record.voided > before.voided || (record.cancelled && !before.cancelled)) {
        if (alerts.cancellation) sounds.add("cancel");
        lit.push(ticket.id);
      }
      if (record.critical && !before.critical && alerts.overdue) sounds.add("overdue");
    }

    // FR-KDS-045 — crossing into over-capacity, not every second spent there.
    if (!first && overCapacity && !wasOver.current && alerts.capacity) sounds.add("capacity");
    wasOver.current = overCapacity;
    seen.current = next;

    // Most urgent first; `play` itself swallows repeats inside a second.
    for (const sound of ["cancel", "amendment", "overdue", "capacity", "new"] as KdsSound[]) {
      if (sounds.has(sound)) {
        play(sound);
        break;
      }
    }

    if (lit.length > 0 || flash.size > 0) {
      setFlash((current) => {
        const updated = new Map([...current].filter(([, until]) => until > nowMs));
        for (const id of lit) updated.set(id, nowMs + FLASH_MS);
        if (updated.size === current.size && [...updated].every(([id, until]) => current.get(id) === until)) {
          return current;
        }
        return updated;
      });
    }
    // `flash` is read only to decide whether pruning is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, nowMs, alerts, overCapacity, play]);

  return new Set([...flash].filter(([, until]) => until > nowMs).map(([id]) => id));
}
