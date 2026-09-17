"use client";

/**
 * Pieces every purchasing screen reaches for — SRS ch.12.
 *
 * The acting person (for segregation of duties and the record), the tenant's
 * procure-to-pay policy, the lookups the forms pick from, and two capture
 * controls built for a phone at the loading door: a barcode scanner and a
 * camera photo that is shrunk before it is kept.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, ImageIcon, ScanBarcode, X } from "lucide-react";

import type { StockItem, StockLocation, Supplier } from "@/lib/console/types";
import type { PermissionKey } from "@/lib/console/permissions";
import { services } from "@/lib/console/services";
import type { Actor, StoredFile } from "@/lib/console/services/purchasing-local";
import { complianceState, type ComplianceState, type ProcurementPolicy } from "@/lib/console/purchasing-rules";
import { useAsync } from "@/lib/console/hooks";
import { useI18n, useSession } from "@/lib/console/providers";
import { todayIso } from "@/lib/console/settings";
import type { ConsoleKey } from "@/locales";
import { Badge, Button, Callout, IconButton, Input, Modal } from "@/components/console/ui";

export const PRC_CURRENCY = "EGP";

/** Whoever is signed in, in the shape the procurement service records. */
export function useActor(): Actor {
  const { session, can } = useSession();
  return useMemo(
    () => ({
      id: session?.user.id ?? null,
      name: session?.user.name.en || session?.user.name.ar || session?.user.email || "—",
      can: (permission: string) => can(permission as PermissionKey),
    }),
    [session, can],
  );
}

/** FR-PRC-001 — the tenant's procure-to-pay policy, re-read on `reload`. */
export function usePolicy(): { policy: ProcurementPolicy | null; error: Error | null; reload: () => void } {
  const state = useAsync(async () => services.procurement.policy(), []);
  return { policy: state.data, error: state.error, reload: state.reload };
}

export function useSupplierList(): { rows: Supplier[]; loading: boolean; error: Error | null; reload: () => void } {
  const state = useAsync(() => services.purchasing.suppliers.list({ limit: 500, sort: "name" }).then((page) => page.rows), []);
  return { rows: state.data ?? [], loading: state.loading, error: state.error, reload: state.reload };
}

export function useStockItemList(): { rows: StockItem[]; loading: boolean } {
  const state = useAsync(() => services.inventory.items.list({ limit: 1000 }).then((page) => page.rows).catch(() => [] as StockItem[]), []);
  return { rows: state.data ?? [], loading: state.loading };
}

export function useLocationList(): StockLocation[] {
  const state = useAsync(() => services.organisation.locations().catch(() => [] as StockLocation[]), []);
  return state.data ?? [];
}

// ---------------------------------------------------------------------------
// FR-PRC-011 — compliance state badge
// ---------------------------------------------------------------------------

export const COMPLIANCE_TONE: Record<ComplianceState, "good" | "warn" | "bad"> = {
  valid: "good",
  expiring: "warn",
  expired: "bad",
};

export function ComplianceBadge({ expiresOn, alertDays }: { expiresOn: string; alertDays: number }) {
  const { t } = useI18n();
  const state = complianceState(expiresOn, todayIso(), alertDays);
  return (
    <Badge tone={COMPLIANCE_TONE[state]} dot>
      {t(`prc.compliance.${state}` as ConsoleKey)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-034 — photo capture, shrunk before it is kept
// ---------------------------------------------------------------------------

/** Longest edge kept, and the most a stored file may take in the browser. */
const MAX_EDGE = 1400;
const MAX_STORED_BYTES = 450_000;

async function shrinkImage(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("unreadable"));
      element.src = url;
    });
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.8, 0.65, 0.5, 0.35]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length * 0.75 <= MAX_STORED_BYTES) return data;
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readSmallFile(file: File): Promise<string | null> {
  if (file.size > MAX_STORED_BYTES) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** Turn a picked file into what the store keeps. Images are downscaled; other files kept only when small. */
export async function toStoredFile(file: File): Promise<StoredFile> {
  const dataUrl = file.type.startsWith("image/") ? await shrinkImage(file) : await readSmallFile(file);
  return { name: file.name, type: file.type || "application/octet-stream", size: file.size, dataUrl };
}

export function FileCapture({
  value,
  onChange,
  label,
  accept = "image/*",
  camera = true,
}: {
  value: StoredFile | null;
  onChange: (next: StoredFile | null) => void;
  label: string;
  accept?: string;
  camera?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  if (value) {
    return (
      <div className="border-line space-y-2 rounded-lg border p-2">
        <div className="flex items-center gap-2">
          <ImageIcon size={14} aria-hidden className="text-fg-subtle shrink-0" />
          <span className="text-fg min-w-0 flex-1 truncate text-xs">{value.name}</span>
          <IconButton label={t("prc.removeFile")} icon={<X size={14} />} onClick={() => onChange(null)} />
        </div>
        {value.dataUrl && value.type.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local data URL, not a remote asset
          <img src={value.dataUrl} alt={label} className="max-h-64 w-full rounded object-contain" />
        ) : null}
        {!value.dataUrl ? <Callout tone="warn">{t("prc.fileNotKept")}</Callout> : null}
      </div>
    );
  }

  return (
    <label className="border-line text-fg-muted hover:bg-sunken flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs">
      <Camera size={14} aria-hidden />
      {busy ? t("prc.processingFile") : label}
      <input
        type="file"
        accept={accept}
        capture={camera ? "environment" : undefined}
        aria-label={label}
        className="sr-only"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            onChange(await toStoredFile(file));
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// FR-PRC-034 — barcode scanning: a wedge scanner types into the box; a phone
// camera uses the browser's BarcodeDetector where one exists.
// ---------------------------------------------------------------------------

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

export function ScanField({
  onScan,
  placeholder,
  busy,
}: {
  onScan: (code: string) => void;
  placeholder: string;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(Boolean(detectorCtor()) && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const submit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      onScan(trimmed);
      setCode("");
    },
    [onScan],
  );

  return (
    <div className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <ScanBarcode size={14} aria-hidden className="text-fg-subtle pointer-events-none absolute top-1/2 -translate-y-1/2 start-3" />
        <Input
          dir="ltr"
          value={code}
          disabled={busy}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit(code);
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="ps-9 font-mono"
        />
      </div>
      <Button
        type="button"
        icon={<Camera size={14} />}
        disabled={!supported || busy}
        title={supported ? t("prc.scanCamera") : t("prc.scanCameraUnsupported")}
        onClick={() => setCameraOpen(true)}
      >
        <span className="hidden sm:inline">{t("prc.scanCamera")}</span>
      </Button>
      {cameraOpen ? (
        <CameraScanner
          onClose={() => setCameraOpen(false)}
          onDetected={(value) => {
            setCameraOpen(false);
            submit(value);
          }}
        />
      ) : null}
    </div>
  );
}

function CameraScanner({ onClose, onDetected }: { onClose: () => void; onDetected: (code: string) => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor) {
      setError(t("prc.scanCameraUnsupported"));
      return;
    }
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | null = null;
    const detector = new Ctor();

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (found[0]?.rawValue) {
              onDetected(found[0].rawValue);
              return;
            }
          } catch {
            // A frame that cannot be read yet — try the next one.
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch {
        setError(t("prc.scanCameraDenied"));
      }
    })();

    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    // `onDetected` is stable for the life of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal open onClose={onClose} title={t("prc.scanCamera")}>
      {error ? (
        <Callout tone="warn">{error}</Callout>
      ) : (
        <div className="space-y-2">
          <video ref={videoRef} muted playsInline className="bg-sunken aspect-video w-full rounded-lg object-cover" />
          <p className="text-fg-subtle text-xs">{t("prc.scanCameraHint")}</p>
        </div>
      )}
    </Modal>
  );
}
