/**
 * Hooks — the public entry point.
 *
 * `useAsync` / `useCollection` are the dependency-free pair the existing
 * console pages use. `useQuery`-backed equivalents live alongside them in
 * `./query` for the newer feature slices; both read through the same service
 * registry, so a page can be moved from one to the other without changing
 * what it asks for.
 */

export {
  useAsync,
  useCollection,
  useDismissable,
  useTransientMessage,
} from "@/lib/console/hooks";

export type {
  AsyncState,
  CollectionOptions,
  CollectionState,
} from "@/lib/console/hooks";

export * from "./query";
export * from "./use-media-query";
export * from "./use-unsaved-changes";
