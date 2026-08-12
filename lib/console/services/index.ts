/**
 * Service registry — the single swap point for the backend.
 *
 * Every page reaches its data through `services`. To move from mocks to a
 * live API, implement `ServiceRegistry` against HTTP and change the one
 * assignment below. No page, component, or hook needs to be touched.
 *
 *   import { httpServices } from "./http";
 *   export const services: ServiceRegistry = httpServices;
 *
 * See BACKEND_INTEGRATION.md for the endpoint map and the conventions the
 * HTTP implementation is expected to honour.
 */

import type { ServiceRegistry } from "./types";
import { mockServices } from "./mock";

export const services: ServiceRegistry = mockServices;

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
