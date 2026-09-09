"use client";

/**
 * The one confirmation surface — NFR-USA-010.
 *
 * "Every destructive action is confirmable or undoable" is a stated
 * non-functional requirement, and the way that requirement usually rots is
 * that each screen rolls its own `window.confirm` or its own little modal.
 * They drift: one asks twice, one asks in English on an Arabic console, one
 * forgets to say what is about to happen.
 *
 * So confirmation is a service, not a component you remember to add:
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title, body, tone: "danger" }))) return;
 *
 * It resolves `true` or `false` and never throws, so the call site reads as
 * a guard clause rather than a callback pyramid.
 *
 * `typeToConfirm` exists for the small set of actions that cannot be undone
 * at all — purging a tenant, revoking a terminal, discarding a draft with
 * unsaved lines. Making someone type the name is friction on purpose: it is
 * the difference between a slip and a decision.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, Info, Trash2 } from "lucide-react";

import { useI18n } from "@/lib/console/providers";
import { Button, Callout, Field, Input, Modal } from "@/components/console/ui";

export interface ConfirmRequest {
  title: string;
  /** What is about to happen, and to what. Shown above everything else. */
  body?: ReactNode;
  /** Label on the confirming button. Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "warn" | "neutral";
  /**
   * When set, the confirm button stays disabled until the user types this
   * exact string. Reserve it for the irreversible.
   */
  typeToConfirm?: string;
  /** Extra context — a list of what will be affected, a count, a warning. */
  detail?: ReactNode;
}

type Resolver = (confirmed: boolean) => void;

const ConfirmContext = createContext<((request: ConfirmRequest) => Promise<boolean>) | null>(
  null,
);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [typed, setTyped] = useState("");
  const resolver = useRef<Resolver | null>(null);

  const confirm = useCallback((next: ConfirmRequest) => {
    setTyped("");
    setRequest(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  /**
   * Settling through one function matters: an unresolved promise here is a
   * button that never re-enables, and the user has no way to tell that from
   * a slow network.
   */
  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setRequest(null);
    setTyped("");
  }, []);

  const tone = request?.tone ?? "danger";
  const gate = request?.typeToConfirm;
  const unlocked = !gate || typed.trim() === gate.trim();

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      {request ? (
        <Modal
          open
          onClose={() => settle(false)}
          title={request.title}
          footer={
            <>
              <Button onClick={() => settle(false)}>
                {request.cancelLabel ?? t("common.cancel")}
              </Button>
              {/*
                Focus lands on the confirming button only when the action is
                not destructive. For a danger prompt it stays on Cancel, so a
                stray Enter dismisses rather than commits the very thing the
                dialog exists to warn about.
              */}
              <Button
                variant={tone === "danger" ? "danger" : "primary"}
                disabled={!unlocked}
                onClick={() => settle(true)}
                data-autofocus={tone !== "danger" && !gate ? true : undefined}
              >
                {request.confirmLabel ?? t("common.confirm")}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {request.body ? (
              <Callout
                tone={tone === "danger" ? "bad" : tone === "warn" ? "warn" : "neutral"}
                icon={
                  tone === "danger" ? (
                    <Trash2 size={14} />
                  ) : tone === "warn" ? (
                    <AlertTriangle size={14} />
                  ) : (
                    <Info size={14} />
                  )
                }
              >
                {request.body}
              </Callout>
            ) : null}

            {request.detail}

            {gate ? (
              <Field
                label={t("confirm.typeToConfirm").replace("{value}", gate)}
                hint={t("confirm.typeToConfirmHint")}
              >
                <Input
                  data-autofocus
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoComplete="off"
                  aria-invalid={typed.length > 0 && !unlocked}
                />
              </Field>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}

/**
 * Ask before doing something destructive.
 *
 * Returns a promise that settles `false` when the user backs out — including
 * by pressing Escape or clicking away, both of which `Modal` already treats
 * as a dismissal.
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

/**
 * The common case, named: "delete X?".
 *
 * Most call sites want the same sentence with a different noun, and writing
 * it out each time is how half of them end up without the noun.
 */
export function useConfirmDelete() {
  const confirm = useConfirm();
  const { t } = useI18n();

  return useCallback(
    (subject: string, options?: { typeToConfirm?: boolean; detail?: ReactNode }) =>
      confirm({
        title: t("common.confirmDelete").replace("{name}", subject),
        body: t("common.confirmDeleteBody").replace("{name}", subject),
        confirmLabel: t("common.delete"),
        tone: "danger",
        detail: options?.detail,
        typeToConfirm: options?.typeToConfirm ? subject : undefined,
      }),
    [confirm, t],
  );
}
