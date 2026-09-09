"use client";

/**
 * The setup wizard — FR-PLT-020, NFR-USA-003.
 *
 * "Signup to first order ≤ 30 minutes median" is a stated requirement, and
 * the thing that decides whether it is met is this screen. Three rules shape
 * it:
 *
 *   1. Nothing is lost. The draft persists on every commit (see
 *      `store/onboarding.ts`), so closing the tab to go and find a tax
 *      certificate costs nothing. "Save and continue later" is the default
 *      behaviour; the button exists only so the user knows it happened.
 *   2. Optional steps are visibly optional. `OPTIONAL_STEPS` can be skipped
 *      and the rail says "skipped" rather than pretending they are done —
 *      hiding them would make the checklist at the end a lie.
 *   3. The last two steps are not configuration. `shift` opens a real till
 *      and `sample` rings a real order through it, because the only proof
 *      that setup worked is a sale coming out the other end.
 *
 * The rail is a navigation landmark and every step is reachable from it once
 * it has been visited, so a user who realises the tax rate is wrong on step
 * eleven does not have to unwind ten steps to fix it.
 */

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Minus, RotateCcw, Save } from "lucide-react";

import {
  ONBOARDING_STEPS,
  type OnboardingStepId,
} from "@/schemas/onboarding";
import {
  isOptional,
  progressPercent,
  statusOf,
  useOnboardingStore,
  type StepStatus,
} from "@/store/onboarding";
import { useI18n } from "@/lib/console/providers";
import { useConfirm } from "@/components/console/confirm";
import { useTransientMessage } from "@/lib/console/hooks";
import { Badge, Button, Card, Meter, Spinner, Toast, cx } from "@/components/console/ui";
import { STEP_COMPONENTS, STEP_META } from "@/components/onboarding/steps";

export function OnboardingWizard() {
  const { t, dir } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();
  const [message, setMessage] = useTransientMessage();

  const store = useOnboardingStore();
  const {
    hydrated,
    stepIndex,
    completed,
    skipped,
    finished,
    setStep,
    back,
    next,
    skip,
    reset,
  } = store;

  const stepId = ONBOARDING_STEPS[stepIndex]!;
  const percent = progressPercent({ completed, skipped });

  // Furthest visited, so the rail can offer backwards navigation without
  // letting someone jump to step twelve on a blank tenant.
  const reachable = useMemo(() => {
    const settled = new Set<OnboardingStepId>([...completed, ...skipped]);
    let furthest = 0;
    ONBOARDING_STEPS.forEach((id, index) => {
      if (settled.has(id)) furthest = Math.max(furthest, index + 1);
    });
    return Math.max(furthest, stepIndex);
  }, [completed, skipped, stepIndex]);

  // Keyboard: the wizard is a linear flow, so Alt+Arrow moves through it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      const forward = dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      const backward = dir === "rtl" ? "ArrowRight" : "ArrowLeft";
      if (event.key === backward && stepIndex > 0) {
        event.preventDefault();
        back();
      } else if (event.key === forward && stepIndex < reachable) {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dir, stepIndex, reachable, back, next]);

  if (!hydrated) {
    return (
      <div className="text-fg-muted flex min-h-[60vh] items-center justify-center gap-2 text-sm">
        <Spinner /> {t("onb.loading")}
      </div>
    );
  }

  if (finished) {
    return <FinishedPanel onReset={() => void handleReset()} />;
  }

  async function handleReset() {
    const ok = await confirm({
      title: t("onb.resetTitle"),
      body: t("onb.resetBody"),
      confirmLabel: t("onb.resetConfirm"),
      tone: "danger",
    });
    if (ok) {
      reset();
      setMessage(t("onb.resetDone"));
    }
  }

  async function handleSkip() {
    const ok = await confirm({
      title: t("onb.skipTitle").replace("{step}", t(STEP_META[stepId].labelKey)),
      body: t("onb.skipBody"),
      confirmLabel: t("onb.skipConfirm"),
      tone: "warn",
    });
    if (ok) {
      skip(stepId);
      next();
      setMessage(t("onb.skipped"));
    }
  }

  const StepBody = STEP_COMPONENTS[stepId];
  const meta = STEP_META[stepId];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-fg text-xl font-semibold sm:text-2xl">{t("onb.title")}</h1>
            <p className="text-fg-muted mt-1 max-w-2xl text-sm leading-relaxed">
              {t("onb.subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={<Save size={13} />}
              onClick={() => setMessage(t("onb.saved"))}
            >
              {t("onb.saveAndExit")}
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => void handleReset()}>
              {t("onb.reset")}
            </Button>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="text-fg-muted">
              {t("onb.stepOf")
                .replace("{n}", String(stepIndex + 1))
                .replace("{total}", String(ONBOARDING_STEPS.length))}
            </span>
            <span className="text-fg font-mono tabular-nums">{percent}%</span>
          </div>
          <Meter value={percent} tone={percent === 100 ? "good" : "accent"} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <nav aria-label={t("onb.stepsLabel")} className="lg:sticky lg:top-6 lg:self-start">
          {/*
            Horizontal, scrollable rail on a phone; vertical list from `lg`.
            A fifteen-item vertical rail on a 390px screen would push the form
            itself below two screenfuls of navigation.
          */}
          <ol className="flex gap-1.5 overflow-x-auto pb-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
            {ONBOARDING_STEPS.map((id, index) => {
              const status = statusOf(id, { completed, skipped, stepIndex });
              const enabled = index <= reachable;
              return (
                <li key={id} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    disabled={!enabled}
                    aria-current={index === stepIndex ? "step" : undefined}
                    onClick={() => setStep(index)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs transition-colors",
                      index === stepIndex
                        ? "bg-accent-soft text-accent font-medium"
                        : "text-fg-muted hover:bg-sunken",
                      !enabled && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <StatusDot status={status} index={index} />
                    <span className="min-w-0 flex-1 truncate lg:whitespace-normal">
                      {t(STEP_META[id].labelKey)}
                    </span>
                    {isOptional(id) ? (
                      <span className="text-fg-subtle hidden text-[0.6rem] lg:inline">
                        {t("onb.optional")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-w-0">
          <Card>
            <div className="border-line border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-fg text-base font-semibold">{t(meta.labelKey)}</h2>
                {isOptional(stepId) ? (
                  <Badge tone="muted">{t("onb.optional")}</Badge>
                ) : null}
                <Badge tone="neutral">{meta.spec}</Badge>
              </div>
              <p className="text-fg-muted mt-1 text-xs leading-relaxed">
                {t(meta.hintKey)}
              </p>
            </div>

            <div className="px-5 py-5">
              <StepBody
                onDone={() => {
                  if (stepIndex < ONBOARDING_STEPS.length - 1) next();
                }}
                onMessage={setMessage}
              />
            </div>

            <div className="border-line bg-sunken/40 flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={stepIndex === 0}
                icon={dir === "rtl" ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
                onClick={back}
              >
                {t("common.back")}
              </Button>

              <div className="flex items-center gap-2">
                {isOptional(stepId) ? (
                  <Button size="sm" variant="ghost" onClick={() => void handleSkip()}>
                    {t("onb.skip")}
                  </Button>
                ) : null}
                {/*
                  "Continue" is deliberately not the submit button. Each step
                  owns its own primary action, because a step that validates
                  and one that merely informs need different verbs — and a
                  single shared Next would have to guess which it is.
                */}
                <span className="text-fg-subtle text-[0.68rem]">{t("onb.altArrowHint")}</span>
              </div>
            </div>
          </Card>

          <p className="text-fg-subtle mt-4 text-center text-xs">
            {t("onb.autosaveNote")}{" "}
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="underline underline-offset-2"
            >
              {t("onb.goToConsole")}
            </button>
          </p>
        </div>
      </div>

      <Toast message={message} />
    </div>
  );
}

function StatusDot({ status, index }: { status: StepStatus; index: number }) {
  const base =
    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold";

  if (status === "complete") {
    return (
      <span className={cx(base, "bg-good text-white")} aria-hidden>
        <Check size={11} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className={cx(base, "bg-line-strong text-fg-muted")} aria-hidden>
        <Minus size={11} />
      </span>
    );
  }
  return (
    <span
      className={cx(
        base,
        status === "current" ? "bg-accent text-white" : "border-line text-fg-subtle border",
      )}
      aria-hidden
    >
      {index + 1}
    </span>
  );
}

// ---------------------------------------------------------------------------

function FinishedPanel({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { completed, skipped } = useOnboardingStore();

  const outstanding = ONBOARDING_STEPS.filter(
    (id) => !completed.includes(id) || skipped.includes(id),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center">
      <span className="bg-good/15 text-good mx-auto flex h-14 w-14 items-center justify-center rounded-full">
        <Check size={26} />
      </span>
      <h1 className="text-fg mt-5 text-2xl font-semibold">{t("onb.doneTitle")}</h1>
      <p className="text-fg-muted mx-auto mt-2 max-w-xl text-sm leading-relaxed">
        {t("onb.doneBody")}
      </p>

      {outstanding.length > 0 ? (
        <Card className="mt-8 text-start">
          <div className="border-line border-b px-5 py-3">
            <h2 className="text-fg text-sm font-semibold">{t("onb.outstandingTitle")}</h2>
            <p className="text-fg-muted mt-0.5 text-xs">{t("onb.outstandingBody")}</p>
          </div>
          <ul className="divide-line divide-y">
            {outstanding.map((id) => (
              <li key={id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="text-fg text-sm">{t(STEP_META[id].labelKey)}</span>
                <Badge tone={skipped.includes(id) ? "muted" : "warn"}>
                  {skipped.includes(id) ? t("onb.optional") : t("onb.incomplete")}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => router.push("/dashboard")}>
          {t("onb.goToConsole")}
        </Button>
        <Button onClick={() => router.push("/pos")}>{t("onb.goToPos")}</Button>
        <Button variant="ghost" onClick={onReset}>
          {t("onb.reset")}
        </Button>
      </div>
    </div>
  );
}
