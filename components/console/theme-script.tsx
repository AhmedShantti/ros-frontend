/**
 * Applies the stored theme, language and direction while the browser is still
 * parsing the document, so the console never paints light-then-dark or
 * left-to-right-then-right-to-left.
 *
 * The providers do the same work in an effect — that is what keeps the DOM
 * correct after a soft navigation and after React's dev-mode remount clears
 * the attributes. This script only removes the flash on a hard load.
 *
 * The keys are duplicated from `lib/console/providers.tsx` on purpose: this is
 * a server component, and importing a value out of a `"use client"` module to
 * inline it here would drag the client bundle in with it.
 */

const SCRIPT = `(function(){try{
var r=document.documentElement;
var t=localStorage.getItem("ros.console.theme")||"system";
var dark=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
r.classList.toggle("dark",dark);
r.style.colorScheme=dark?"dark":"light";
var l=localStorage.getItem("ros.console.locale");
l=(l==="ar"||l==="en")?l:"en";
r.lang=l;r.dir=l==="ar"?"rtl":"ltr";
}catch(e){}})()`
  .replace(/\n/g, "");

export function ConsoleThemeScript() {
  return (
    <script
      // `text/plain` on the client so React's development warning about
      // rendered <script> tags stays quiet on soft navigations, where the
      // script would not execute anyway.
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: SCRIPT }}
    />
  );
}
