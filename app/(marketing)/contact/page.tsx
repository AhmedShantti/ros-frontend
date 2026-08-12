"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { Container, GlowCard, PageHero } from "@/components/ui";
import { Reveal } from "@/components/motion";

type Status = "idle" | "sending" | "sent";

const FIELD =
  "border-ink/15 focus:border-a focus:ring-amber/25 mt-2 w-full rounded-lg border bg-paper px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-4";

export default function ContactPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();

    if (!name || (!phone && !email)) {
      setError(t.contact.required);
      return;
    }

    setError(null);
    setStatus("sending");
    // Nothing leaves the browser. Replace this with a fetch to your CRM,
    // a route handler, or a form service to make the form real.
    window.setTimeout(() => setStatus("sent"), 700);
  }

  return (
    <>
      <PageHero
        eyebrow={t.contact.eyebrow}
        title={t.contact.title}
        lede={t.contact.lede}
        accent="amber"
      />

      <div data-accent="amber" className="bg-bone">
        <Container className="py-20 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:gap-16">
            {status === "sent" ? (
              <Reveal>
                <div
                  data-accent="emerald"
                  className="border-a bg-a-wash rounded-2xl border p-8"
                >
                  <h2 className="font-display text-ink text-xl font-semibold">
                    {t.contact.successTitle}
                  </h2>
                  <p className="text-grey-600 mt-3 text-sm leading-relaxed">
                    {t.contact.successText}
                  </p>
                  <button
                    type="button"
                    onClick={() => setStatus("idle")}
                    className="border-ink/20 text-ink hover:border-a hover:text-a mt-7 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors"
                  >
                    {t.contact.reset}
                  </button>
                </div>
              </Reveal>
            ) : (
              <Reveal>
                <form onSubmit={onSubmit} noValidate>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block sm:col-span-2">
                      <span className="text-grey-600 text-sm">
                        {t.contact.name}
                      </span>
                      <input name="name" type="text" className={FIELD} />
                    </label>

                    <label className="block sm:col-span-2">
                      <span className="text-grey-600 text-sm">
                        {t.contact.business}
                      </span>
                      <input name="business" type="text" className={FIELD} />
                    </label>

                    <label className="block">
                      <span className="text-grey-600 text-sm">
                        {t.contact.phone}
                      </span>
                      <input
                        name="phone"
                        type="tel"
                        dir="ltr"
                        className={FIELD}
                      />
                    </label>

                    <label className="block">
                      <span className="text-grey-600 text-sm">
                        {t.contact.email}
                      </span>
                      <input
                        name="email"
                        type="email"
                        dir="ltr"
                        className={FIELD}
                      />
                    </label>

                    <label className="block">
                      <span className="text-grey-600 text-sm">
                        {t.contact.branches}
                      </span>
                      <select name="branches" className={FIELD} defaultValue="">
                        <option value="" disabled />
                        {t.contact.branchOptions.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block sm:col-span-2">
                      <span className="text-grey-600 text-sm">
                        {t.contact.message}
                      </span>
                      <textarea
                        name="message"
                        rows={4}
                        placeholder={t.contact.messagePlaceholder}
                        className={`${FIELD} resize-y`}
                      />
                    </label>
                  </div>

                  {error ? (
                    <p
                      role="alert"
                      data-accent="rose"
                      className="text-a border-a bg-a-wash mt-5 rounded-lg border px-4 py-3 text-sm"
                    >
                      {error}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="bg-ink text-bone hover:bg-a-deep mt-8 rounded-full px-6 py-3 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 disabled:opacity-60"
                  >
                    {status === "sending" ? t.contact.sending : t.contact.submit}
                  </button>
                </form>
              </Reveal>
            )}

            <Reveal delay={120} kind="right" className="h-fit">
              <GlowCard accent="emerald" className="p-7">
                <p className="spec text-a">{t.contact.sidebarTitle}</p>
                <ol className="mt-6 space-y-5">
                  {t.contact.steps.map((step, i) => (
                    <li key={step} className="flex gap-3.5">
                      <span className="bg-a-wash text-a border-a font-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                        {i + 1}
                      </span>
                      <span className="text-grey-600 text-sm leading-relaxed">
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              </GlowCard>
            </Reveal>
          </div>
        </Container>
      </div>
    </>
  );
}
