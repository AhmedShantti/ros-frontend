"use client";

/**
 * Setup wizard — FR-PLT-020, NFR-USA-003.
 *
 * The whole flow lives in `components/onboarding/`; this route only mounts
 * it. State and validation come from `store/onboarding.ts` and
 * `schemas/onboarding.ts`, which already modelled all fifteen steps.
 */

import { OnboardingWizard } from "@/components/onboarding/wizard";

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
