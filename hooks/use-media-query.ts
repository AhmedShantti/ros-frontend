"use client";

import { useEffect, useState } from "react";

/**
 * Matches a media query, defaulting to `false` on the server so the first
 * client render agrees with the server-rendered markup. A component that
 * needs a different layout on mobile must therefore render the desktop
 * layout for one frame; that is the cheaper trade against a hydration error.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `md` breakpoint. Below it the sidebar becomes a drawer. */
export const useIsMobile = () => !useMediaQuery("(min-width: 768px)");

/** Tailwind's `lg`. Filters collapse into a bottom sheet below it. */
export const useIsTablet = () => !useMediaQuery("(min-width: 1024px)");

/**
 * WCAG 2.1 AA §2.3.3. Every transition in the app is gated on this, and the
 * charts drop their entry animation rather than shortening it.
 */
export const usePrefersReducedMotion = () =>
  useMediaQuery("(prefers-reduced-motion: reduce)");
