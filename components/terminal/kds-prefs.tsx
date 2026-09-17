"use client";

/**
 * What one kitchen screen remembers about itself.
 *
 * The branch decides defaults in the console (`services.kdsSetup`); a screen
 * on a particular wall may still want pictures on (FR-KDS-031) or its own
 * sort for the all-stations view (FR-KDS-023). Those are device choices, so
 * they stay in this browser and survive a power cycle.
 */

import { useCallback, useEffect, useState } from "react";
import type { KdsSortMode } from "@/lib/console/live/kds";

const KEY = "ros.kds.device";

interface DevicePrefs {
  /** Null follows the branch default. */
  iconMode: boolean | null;
  allSort: KdsSortMode;
}

const DEFAULTS: DevicePrefs = { iconMode: null, allSort: "fifo" };

function read(): DevicePrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<DevicePrefs>;
    return {
      iconMode: typeof parsed.iconMode === "boolean" ? parsed.iconMode : null,
      allSort: ["fifo", "target", "priority", "course"].includes(parsed.allSort as string)
        ? (parsed.allSort as KdsSortMode)
        : "fifo",
    };
  } catch {
    return DEFAULTS;
  }
}

export function useKdsDevicePrefs() {
  const [prefs, setPrefs] = useState<DevicePrefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(read());
  }, []);

  const update = useCallback((patch: Partial<DevicePrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Blocked storage — the choice holds until the page reloads.
      }
      return next;
    });
  }, []);

  return {
    iconMode: prefs.iconMode,
    allSort: prefs.allSort,
    setIconMode: (iconMode: boolean) => update({ iconMode }),
    setAllSort: (allSort: KdsSortMode) => update({ allSort }),
  };
}
