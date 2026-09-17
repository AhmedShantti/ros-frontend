"use client";

/**
 * Image-based thermal rendering — FR-LOC-012.
 *
 * Many thermal printers in the region ship with no Arabic code page, or with
 * one that prints letters unjoined and left-to-right. The fallback is to
 * shape the text in the browser (the platform's text engine joins Arabic
 * correctly) and send the printer a 1-bit raster instead of characters. This
 * is that rasteriser: 203 dpi, 384 dots across a 58 mm roll (48 mm printable)
 * and 576 across 80 mm (72 mm printable), thresholded to pure black and
 * white exactly as an ESC/POS `GS v 0` image would print.
 */

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

import type { ReceiptLine } from "@/lib/console/receipt";
import { useI18n } from "@/lib/console/providers";
import { Callout } from "@/components/console/ui";

export function dotsFor(paperWidth: 58 | 80): number {
  return paperWidth === 58 ? 384 : 576;
}

/** A character-padded "label   amount" line split back into its two halves. */
function splitPair(text: string): [string, string] | null {
  const match = /^(.*?\S)\s{2,}(\S.*)$/.exec(text);
  return match ? [match[1]!, match[2]!] : null;
}

/**
 * FR-LOC-012 — render receipt lines to a 1-bit PNG at printer resolution.
 * Returns the data URL and the raster height in dots.
 */
export async function rasterise(
  lines: ReceiptLine[],
  paperWidth: 58 | 80,
  fontStack: string,
  sizeDots: number,
): Promise<{ dataUrl: string; width: number; height: number; blackRatio: number }> {
  const width = dotsFor(paperWidth);
  const margin = 8;
  const lineHeight = Math.round(sizeDots * 1.4);

  // Webfonts named in the stack are loaded if the page can reach them; a
  // missing face falls back through the stack, which is what a till would do.
  try {
    await document.fonts.load(`${sizeDots}px ${fontStack}`, "عربي Arabic");
  } catch {
    // Not fatal — the stack's fallbacks still render.
  }

  const textLines = lines.filter((line) => line.kind === "text" || line.kind === "rule");
  const height = margin * 2 + textLines.reduce((sum, line) => sum + (line.kind === "rule" ? Math.round(lineHeight / 2) : lineHeight), 0);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "middle";

  let y = margin;
  for (const line of textLines) {
    if (line.kind === "rule") {
      const mid = y + Math.round(lineHeight / 4);
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(margin, mid);
      ctx.lineTo(width - margin, mid);
      ctx.stroke();
      y += Math.round(lineHeight / 2);
      continue;
    }
    if (line.kind !== "text") continue;
    ctx.font = `${line.bold ? "bold " : ""}${sizeDots}px ${fontStack}`;
    ctx.direction = line.dir;
    const mid = y + lineHeight / 2;
    const startX = line.dir === "rtl" ? width - margin : margin;
    const endX = line.dir === "rtl" ? margin : width - margin;
    const pairParts = line.align === "start" ? splitPair(line.text) : null;
    if (pairParts) {
      ctx.textAlign = "start";
      ctx.fillText(pairParts[0], startX, mid, width - margin * 2);
      ctx.textAlign = "end";
      ctx.fillText(pairParts[1], endX, mid);
    } else if (line.align === "center") {
      ctx.textAlign = "center";
      ctx.fillText(line.text.trim(), width / 2, mid, width - margin * 2);
    } else {
      ctx.textAlign = line.align === "end" ? "end" : "start";
      ctx.fillText(line.text, line.align === "end" ? endX : startX, mid, width - margin * 2);
    }
    y += lineHeight;
  }

  // Threshold to 1-bit: a thermal head has no grey.
  const image = ctx.getImageData(0, 0, width, height);
  let black = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const luminance = 0.299 * image.data[i]! + 0.587 * image.data[i + 1]! + 0.114 * image.data[i + 2]!;
    const on = luminance < 160;
    if (on) black += 1;
    const value = on ? 0 : 255;
    image.data[i] = value;
    image.data[i + 1] = value;
    image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return { dataUrl: canvas.toDataURL("image/png"), width, height, blackRatio: black / (width * height) };
}

export function RasterPreview({
  lines,
  paperWidth,
  fontStack,
  sizeDots,
  filename,
}: {
  lines: ReceiptLine[];
  paperWidth: 58 | 80;
  fontStack: string;
  sizeDots: number;
  filename: string;
}) {
  const { t } = useI18n();
  const [result, setResult] = useState<Awaited<ReturnType<typeof rasterise>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    rasterise(lines, paperWidth, fontStack, sizeDots)
      .then((next) => {
        if (!cancelled) {
          setResult(next);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [lines, paperWidth, fontStack, sizeDots]);

  if (error) return <Callout tone="bad">{error}</Callout>;
  if (!result) return <p className="text-fg-subtle text-xs">{t("lpk.print.rendering")}</p>;

  return (
    <div className="space-y-2">
      {/* 1 dot → 0.75 CSS px keeps 80 mm near its real width on a laptop. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={result.dataUrl}
        alt={t("lpk.print.imageAlt")}
        width={Math.round(result.width * 0.75)}
        height={Math.round(result.height * 0.75)}
        className="border-line rounded border bg-white"
        style={{ imageRendering: "pixelated" }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg-subtle font-mono text-xs" dir="ltr">
          {result.width}×{result.height} dots · 1-bit
        </span>
        <a href={result.dataUrl} download={filename} className="text-accent inline-flex items-center gap-1 text-xs font-medium hover:underline">
          <Download size={12} aria-hidden />
          {t("lpk.print.download")}
        </a>
      </div>
    </div>
  );
}
