import type { NextConfig } from "next";

/**
 * Devices other than the machine running `next dev` are blocked from the dev
 * server's own endpoints unless their origin is listed. That matters here
 * because the console is meant to be opened on a tablet on the same network:
 *
 *   DEV_ORIGINS=192.168.1.50:3000,ipad.local:3000
 *
 * This is a development-only allowance and has nothing to do with which API
 * the app calls — that is `NEXT_PUBLIC_API_URL`.
 */
const devOrigins = (process.env.DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Optional same-origin proxy to the backend.
 *
 * The deployed API sends CORS correctly — an `Access-Control-Allow-Origin`
 * reflecting the caller and a preflight that admits `authorization`,
 * `idempotency-key` and `if-match` — so the browser can call it directly and
 * this proxy is not required. `npm run api:check` reports which is true of
 * whatever host is configured.
 *
 * It stays because a deployment that lacks those headers is indistinguishable
 * in JavaScript from a dead host, and routing through this server sidesteps
 * the question entirely: the browser then only ever talks to the origin it
 * was served from.
 *
 *   API_PROXY_TARGET=https://ros-zchd.onrender.com
 *   NEXT_PUBLIC_API_URL=/api/ros
 *
 * Leave `API_PROXY_TARGET` unset to call the backend directly. In production
 * the same rewrite has to exist on whatever serves the app.
 */
const proxyTarget = (process.env.API_PROXY_TARGET ?? "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  reactStrictMode: true,

  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),

  ...(proxyTarget
    ? {
        async rewrites() {
          return [{ source: "/api/ros/:path*", destination: `${proxyTarget}/:path*` }];
        },
      }
    : {}),
};

export default nextConfig;
