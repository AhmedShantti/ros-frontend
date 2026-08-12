"use client";

/**
 * The setup wizard's draft.
 *
 * Persisted deliberately and aggressively: someone configuring a restaurant
 * is reading a tax certificate off a piece of paper and will close the tab.
 * "Save and continue later" is not a feature here, it is the default, and the
 * explicit button only exists so the user knows it happened.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  ONBOARDING_STEPS,
  OPTIONAL_STEPS,
  type OnboardingDraft,
  type OnboardingStepId,
} from "@/schemas/onboarding";

export type StepStatus = "complete" | "current" | "upcoming" | "skipped";

interface OnboardingStore {
  draft: OnboardingDraft;
  completed: OnboardingStepId[];
  skipped: OnboardingStepId[];
  stepIndex: number;
  hydrated: boolean;
  /** Set once the sample order has run; the wizard shows the checklist after. */
  finished: boolean;

  setStep: (index: number) => void;
  goTo: (step: OnboardingStepId) => void;
  next: () => void;
  back: () => void;
  /** Merges a step's validated values and marks it complete. */
  commit: <K extends keyof OnboardingDraft>(step: K, values: OnboardingDraft[K]) => void;
  skip: (step: OnboardingStepId) => void;
  finish: () => void;
  reset: () => void;
  markHydrated: () => void;
}

const initial: OnboardingDraft = {};

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      draft: initial,
      completed: [],
      skipped: [],
      stepIndex: 0,
      hydrated: false,
      finished: false,

      setStep: (stepIndex) =>
        set({ stepIndex: Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, stepIndex)) }),

      goTo: (step) => {
        const index = ONBOARDING_STEPS.indexOf(step);
        if (index >= 0) set({ stepIndex: index });
      },

      next: () => get().setStep(get().stepIndex + 1),
      back: () => get().setStep(get().stepIndex - 1),

      commit: (step, values) =>
        set((s) => {
          const id = step as OnboardingStepId;
          return {
            draft: { ...s.draft, [step]: values },
            completed: s.completed.includes(id) ? s.completed : [...s.completed, id],
            skipped: s.skipped.filter((x) => x !== id),
          };
        }),

      skip: (step) =>
        set((s) => ({
          skipped: s.skipped.includes(step) ? s.skipped : [...s.skipped, step],
          completed: s.completed.filter((x) => x !== step),
        })),

      finish: () => set({ finished: true }),

      reset: () =>
        set({
          draft: initial,
          completed: [],
          skipped: [],
          stepIndex: 0,
          finished: false,
        }),

      markHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "ros.onboarding",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        draft: s.draft,
        completed: s.completed,
        skipped: s.skipped,
        stepIndex: s.stepIndex,
        finished: s.finished,
      }),
      version: 1,
      onRehydrateStorage: () => (store) => store?.markHydrated(),
    },
  ),
);

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

export function statusOf(
  step: OnboardingStepId,
  state: Pick<OnboardingStore, "completed" | "skipped" | "stepIndex">,
): StepStatus {
  if (state.skipped.includes(step)) return "skipped";
  if (state.completed.includes(step)) return "complete";
  return ONBOARDING_STEPS[state.stepIndex] === step ? "current" : "upcoming";
}

export const isOptional = (step: OnboardingStepId) => OPTIONAL_STEPS.includes(step);

/**
 * Progress counts skipped optional steps as settled, not outstanding — a bar
 * that never reaches the end because someone declined an optional step reads
 * as a failure when it is a choice.
 */
export function progressPercent(state: Pick<OnboardingStore, "completed" | "skipped">): number {
  const settled = new Set([...state.completed, ...state.skipped]);
  return Math.round((settled.size / ONBOARDING_STEPS.length) * 100);
}
