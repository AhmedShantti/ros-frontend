/**
 * Service registry — the single swap point for the backend.
 *
 * Every page reaches its data through `services`. Which implementation that
 * is depends on one environment variable:
 *
 *   NEXT_PUBLIC_API_URL=http://192.168.1.43:3000   → the live backend
 *   (unset)                                        → in-memory demo data
 *
 * Force one or the other with `NEXT_PUBLIC_API_MODE=http|mock`. Next reads
 * both at build time, so a change needs `next dev` restarted.
 *
 * No page, component, or hook chooses; they all import `services` and get
 * whichever is configured. See BACKEND_INTEGRATION.md for the endpoint map
 * and for which domains the backend does not serve yet.
 */

import { DATA_MODE } from "@/lib/api/config";
import type { ServiceRegistry } from "./types";
import { mockServices } from "./mock";
import { httpServices } from "./http";

export const services: ServiceRegistry = DATA_MODE === "http" ? httpServices : mockServices;

export { API_COVERAGE } from "./http";
export { DATA_MODE, API_BASE_URL, describeTarget } from "@/lib/api/config";

/** The tenant's currency, learned at sign-in. For rows that carry none. */
export { getDefaultCurrency } from "./map";

export { ServiceError } from "./types";
export type {
  CollectionService,
  ReadonlyCollectionService,
  Scope,
  ScopedQuery,
  ServiceRegistry,
} from "./types";
export { getFailureMode, setFailureMode } from "./mock";
export type { FailureMode } from "./mock";
