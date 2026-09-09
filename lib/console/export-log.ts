"use client";

/**
 * The export trail — FR-RPT-044.
 *
 * "All exports SHALL be logged in the audit trail with the requesting user,
 * filters applied, and row count." An export is a copy of tenant data
 * leaving the system, so the record of one is part of the feature, not an
 * afterthought — and a governance screen with nothing in it is indis-
 * tinguishable from one that is not wired up.
 *
 * Queued jobs (FR-RPT-043, past 50,000 rows) live in the same list with a
 * `queued` state, so the user has one place to see both "what did I take out
 * of here" and "where is the big one I asked for".
 */

import { useCallback, useEffect, useState } from "react";

import { localId, nowIso } from "./local-store";
import type { ExportFormat } from "./export";

export interface ExportRecord {
  id: string;
  title: string;
  format: ExportFormat;
  rowCount: number;
  filters: string | null;
  requestedBy: string | null;
  occurredAt: string;
  status: "completed" | "queued" | "ready";
}

const KEY = "ros.console.exportLog";
const LIMIT = 200;

type Listener = (rows: ExportRecord[]) => void;
const listeners = new Set<Listener>();

function read(): ExportRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExportRecord[]) : [];
  } catch {
    return [];
  }
}

function write(rows: ExportRecord[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, LIMIT)));
  } catch {
    // Storage unavailable; the in-session listeners still get the update.
  }
  for (const listener of listeners) listener(rows);
}

export interface ExportLogEntryInput {
  title: string;
  format: ExportFormat;
  rowCount: number;
  filters: string | null;
  requestedBy: string | null;
}

function append(input: ExportLogEntryInput, status: ExportRecord["status"]): ExportRecord {
  const record: ExportRecord = {
    id: localId("exp"),
    ...input,
    occurredAt: nowIso(),
    status,
  };
  write([record, ...read()]);
  return record;
}

/**
 * Read and write the export trail.
 *
 * A queued job flips to `ready` on a timer here because the frontend owns
 * the whole state machine: the point is that the *UI* for a long export —
 * queued, then a notification, then a download — exists and is reachable,
 * not that a background worker really ran.
 */
export function useExportLog() {
  const [rows, setRows] = useState<ExportRecord[]>([]);

  useEffect(() => {
    setRows(read());
    const listener: Listener = (next) => setRows(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const record = useCallback((input: ExportLogEntryInput) => append(input, "completed"), []);

  const queue = useCallback((input: ExportLogEntryInput) => {
    const job = append(input, "queued");
    window.setTimeout(() => {
      const current = read();
      const index = current.findIndex((row) => row.id === job.id);
      if (index === -1) return;
      current[index] = { ...current[index]!, status: "ready" };
      write(current);
    }, 6000);
    return job;
  }, []);

  const clear = useCallback(() => write([]), []);

  return { rows, record, queue, clear };
}
