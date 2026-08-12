"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { en, type Copy } from "@/content/en";
import { ar } from "@/content/ar";
import { flowsEn, type Flows } from "@/content/flows/en";
import { flowsAr } from "@/content/flows/ar";
import { architectureEn, type Architecture } from "@/content/architecture/en";
import { architectureAr } from "@/content/architecture/ar";
import { qualityEn, type Quality } from "@/content/quality/en";
import { qualityAr } from "@/content/quality/ar";

export type Lang = "ar" | "en";

/**
 * The dictionary is assembled from one core file plus three reference
 * files. They are separate modules because the reference chapters are
 * long enough that keeping them in one file made it unreviewable — but
 * they compose into a single `t`, so no component needs to know where a
 * given string lives.
 */
export type Dict = Copy & Flows & Architecture & Quality;

const dictionaries: Record<Lang, Dict> = {
  ar: { ...ar, ...flowsAr, ...architectureAr, ...qualityAr },
  en: { ...en, ...flowsEn, ...architectureEn, ...qualityEn },
};

/** Arabic is the default. Adding a language means adding it here. */
const DEFAULT_LANG: Lang = "ar";
const STORAGE_KEY = "trendow-lang";

export const dirOf = (lang: Lang) => (lang === "ar" ? "rtl" : "ltr");

type I18nValue = {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: Dict;
  setLang: (lang: Lang) => void;
  toggle: () => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Read the remembered choice after hydration, so the server-rendered
  // Arabic markup and the first client render always agree.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") setLangState(stored);
  }, []);

  // The <html> element is owned by the layout, so write lang/dir onto it
  // rather than re-rendering it.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dirOf(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private-mode storage failures must not break the toggle.
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      dir: dirOf(lang),
      t: dictionaries[lang],
      setLang,
      toggle: () => setLang(lang === "ar" ? "en" : "ar"),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
