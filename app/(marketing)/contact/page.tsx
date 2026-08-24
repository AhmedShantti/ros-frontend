"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { Button, Container, GlowCard, PageHero } from "@/components/ui";
import { Reveal } from "@/components/motion";

type Status = "idle" | "sending" | "sent";

/**
 * Where an enquiry actually goes.
 *
 * Set `NEXT_PUBLIC_CONTACT_ENDPOINT` to a route handler, a CRM webhook or a
 * form service and this page starts posting to it — including reporting a
 * failure instead of a false confirmation. Left unset, the form still works
 * and the confirmation says outright that nothing was sent, rather than
 * telling someone their request was recorded when it was not.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_CONTACT_ENDPOINT ?? "";

/* A field is a hairline and a slightly sunken surface. On focus the
   hairline turns orange and the surface lifts — no ring, because the
   border is already doing the job and two focus indicators on the same
   control read as an error state. */
const FIELD =
  "border-ink/20 focus:border-a text-ink placeholder:text-grey-400 bg-ink/4 focus:bg-ink/6 mt-2.5 w-full border px-3.5 py-3 text-sm outline-none transition-colors";

export default function ContactPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
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

    // Not wired up: confirm locally and say plainly that nothing was sent.
    // The old version showed the same confirmation either way, so a real
    // enquiry looked delivered when it had gone nowhere.
    if (!ENDPOINT) {
      window.setTimeout(() => setStatus("sent"), 700);
      return;
    }

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      // A failed send must not look like a successful one — that is the whole
      // defect this is fixing.
      if (!response.ok) throw new Error(String(response.status));
      setStatus("sent");
    } catch {
      setError(t.contact.sendFailed);
      setStatus("idle");
    }
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
                  className="border-a bg-a-wash border p-8"
                >
                  <h2 className="font-display text-ink text-2xl">
                    {ENDPOINT ? t.contact.sentTitle : t.contact.successTitle}
                  </h2>
                  <p className="text-grey-600 mt-3 text-sm leading-relaxed">
                    {ENDPOINT ? t.contact.sentText : t.contact.successText}
                  </p>
                  <button
                    type="button"
                    onClick={() => setStatus("idle")}
                    className="border-ink/25 text-ink hover:border-a hover:text-a font-display ui-btn mt-7 border px-[17px] py-[13px] transition-colors"
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
                      className="text-a border-a bg-a-wash mt-5 border px-4 py-3 text-sm"
                    >
                      {error}
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    disabled={status === "sending"}
                    className="mt-8"
                  >
                    {status === "sending" ? t.contact.sending : t.contact.submit}
                  </Button>
                </form>
              </Reveal>
            )}

            <Reveal delay={120} kind="right" className="h-fit">
              <GlowCard accent="emerald" className="p-7">
                <p className="spec text-a">{t.contact.sidebarTitle}</p>
                <ol className="mt-6 space-y-5">
                  {t.contact.steps.map((step, i) => (
                    <li key={step} className="flex gap-3.5">
                      <span className="bg-a-wash text-a border-a font-display flex h-7 w-7 shrink-0 items-center justify-center border text-xs">
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
