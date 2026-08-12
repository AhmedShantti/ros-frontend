"use client";

/**
 * TanStack Query client.
 *
 * The client is created inside a `useState` initialiser rather than at module
 * scope. At module scope it would be shared across requests on the server and
 * one tenant's cached data could be handed to another — the classic App
 * Router footgun, and a genuine data leak in a multi-tenant product.
 */

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ServiceError } from "./services";

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // The window regaining focus is not a reason to re-pull a stock count
        // the user is mid-way through reading.
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // A 4xx will fail identically on the next attempt. Only retry the
          // failures that plausibly resolve themselves.
          if (error instanceof ServiceError && error.status < 500) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        // A retried write is a duplicate write. The UI offers a retry button
        // instead, so the person decides.
        retry: false,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(makeClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
