/**
 * Local application state.
 *
 * Three stores, split by lifetime rather than by feature:
 *
 *   ui            what is open and what is collapsed; dies with the tab
 *   connectivity  the outbound queue; must survive a reload, that is its job
 *   onboarding    the setup draft; survives until setup finishes
 *
 * Server state does not live here — it belongs to TanStack Query, keyed
 * through `@/hooks/query`. The live trading state (open orders, kitchen
 * tickets, the cash drawer) belongs to the reducer in `lib/console/live`,
 * which is a single serialisable store precisely so two tabs can behave like
 * two terminals.
 */

export * from "./ui";
export * from "./connectivity";
export * from "./onboarding";
