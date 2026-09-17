/**
 * SIEM event formats — FR-SEC-053.
 *
 * The four wire formats a tenant's SIEM is likely to ingest. The console
 * uses these to show exactly what forwarding would send for the events it
 * holds; the forwarding itself is a server job (a browser cannot open a
 * syslog connection, and must not hold the sink's token), and the screen
 * says so.
 */

import type { SecurityEvent } from "./services/security-events";
import type { SiemFormat } from "./security-policy";

const VENDOR = "TRENDOW";
const PRODUCT = "ROS";
const VERSION = "1.0";

/** 0–10, per CEF. Configuration and data access weigh more than routine approvals. */
function severity(event: SecurityEvent): number {
  switch (event.category) {
    case "tenant":
      return 8;
    case "configuration":
    case "authorisation":
      return 6;
    case "data_access":
      return 5;
    case "authentication":
      return 4;
    default:
      return 3;
  }
}

const cefHeader = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
const cefExt = (value: string) => value.replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\r?\n/g, " ");
const leefValue = (value: string) => value.replace(/[\t\r\n^]/g, " ");
const sdValue = (value: string) => value.replace(/[\\"\]]/g, (char) => `\\${char}`);

export function formatSiemEvent(event: SecurityEvent, format: SiemFormat): string {
  const detail = JSON.stringify(event.detail);
  switch (format) {
    case "json":
      return JSON.stringify({
        id: event.id,
        time: event.at,
        tenant_id: event.tenantId,
        category: event.category,
        action: event.kind,
        actor: { id: event.actorId, name: event.actorName },
        subject: { type: event.subjectType, id: event.subjectId },
        correlation_id: event.correlationId,
        detail: event.detail,
        hash: event.hash,
        previous_hash: event.previousHash,
      });
    case "cef":
      return [
        "CEF:0",
        VENDOR,
        PRODUCT,
        VERSION,
        cefHeader(event.kind),
        cefHeader(event.kind.replace(/[._]/g, " ")),
        String(severity(event)),
        [
          `rt=${Date.parse(event.at)}`,
          `suser=${cefExt(event.actorName)}`,
          `suid=${cefExt(event.actorId ?? "")}`,
          `cat=${cefExt(event.category)}`,
          `cs1Label=tenantId cs1=${cefExt(event.tenantId)}`,
          `cs2Label=subject cs2=${cefExt(`${event.subjectType}:${event.subjectId}`)}`,
          `cs3Label=correlationId cs3=${cefExt(event.correlationId)}`,
          `externalId=${cefExt(event.id)}`,
          `msg=${cefExt(detail)}`,
        ].join(" "),
      ].join("|");
    case "leef":
      return [
        "LEEF:2.0",
        VENDOR,
        PRODUCT,
        VERSION,
        leefValue(event.kind),
        "^",
        [
          `devTime=${event.at}`,
          `usrName=${leefValue(event.actorName)}`,
          `cat=${event.category}`,
          `sev=${severity(event)}`,
          `tenantId=${leefValue(event.tenantId)}`,
          `resource=${leefValue(`${event.subjectType}:${event.subjectId}`)}`,
          `correlationId=${leefValue(event.correlationId)}`,
          `msg=${leefValue(detail)}`,
        ].join("^"),
      ].join("|");
    case "syslog": {
      // RFC 5424. Facility 13 (log audit); severity mapped from the CEF scale.
      const sev = severity(event) >= 8 ? 2 : severity(event) >= 6 ? 4 : 6;
      const pri = 13 * 8 + sev;
      const sd = `[ros@32473 tenant="${sdValue(event.tenantId)}" actor="${sdValue(event.actorName)}" category="${event.category}" subject="${sdValue(`${event.subjectType}:${event.subjectId}`)}" correlation="${sdValue(event.correlationId)}"]`;
      return `<${pri}>1 ${event.at} ros-console ${PRODUCT} - ${event.kind} ${sd} ${detail}`;
    }
  }
}
