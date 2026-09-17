"use client";

/**
 * Kitchen display sound — FR-KDS-028 / FR-KDS-029 alerts, and the audible
 * half of the P1 alerting backlog.
 *
 * Tones are synthesised with Web Audio rather than played from files: a
 * kitchen screen may be offline, and five oscillator envelopes weigh nothing.
 * Each event has its own contour so a cook can tell them apart without
 * looking — a rising chime for a new ticket, three quick taps for an
 * amendment, a falling buzz for a cancellation.
 *
 * Browsers refuse to start audio until the page has had a user gesture. So
 * the context is created on the "Turn sound on" press, and until then the
 * control says plainly that the screen is silent — a KDS that is quietly not
 * beeping is worse than one that tells you.
 *
 * Mute and volume are per device (this screen, on this wall), not per
 * branch, so they live in this browser's storage.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "@/lib/console/providers";
import { cx } from "@/components/console/ui";

export type KdsSound = "new" | "amendment" | "cancel" | "overdue" | "capacity";

interface SoundPrefs {
  muted: boolean;
  /** 0–1 */
  volume: number;
}

const PREFS_KEY = "ros.kds.sound";
const DEFAULT_PREFS: SoundPrefs = { muted: false, volume: 0.7 };

function readPrefs(): SoundPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>;
    return {
      muted: parsed.muted === true,
      volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULT_PREFS.volume,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(prefs: SoundPrefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Blocked storage: the setting holds for this session only.
  }
}

/** [frequency Hz, start s, duration s] per note. */
const CONTOURS: Record<KdsSound, [number, number, number][]> = {
  new: [
    [660, 0, 0.14],
    [880, 0.16, 0.22],
  ],
  amendment: [
    [988, 0, 0.09],
    [988, 0.13, 0.09],
    [988, 0.26, 0.12],
  ],
  cancel: [
    [440, 0, 0.18],
    [330, 0.2, 0.18],
    [220, 0.4, 0.32],
  ],
  overdue: [
    [392, 0, 0.25],
    [392, 0.35, 0.25],
  ],
  capacity: [[523, 0, 0.6]],
};

type AudioCtor = typeof AudioContext;

export interface KdsSoundApi {
  /** False until a gesture has created the audio context. */
  unlocked: boolean;
  /** Whether this browser can play synthesised sound at all. */
  supported: boolean;
  muted: boolean;
  volume: number;
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  play: (sound: KdsSound) => void;
}

export function useKdsSound(): KdsSoundApi {
  const context = useRef<AudioContext | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [supported, setSupported] = useState(true);
  const [prefs, setPrefs] = useState<SoundPrefs>(DEFAULT_PREFS);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Two alerts of the same kind inside a second are one alert. */
  const lastPlayed = useRef<Partial<Record<KdsSound, number>>>({});

  useEffect(() => {
    setPrefs(readPrefs());
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as
      | AudioCtor
      | undefined;
    setSupported(Boolean(Ctor));
    return () => {
      void context.current?.close().catch(() => undefined);
      context.current = null;
    };
  }, []);

  const unlock = useCallback(() => {
    const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as
      | AudioCtor
      | undefined;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    if (!context.current) context.current = new Ctor();
    void context.current.resume().then(
      () => setUnlocked(context.current?.state === "running"),
      () => setUnlocked(false),
    );
  }, []);

  const play = useCallback((sound: KdsSound) => {
    const ctx = context.current;
    const { muted, volume } = prefsRef.current;
    if (!ctx || ctx.state !== "running" || muted || volume <= 0) return;
    const nowMs = Date.now();
    if ((lastPlayed.current[sound] ?? 0) > nowMs - 1000) return;
    lastPlayed.current[sound] = nowMs;

    const start = ctx.currentTime + 0.02;
    for (const [frequency, offset, duration] of CONTOURS[sound]) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = sound === "cancel" ? "sawtooth" : "sine";
      oscillator.frequency.value = frequency;
      const t0 = start + offset;
      // A short attack and exponential release: audible over a fryer, no click.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.5), t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(t0);
      oscillator.stop(t0 + duration + 0.05);
    }
  }, []);

  const update = useCallback((patch: Partial<SoundPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writePrefs(next);
      return next;
    });
  }, []);

  return {
    unlocked,
    supported,
    muted: prefs.muted,
    volume: prefs.volume,
    unlock,
    setMuted: (muted) => update({ muted }),
    setVolume: (volume) => update({ volume: Math.min(1, Math.max(0, volume)) }),
    play,
  };
}

/** Enable / mute / volume / test — sized for a gloved finger. */
export function KdsSoundControl({ sound }: { sound: KdsSoundApi }) {
  const { t } = useI18n();

  if (!sound.supported) {
    return <span className="text-fg-subtle text-xs">{t("kdsView.soundUnsupported")}</span>;
  }

  if (!sound.unlocked) {
    return (
      <button
        type="button"
        onClick={sound.unlock}
        className="border-warn bg-warn-soft text-warn inline-flex min-h-12 items-center gap-2 rounded-lg border px-3 text-sm font-semibold"
      >
        <VolumeX size={18} aria-hidden />
        {t("kdsView.soundEnable")}
      </button>
    );
  }

  const Icon = sound.muted || sound.volume === 0 ? VolumeX : sound.volume < 0.5 ? Volume1 : Volume2;

  return (
    <div className="border-line bg-raised inline-flex min-h-12 items-center gap-2 rounded-lg border px-2">
      <button
        type="button"
        onClick={() => sound.setMuted(!sound.muted)}
        aria-pressed={sound.muted}
        aria-label={sound.muted ? t("kdsView.soundUnmute") : t("kdsView.soundMute")}
        title={sound.muted ? t("kdsView.soundUnmute") : t("kdsView.soundMute")}
        className={cx(
          "grid h-12 w-12 place-items-center rounded-lg",
          sound.muted ? "text-bad" : "text-fg hover:bg-sunken",
        )}
      >
        <Icon size={20} aria-hidden />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(sound.volume * 100)}
        onChange={(event) => sound.setVolume(Number(event.target.value) / 100)}
        aria-label={t("kdsView.soundVolume")}
        className="accent-accent h-12 w-28"
        disabled={sound.muted}
      />
      <button
        type="button"
        onClick={() => sound.play("new")}
        className="text-fg-muted hover:text-fg hover:bg-sunken min-h-12 rounded-lg px-2 text-xs font-medium"
      >
        {t("kdsView.soundTest")}
      </button>
    </div>
  );
}
