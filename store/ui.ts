"use client";

/**
 * Ephemeral interface state — what is open, what is collapsed, what is
 * selected. None of it is data, none of it survives a sign-out, and none of
 * it belongs in the URL.
 *
 * Kept out of React context on purpose: the sidebar collapsing should not
 * re-render every table row underneath it, and a Zustand selector gives each
 * consumer exactly the slice it reads.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type MobilePanel = "none" | "nav" | "filters";

interface UiState {
  /** Desktop rail collapsed to icons. Persisted — it is a working preference. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /** Which overlay the small-screen layout is showing. Never persisted. */
  mobilePanel: MobilePanel;
  openMobilePanel: (panel: MobilePanel) => void;
  closeMobilePanel: () => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;

  notificationsOpen: boolean;
  setNotificationsOpen: (open: boolean) => void;

  approvalsOpen: boolean;
  setApprovalsOpen: (open: boolean) => void;

  /** Section ids the user has collapsed in the sidebar. */
  collapsedSections: string[];
  toggleSection: (id: string) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      mobilePanel: "none",
      openMobilePanel: (mobilePanel) => set({ mobilePanel }),
      closeMobilePanel: () => set({ mobilePanel: "none" }),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleCommandPalette: () =>
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

      notificationsOpen: false,
      setNotificationsOpen: (notificationsOpen) =>
        set({ notificationsOpen, approvalsOpen: false }),

      approvalsOpen: false,
      setApprovalsOpen: (approvalsOpen) =>
        set({ approvalsOpen, notificationsOpen: false }),

      collapsedSections: [],
      toggleSection: (id) =>
        set((s) => ({
          collapsedSections: s.collapsedSections.includes(id)
            ? s.collapsedSections.filter((x) => x !== id)
            : [...s.collapsedSections, id],
        })),
    }),
    {
      name: "ros.ui",
      storage: createJSONStorage(() => localStorage),
      // Only the two genuine preferences are written back. Persisting an open
      // dialog means it reopens on the next visit with no context behind it.
      partialize: (s) => ({
        sidebarCollapsed: s.sidebarCollapsed,
        collapsedSections: s.collapsedSections,
      }),
      version: 1,
    },
  ),
);
