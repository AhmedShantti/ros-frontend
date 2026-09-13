"use client";

/**
 * Alert rules, report schedules and the morning brief — SRS §19.5.
 *
 * None of this has an endpoint in `api/openapi.json`: the backend neither
 * stores alert rules nor sends email. So the configuration is browser-local
 * behind this interface (the same seam as `./crm`), and the screen is honest
 * that delivery itself — the email leaving, the push landing — is the
 * server's job. What the frontend owns completely is the configuration, the
 * validation and the delivery policy, which is where FR-RPT-046 actually
 * lives.
 */

import {
  ALERT_TRIGGERS,
  DEFAULT_BRIEF,
  defaultRule,
  type AlertRule,
  type MorningBriefConfig,
  type ReportSchedule,
} from "../delivery";
import type { Id } from "../types";
import { localCollection, localDocument, localId, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError, type CollectionService } from "./types";

const tenantOf = () => getActiveTenantId();

const rulesStore = localCollection<AlertRule>(
  {
    name: "alert-rules",
    idOf: (row) => row.id,
    seed: () => ALERT_TRIGGERS.map((trigger) => defaultRule(trigger, localId("alr"), nowIso())),
    filters: { trigger: (row) => row.trigger, enabled: (row) => String(row.enabled) },
    onUpdate: (row, patch) => validateRule({ ...row, ...patch, updatedAt: nowIso() }),
  },
  tenantOf,
);

const schedulesStore = localCollection<ReportSchedule>(
  {
    name: "report-schedules",
    idOf: (row) => row.id,
    search: (row) => [row.name, row.reportId, ...row.recipientEmails],
    filters: { reportId: (row) => row.reportId, active: (row) => String(row.active) },
    sorters: { name: (row) => row.name, createdAt: (row) => row.createdAt },
    factory: (input, id) =>
      validateSchedule({
        id,
        reportId: input.reportId ?? "",
        name: input.name ?? "",
        frequency: input.frequency ?? "daily",
        time: input.time ?? "07:00",
        weekday: input.weekday ?? 0,
        monthDay: input.monthDay ?? 1,
        period: input.period ?? "previous_day",
        format: input.format ?? "pdf",
        channels: input.channels ?? ["email"],
        recipientEmails: input.recipientEmails ?? [],
        recipientRoles: input.recipientRoles ?? [],
        branchIds: input.branchIds ?? [],
        active: input.active ?? true,
        createdAt: nowIso(),
        createdBy: input.createdBy ?? null,
        lastSentAt: null,
      }),
    onUpdate: (row, patch) => validateSchedule({ ...row, ...patch }),
  },
  tenantOf,
);

const briefDoc = localDocument<MorningBriefConfig>("morning-brief", () => DEFAULT_BRIEF, tenantOf);

function validateRule(rule: AlertRule): AlertRule {
  if (rule.channels.length === 0) {
    throw new ServiceError("VALIDATION", "Choose at least one way to deliver this alert.", 400);
  }
  if (rule.recipientRoles.length === 0 && rule.recipientEmails.length === 0) {
    throw new ServiceError("VALIDATION", "An alert with nobody to receive it would never be seen.", 400);
  }
  if (rule.rateLimit.max < 1 || rule.rateLimit.periodMinutes < 1) {
    throw new ServiceError("VALIDATION", "The rate limit needs at least one alert per period.", 400);
  }
  return rule;
}

function validateSchedule(schedule: ReportSchedule): ReportSchedule {
  if (!schedule.reportId) throw new ServiceError("VALIDATION", "Choose a report to deliver.", 400);
  if (!schedule.name.trim()) throw new ServiceError("VALIDATION", "Give the schedule a name.", 400);
  if (schedule.channels.length === 0) {
    throw new ServiceError("VALIDATION", "Choose email, push or both.", 400);
  }
  if (schedule.recipientEmails.length === 0 && schedule.recipientRoles.length === 0) {
    throw new ServiceError("VALIDATION", "Add at least one recipient.", 400);
  }
  if (!/^\d{2}:\d{2}$/.test(schedule.time)) {
    throw new ServiceError("VALIDATION", "Delivery time must be HH:MM.", 400);
  }
  return schedule;
}

export interface DeliveryService {
  rules: Pick<CollectionService<AlertRule>, "list" | "get" | "update"> & {
    all(): Promise<AlertRule[]>;
    /** Put one rule back to the SRS default for its trigger. */
    restoreDefault(id: Id): Promise<AlertRule>;
  };
  schedules: CollectionService<ReportSchedule> & {
    /** Record that a delivery went out (or was sent by hand). */
    markSent(id: Id): Promise<ReportSchedule>;
  };
  brief: {
    read(): Promise<MorningBriefConfig>;
    save(next: MorningBriefConfig): Promise<MorningBriefConfig>;
  };
}

export const deliveryService: DeliveryService = {
  rules: {
    list: rulesStore.list,
    get: rulesStore.get,
    update: rulesStore.update,
    all: rulesStore.all,
    async restoreDefault(id) {
      const row = await rulesStore.get(id);
      if (!row) throw new ServiceError("NOT_FOUND", "That rule no longer exists.", 404);
      const trigger = ALERT_TRIGGERS.find((entry) => entry.trigger === row.trigger)!;
      const fresh = defaultRule(trigger, row.id, nowIso());
      return rulesStore.update(id, fresh);
    },
  },

  schedules: {
    ...schedulesStore,
    async markSent(id) {
      return schedulesStore.update(id, { lastSentAt: nowIso() });
    },
  },

  brief: {
    async read() {
      return { ...DEFAULT_BRIEF, ...briefDoc.read() };
    },
    async save(next) {
      if (next.enabled && next.recipientRoles.length === 0 && next.recipientEmails.length === 0) {
        throw new ServiceError("VALIDATION", "The brief needs at least one recipient.", 400);
      }
      if (next.enabled && next.sections.length === 0) {
        throw new ServiceError("VALIDATION", "Pick at least one thing for the brief to say.", 400);
      }
      const saved = { ...next, updatedAt: nowIso() };
      briefDoc.write(saved);
      return saved;
    },
  },
};
