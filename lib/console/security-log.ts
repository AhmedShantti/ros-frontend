"use client";

/**
 * The signed-in person as a security-event actor, and a recorder bound to
 * them — so no screen writes an event with a made-up or missing actor.
 */

import { useCallback, useMemo } from "react";

import { services } from "./services";
import { useSession } from "./providers";
import type { SecurityEvent, SecurityEventInput } from "./services/security-events";
import type { Actor } from "./services/security-settings";

export function useActor(): Actor {
  const { session } = useSession();
  return useMemo<Actor>(
    () => ({
      actorId: session?.user.id ?? null,
      actorName: session ? `${session.user.name.en} <${session.user.email}>` : "unknown",
    }),
    [session],
  );
}

/**
 * Record a security event as the current user. Never throws: a log write
 * that fails must not take the action it describes down with it — but the
 * promise resolves to null so a caller that must be certain can check.
 */
export function useSecurityLog(): (input: Omit<SecurityEventInput, "actorId" | "actorName">) => Promise<SecurityEvent | null> {
  const actor = useActor();
  return useCallback(
    (input) => services.securityEvents.record({ ...input, ...actor }).catch(() => null),
    [actor],
  );
}
