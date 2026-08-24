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
 * The API currently answers with no `Access-Control-Allow-Origin` and with
 * Helmet's default `Cross-Origin-Resource-Policy: same-origin`, so a browser
 * refuses every cross-origin call to it — the console loads and then reads
 * nothing. Enabling CORS on the backend is the proper fix. Until that ships,
 * routing through this server sidesteps it entirely, because the browser then
 * only ever talks to the origin it was served from:
 *
 *   API_PROXY_TARGET=http://192.168.1.43:3000
 *   NEXT_PUBLIC_API_URL=/api/ros
 *
 * Leave `API_PROXY_TARGET` unset to call the backend directly.
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
