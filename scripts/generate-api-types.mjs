/**
 * Generates `lib/api/schema.ts` from `api/openapi.json`.
 *
 * Run it whenever the backend re-exports its spec:
 *
 *   npm run api:types
 *
 * Two conventions, because the NestJS document does not carry enough
 * information to infer them:
 *
 *  - Request DTOs honour their `required` array; anything else is optional.
 *  - Response schemas have no `required` array at all (Nest emits none for
 *    inline `schema:` objects), so every declared property is treated as
 *    present. A property that can be missing is declared `["string","null"]`
 *    in the document and becomes `| null` here.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const spec = JSON.parse(readFileSync(resolve(root, "api/openapi.json"), "utf8"));

const METHODS = ["get", "post", "put", "patch", "delete"];

/** Turn a JSON-Schema node into a TypeScript type expression. */
function render(schema, indent, requiredMode) {
  if (!schema) return "unknown";

  if (schema.$ref) return schema.$ref.split("/").pop();

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const nullable = types.includes("null");
  const base = types.filter((t) => t !== "null");

  let out;

  if (schema.const !== undefined) {
    // A single-valued property. `outcome: "ACTIVATED"` is what discriminates
    // the two arms of the day-close union; rendered as `string` it would not.
    out = JSON.stringify(schema.const);
  } else if (schema.enum) {
    out = schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  } else if (schema.oneOf) {
    out = schema.oneOf.map((s) => render(s, indent, requiredMode)).join(" | ");
  } else if (base.includes("array")) {
    const item = render(schema.items, indent, requiredMode);
    out = /[ |&]/.test(item) ? `(${item})[]` : `${item}[]`;
  } else if (schema.properties) {
    const pad = "  ".repeat(indent + 1);
    const close = "  ".repeat(indent);
    const required = new Set(schema.required ?? []);
    const lines = Object.entries(schema.properties).map(([key, value]) => {
      const optional = requiredMode === "declared" && !required.has(key) ? "?" : "";
      return `${doc(value.description, pad)}${pad}${safeKey(key)}${optional}: ${render(value, indent + 1, requiredMode)};`;
    });
    out = `{\n${lines.join("\n")}\n${close}}`;
  } else if (base.includes("object")) {
    // `additionalProperties: true` with no declared shape — localised name
    // maps, address blobs, theme blobs. Kept open rather than invented.
    out = "Record<string, unknown>";
  } else if (base.includes("integer") || base.includes("number")) {
    out = "number";
  } else if (base.includes("boolean")) {
    out = "boolean";
  } else if (base.includes("string")) {
    out = "string";
  } else {
    out = "unknown";
  }

  return nullable ? `${out} | null` : out;
}

/** One-line JSDoc; the document wraps some descriptions across lines. */
function doc(text, pad) {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").replace(/\*\//g, "*\/").trim();
  return `${pad}/** ${flat} */
`;
}

function safeKey(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function jsonSchemaOf(carrier) {
  return carrier?.content?.["application/json"]?.schema;
}

const chunks = [];

chunks.push(`/**
 * Wire types for ${spec.info.title} v${spec.info.version}.
 *
 * GENERATED — do not edit. Run \`npm run api:types\` after replacing
 * \`api/openapi.json\`. ${Object.keys(spec.paths).length} paths, ${Object.keys(spec.components?.schemas ?? {}).length} request DTOs.
 *
 * These are the shapes the backend actually sends and accepts. They are NOT
 * the console's domain model — see \`lib/console/services/map.ts\` for the
 * translation between the two.
 */
`);

// ---------------------------------------------------------------------------
// Request DTOs
// ---------------------------------------------------------------------------

chunks.push("// ---------------------------------------------------------------------------\n// Request bodies\n// ---------------------------------------------------------------------------\n");

for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
  chunks.push(`${doc(schema.description, "")}export interface ${name} ${render(schema, 0, "declared")}\n`);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

chunks.push("// ---------------------------------------------------------------------------\n// Operations\n// ---------------------------------------------------------------------------\n");

const operations = [];

for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op) continue;

    const id = op.operationId ?? `${method}_${path}`.replace(/[^A-Za-z0-9]/g, "_");
    const success = op.responses?.["200"] ?? op.responses?.["201"] ?? op.responses?.["204"];
    const responseSchema = jsonSchemaOf(success);
    const bodySchema = jsonSchemaOf(op.requestBody);

    const summary = [op.summary, success?.description].filter(Boolean).join(" — ");
    chunks.push(doc(`\`${method.toUpperCase()} ${path}\`${summary ? ` — ${summary}` : ""}`, "").trimEnd());
    chunks.push(
      `export type ${id}Response = ${responseSchema ? render(responseSchema, 0, "present") : "void"};\n`,
    );

    if (bodySchema) {
      chunks.push(`export type ${id}Body = ${render(bodySchema, 0, "declared")};\n`);
    }

    const parameters = [...(item.parameters ?? []), ...(op.parameters ?? [])];

    operations.push({
      id,
      method,
      path,
      summary,
      tag: op.tags?.[0] ?? "misc",
      hasBody: Boolean(bodySchema),
      bodyType: bodySchema?.$ref ? bodySchema.$ref.split("/").pop() : bodySchema ? `${id}Body` : null,
      // Ordered as the URL reads, not as the document happens to list them.
      pathParams: parameters
        .filter((p) => p.in === "path")
        .sort((a, b) => path.indexOf(`{${a.name}}`) - path.indexOf(`{${b.name}}`)),
      queryParams: parameters.filter((p) => p.in === "query"),
      headerParams: parameters.filter((p) => p.in === "header"),
    });
  }
}

// ---------------------------------------------------------------------------
// Route table — the literal strings, so a typo is a compile error
// ---------------------------------------------------------------------------

chunks.push("// ---------------------------------------------------------------------------\n// Route table\n// ---------------------------------------------------------------------------\n");
chunks.push("export const ROUTES = {");
for (const op of operations) {
  chunks.push(`  ${op.id}: { method: ${JSON.stringify(op.method.toUpperCase())}, path: ${JSON.stringify(op.path)} },`);
}
chunks.push("} as const;\n");

chunks.push(`/** Every operation the document describes. */\nexport type OperationId = keyof typeof ROUTES;\n`);

const outPath = resolve(root, "lib/api/schema.ts");
writeFileSync(outPath, chunks.join("\n"), "utf8");

// ---------------------------------------------------------------------------
// Endpoint wrappers, grouped by tag
// ---------------------------------------------------------------------------

const BARE_VERBS = new Set(["get", "post", "put", "patch", "delete"]);

/**
 * `CatalogueController_listItems` → `listItems`.
 *
 * When the tail is a bare HTTP verb the controller name is folded back in —
 * `DayCloseController_get` becomes `getDayClose` rather than `get`, which at
 * a call site (`api.treasury.get(branchId, businessDay)`) names nothing and
 * collides with every other resource the tag happens to carry.
 */
function methodName(operationId) {
  const separator = operationId.indexOf("_");
  const tail = separator === -1 ? operationId : operationId.slice(separator + 1);

  if (separator !== -1 && BARE_VERBS.has(tail)) {
    const subject = operationId.slice(0, separator).replace(/Controller$/, "");
    if (subject) return `${tail}${subject[0].toUpperCase()}${subject.slice(1)}`;
  }

  // `toggle86` is a valid identifier; a leading digit would not be.
  return /^[A-Za-z_$]/.test(tail) ? tail : `op${tail}`;
}

const byTag = new Map();
for (const op of operations) {
  if (!byTag.has(op.tag)) byTag.set(op.tag, []);
  byTag.get(op.tag).push(op);
}

const IDEMPOTENCY_HEADER = "idempotency-key";
const IF_MATCH_HEADER = "if-match";

const endpointChunks = [];

endpointChunks.push(`/**
 * Typed calls, one per operation in the document, grouped by its tag.
 *
 * GENERATED — do not edit. Run \`npm run api:types\`.
 *
 * Path parameters are positional in the order the URL declares them; a
 * request body follows them; query parameters and optional headers arrive
 * last as one options object. Endpoints the document marks as requiring an
 * \`idempotency-key\` send one automatically.
 */

import { http } from "./client";
import type * as S from "./schema";
`);

const usedNames = new Map();

for (const [tag, ops] of byTag) {
  endpointChunks.push(`// ---------------------------------------------------------------------------\n// ${tag}\n// ---------------------------------------------------------------------------\n`);
  endpointChunks.push(`export const ${tag} = {`);

  for (const op of ops) {
    const name = methodName(op.id);
    const key = `${tag}.${name}`;
    if (usedNames.has(key)) {
      throw new Error(`Two operations map to ${key}: ${usedNames.get(key)} and ${op.id}`);
    }
    usedNames.set(key, op.id);

    const args = [];
    const callOptions = [];

    for (const param of op.pathParams) {
      args.push(`${param.name}: string`);
    }
    if (op.pathParams.length > 0) {
      callOptions.push(`params: { ${op.pathParams.map((p) => p.name).join(", ")} }`);
    }

    if (op.hasBody) {
      args.push(`body: S.${op.bodyType}`);
      callOptions.push("body");
    }

    const optionFields = [];
    for (const param of op.queryParams) {
      optionFields.push(`${param.name}?: ${render(param.schema, 2, "declared")}`);
    }
    const ifMatch = op.headerParams.find((p) => p.name.toLowerCase() === IF_MATCH_HEADER);
    if (ifMatch) optionFields.push("ifMatch?: string | number");

    if (optionFields.length > 0) {
      args.push(`options: { ${optionFields.join("; ")} } = {}`);
      if (op.queryParams.length > 0) {
        callOptions.push(`query: { ${op.queryParams.map((p) => `${p.name}: options.${p.name}`).join(", ")} }`);
      }
      if (ifMatch) callOptions.push("ifMatch: options.ifMatch");
    }

    if (op.headerParams.some((p) => p.name.toLowerCase() === IDEMPOTENCY_HEADER)) {
      callOptions.push("idempotent: true");
    }

    const verb = op.method === "delete" ? "delete" : op.method;
    const optionsExpr = callOptions.length > 0 ? `, { ${callOptions.join(", ")} }` : "";

    endpointChunks.push(doc(`\`${op.method.toUpperCase()} ${op.path}\`${op.summary ? ` — ${op.summary}` : ""}`, "  ").trimEnd());
    endpointChunks.push(
      `  ${name}: (${args.join(", ")}) =>\n    http.${verb}<S.${op.id}Response>(${JSON.stringify(op.path)}${optionsExpr}),\n`,
    );
  }

  endpointChunks.push("};\n");
}

endpointChunks.push(`/** Every group, for the diagnostics screen and for \`api.catalogue.listItems()\` style calls. */`);
endpointChunks.push(`export const api = { ${[...byTag.keys()].join(", ")} };\n`);

writeFileSync(resolve(root, "lib/api/endpoints.ts"), endpointChunks.join("\n"), "utf8");

console.log(
  `lib/api/schema.ts — ${operations.length} operations, ${Object.keys(spec.components?.schemas ?? {}).length} DTOs\n` +
    `lib/api/endpoints.ts — ${byTag.size} groups: ${[...byTag.keys()].join(", ")}`,
);
