"use client";

/**
 * Equipment fault reports — the operational factor FR-CST-024 correlates
 * waste against. The backend has no maintenance or fault resource, so the
 * log is browser-local behind the ordinary collection interface; nothing
 * above it knows where the rows live.
 */

import type { Id, IsoDate, IsoDateTime } from "../types";
import { localCollection, nowIso } from "../local-store";
import { getActiveTenantId } from "./tenant-context";
import { ServiceError } from "./types";

export interface EquipmentFault {
  id: Id;
  branchId: Id | null;
  equipment: string;
  reportedOn: IsoDate;
  note: string;
  reportedBy: string | null;
  createdAt: IsoDateTime;
}

const store = localCollection<EquipmentFault>(
  {
    name: "costing-equipment-faults",
    idOf: (row) => row.id,
    branchOf: (row) => row.branchId,
    search: (row) => [row.equipment, row.note],
    sorters: { reportedOn: (row) => row.reportedOn },
    factory: (input, id) => ({
      id,
      branchId: input.branchId ?? null,
      equipment: (input.equipment ?? "").trim(),
      reportedOn: input.reportedOn ?? nowIso().slice(0, 10),
      note: (input.note ?? "").trim(),
      reportedBy: input.reportedBy ?? null,
      createdAt: nowIso(),
    }),
  },
  () => getActiveTenantId(),
);

export interface EquipmentFaultService {
  all(): Promise<EquipmentFault[]>;
  record(input: Omit<EquipmentFault, "id" | "createdAt">): Promise<EquipmentFault>;
  remove(id: Id): Promise<void>;
}

export const equipmentFaultService: EquipmentFaultService = {
  all: () => store.all(),
  async record(input) {
    if (!input.equipment.trim()) throw new ServiceError("VALIDATION", "Name the equipment that failed.", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportedOn)) throw new ServiceError("VALIDATION", "Choose the date of the fault.", 400);
    return store.create(input);
  },
  remove: (id) => store.remove(id),
};
