/**
 * Service registry — the single swap point for the backend.
 *
 * Everything the UI knows about data reaches it through `services`. The
 * implementation is chosen in `lib/console/services/index.ts`; to move from
 * mocks to HTTP, change the one assignment there. No page, feature, hook or
 * component imports a mock module directly.
 *
 * See BACKEND_INTEGRATION.md for the endpoint map.
 */

export {
  ServiceError,
  getFailureMode,
  services,
  setFailureMode,
} from "@/lib/console/services";

export type {
  CollectionService,
  FailureMode,
  ReadonlyCollectionService,
  Scope,
  ScopedQuery,
  ServiceRegistry,
} from "@/lib/console/services";
