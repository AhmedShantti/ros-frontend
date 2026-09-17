"use client";

/**
 * Training mode — NFR-USA-005 (a new cashier productive in ≤ 30 minutes).
 *
 * A new cashier learns on the real till, with the real menu layout and the
 * real buttons, but nothing they do is real: while training is on, the whole
 * terminal runs on a second simulator store under its own storage key. Its
 * sales never enter the sync queue (see `LiveProvider`'s `training` flag),
 * and the till page runs the simulator even on a deployment with a backend,
 * so a practice order cannot reach the server.
 *
 * The flag is per device and read after mount, so the server render and the
 * first client paint agree; switching remounts the store under the other key.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LIVE_STORAGE_KEY } from "@/lib/console/live/state";
import { LiveProvider, TRAINING_STORAGE_KEY } from "@/lib/console/live/store";

const FLAG_KEY = "ros.terminal.training";
const STARTED_KEY = "ros.terminal.training.startedAt";
const FINISHED_KEY = "ros.terminal.training.finishedAt";
const EVENT = "ros:training";

interface TrainingValue {
  training: boolean;
  /** Epoch ms the current practice run started, or null. */
  startedAt: number | null;
  finishedAt: number | null;
  enter: () => void;
  /** Leaves training; practice data is always discarded. */
  leave: () => void;
  /** Wipes practice data and restarts the clock, staying in training. */
  restart: () => void;
  markFinished: () => void;
}

const TrainingContext = createContext<TrainingValue | null>(null);

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: training still works for this tab, it just will not survive a reload.
  }
}

function numberOf(value: string | null): number | null {
  const n = value === null ? NaN : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function TerminalLiveRoot({ children }: { children: ReactNode }) {
  const [training, setTraining] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  // Bumped on restart so the practice store remounts empty.
  const [generation, setGeneration] = useState(0);

  const sync = useCallback(() => {
    setTraining(read(FLAG_KEY) === "1");
    setStartedAt(numberOf(read(STARTED_KEY)));
    setFinishedAt(numberOf(read(FINISHED_KEY)));
  }, []);

  useEffect(() => {
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === FLAG_KEY || event.key === STARTED_KEY || event.key === FINISHED_KEY) sync();
    };
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [sync]);

  const announce = useCallback(() => {
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const enter = useCallback(() => {
    write(TRAINING_STORAGE_KEY, null);
    write(FLAG_KEY, "1");
    write(STARTED_KEY, String(Date.now()));
    write(FINISHED_KEY, null);
    setGeneration((n) => n + 1);
    announce();
  }, [announce]);

  const leave = useCallback(() => {
    write(TRAINING_STORAGE_KEY, null);
    write(FLAG_KEY, null);
    write(STARTED_KEY, null);
    write(FINISHED_KEY, null);
    setGeneration((n) => n + 1);
    announce();
  }, [announce]);

  const restart = useCallback(() => {
    write(TRAINING_STORAGE_KEY, null);
    write(STARTED_KEY, String(Date.now()));
    write(FINISHED_KEY, null);
    setGeneration((n) => n + 1);
    announce();
  }, [announce]);

  const markFinished = useCallback(() => {
    if (read(FINISHED_KEY)) return;
    write(FINISHED_KEY, String(Date.now()));
    announce();
  }, [announce]);

  const value = useMemo<TrainingValue>(
    () => ({ training, startedAt, finishedAt, enter, leave, restart, markFinished }),
    [training, startedAt, finishedAt, enter, leave, restart, markFinished],
  );

  return (
    <TrainingContext.Provider value={value}>
      <LiveProvider
        key={`${training ? "training" : "live"}-${generation}`}
        storageKey={training ? TRAINING_STORAGE_KEY : LIVE_STORAGE_KEY}
        training={training}
      >
        {children}
      </LiveProvider>
    </TrainingContext.Provider>
  );
}

/** Training controls; a harmless no-op outside the terminal root (the console). */
export function useTraining(): TrainingValue {
  return (
    useContext(TrainingContext) ?? {
      training: false,
      startedAt: null,
      finishedAt: null,
      enter: () => undefined,
      leave: () => undefined,
      restart: () => undefined,
      markFinished: () => undefined,
    }
  );
}
