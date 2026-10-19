import { z } from "zod";
import {
  bodyFaults,
  type ControlName,
  controlHeaders,
  controlNames,
  maxSeed,
  retrySteps,
  scenarioNames,
  simulatedStatuses,
} from "./controls.js";
import { maxCursorLength } from "./cursor.js";
import type { FixturePack } from "./fixtures/index.js";
import { maxImageSide, maxImageText, minImageSide } from "./images.js";
import {
  defaultLimit,
  maxLimit,
  maxSearchLength,
  maxSortFields,
  paginationModes,
} from "./query.js";
import { type ResourceName, resources } from "./resources.js";
import {
  type EngineResponse,
  json,
  maxBodyBytes,
  type ProblemStatus,
  problem,
} from "./response.js";

const resourceNames = resources.map((resource) => resource.name) as [
  ResourceName,
  ...ResourceName[],
];
const counts = z.record(z.enum(resourceNames), z.int().nonnegative());
// what a control accepts: a closed list, or a number range with both ends included
const controlValues = z.union([
  z.strictObject({
    type: z.enum(["integer", "string"]),
    enum: z.array(z.union([z.int(), z.string()])).min(1),
  }),
  z.strictObject({
    type: z.enum(["integer", "number"]),
    minimum: z.number(),
    maximum: z.number(),
  }),
]);

export const catalogSchema = z.strictObject({
  fixture: z.strictObject({
    id: z.string().min(1),
    referenceTime: z.iso.datetime(),
    checksum: z.string().min(1),
  }),
  resources: z.array(
    z.strictObject({
      name: z.enum(resourceNames),
      href: z.string().min(1),
      count: z.int().nonnegative(),
      relations: z.array(z.string()),
      expansions: z.array(z.string()),
      search: z.array(z.string()),
      filters: z.array(z.string()),
      sortable: z.array(z.string()),
    }),
  ),
  links: z.strictObject({
    capabilities: z.string().min(1),
    openapi: z.string().min(1),
    docs: z.string().min(1),
  }),
});

export const capabilitiesSchema = z.strictObject({
  api: z.literal("v1"),
  state: z.enum(["memory", "stateless"]),
  openapi: z.array(z.strictObject({ version: z.string(), href: z.string().min(1) })),
  fixtures: z.array(z.strictObject({ id: z.string(), own: z.boolean(), counts })),
  controls: z.array(
    z.strictObject({
      name: z.enum(controlNames),
      query: z.string(),
      header: z.string(),
      values: controlValues,
    }),
  ),
  statuses: z.array(z.int()),
  scenarios: z.array(z.enum(scenarioNames)),
  bodyFaults: z.array(z.enum(bodyFaults)),
  pagination: z.array(z.enum(paginationModes)),
  limits: z.strictObject({
    defaultPageSize: z.int().positive(),
    maxPageSize: z.int().positive(),
    maxSortFields: z.int().positive(),
    maxSearchLength: z.int().positive(),
    maxCursorLength: z.int().positive(),
    maxDelayMs: z.int().nonnegative(),
    maxRequestBodyBytes: z.int().positive(),
    minImageSide: z.int().positive(),
    maxImageSide: z.int().positive(),
    maxImageText: z.int().positive(),
  }),
  images: z.strictObject({ placeholder: z.string(), avatar: z.string() }),
});

export const echoSchema = z.strictObject({
  method: z.string(),
  path: z.string(),
  query: z.record(z.string(), z.array(z.string())),
  headers: z.record(z.string(), z.string()),
  // credential headers that were sent; their values are never echoed
  redacted: z.array(z.string()),
  body: z.unknown(),
  bodyText: z.string().nullable(),
  truncated: z.boolean(),
  bodyBytes: z.int().nonnegative(),
});

export const statusFixtureSchema = z.strictObject({
  status: z.int().min(200).max(299),
  title: z.string(),
});

export type Catalog = z.infer<typeof catalogSchema>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export type Echo = z.infer<typeof echoSchema>;
type ControlValues = z.infer<typeof controlValues>;

type Row = { id: number } & Record<string, unknown>;
type Store = Record<ResourceName, readonly Row[]>;
type Pairs = Iterable<readonly [string, string]>;

const join = (base: string | undefined, path: string) =>
  `${(base ?? "").replace(/\/+$/, "")}${path}`;

export function catalog(pack: FixturePack, store: Store, baseUrl: string | undefined): Catalog {
  return {
    fixture: {
      id: pack.manifest.id,
      referenceTime: pack.manifest.referenceTime,
      checksum: pack.manifest.checksum,
    },
    resources: resources.map((resource) => ({
      name: resource.name,
      href: join(baseUrl, `/v1/${resource.name}`),
      count: store[resource.name].length,
      relations: Object.keys(resource.relations),
      expansions: Object.keys(resource.expansions),
      search: [...resource.search],
      filters: [...resource.filters],
      sortable: [...resource.sortable],
    })),
    links: {
      capabilities: join(baseUrl, "/capabilities"),
      openapi: join(baseUrl, "/openapi.json"),
      docs: join(baseUrl, "/docs"),
    },
  };
}

export interface CapabilityInputs {
  state: "memory" | "stateless";
  packs: readonly FixturePack[];
  ownPack: string;
  ownCounts: Record<ResourceName, number>;
  maxDelayMs: number;
  baseUrl: string | undefined;
}

export function capabilities(inputs: CapabilityInputs): Capabilities {
  const values: Record<ControlName, ControlValues> = {
    delay: { type: "integer", minimum: 0, maximum: inputs.maxDelayMs },
    status: { type: "integer", enum: [...simulatedStatuses] },
    scenario: { type: "string", enum: [...scenarioNames] },
    body: { type: "string", enum: [...bodyFaults] },
    step: { type: "integer", minimum: 1, maximum: retrySteps },
    failRate: { type: "number", minimum: 0, maximum: 1 },
    fixture: { type: "string", enum: inputs.packs.map((pack) => pack.manifest.id) },
    seed: { type: "integer", minimum: 0, maximum: maxSeed },
  };
  return {
    api: "v1",
    state: inputs.state,
    openapi: [
      { version: "3.1.2", href: join(inputs.baseUrl, "/openapi.json") },
      { version: "3.2.1", href: join(inputs.baseUrl, "/openapi-3.2.json") },
    ],
    fixtures: inputs.packs.map((pack) => ({
      id: pack.manifest.id,
      own: pack.manifest.id === inputs.ownPack,
      // a memory run counts its own records, writes included
      counts: pack.manifest.id === inputs.ownPack ? inputs.ownCounts : pack.manifest.counts,
    })),
    controls: controlNames.map((name) => ({
      name,
      query: `_mock.${name}`,
      header: controlHeaders[name],
      values: values[name],
    })),
    statuses: [...simulatedStatuses],
    scenarios: [...scenarioNames],
    bodyFaults: [...bodyFaults],
    pagination: [...paginationModes],
    limits: {
      defaultPageSize: defaultLimit,
      maxPageSize: maxLimit,
      maxSortFields,
      maxSearchLength,
      maxCursorLength,
      maxDelayMs: inputs.maxDelayMs,
      maxRequestBodyBytes: maxBodyBytes,
      minImageSide,
      maxImageSide,
      maxImageText,
    },
    images: { placeholder: "/img/{size}", avatar: "/img/avatar/{name}" },
  };
}

export const echoedHeaders = [
  "accept",
  "accept-language",
  "cache-control",
  "content-length",
  "content-type",
  "if-match",
  "if-modified-since",
  "if-none-match",
  "origin",
  "referer",
  "user-agent",
  "x-correlation-id",
  "x-request-id",
] as const;
export const redactedHeaders = [
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
] as const;
export const maxEchoText = 4_096;
const maxHeaderText = 512;

// UTF-8 length without TextEncoder, which core's portable types do not include
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export interface EchoInputs {
  method: string;
  path: string;
  query: Pairs;
  headers: Pairs | undefined;
  contentType: string | undefined;
  body: string | undefined;
  // bytes the adapter received; without it, the decoded body's UTF-8 length
  bodyBytes: number | undefined;
}

export function echo(inputs: EchoInputs): EngineResponse {
  // a Map, so names such as __proto__ or constructor are plain keys
  const query = new Map<string, string[]>();
  for (const [name, value] of inputs.query) query.set(name, [...(query.get(name) ?? []), value]);

  const headers: Record<string, string> = {};
  const redacted = new Set<string>();
  for (const [rawName, value] of inputs.headers ?? []) {
    const name = rawName.toLowerCase();
    if ((redactedHeaders as readonly string[]).includes(name)) redacted.add(name);
    else if ((echoedHeaders as readonly string[]).includes(name)) {
      headers[name] = [...value].slice(0, maxHeaderText).join("");
    }
  }

  const text = inputs.body ?? "";
  const received = inputs.bodyBytes ?? utf8Bytes(text);
  const isJson = inputs.contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
  let body: unknown = null;
  let bodyText: string | null = null;
  let truncated = false;
  // received bytes that decode to no text, such as a lone byte-order mark, are not JSON
  if (received > 0 && isJson) {
    try {
      body = JSON.parse(text);
    } catch {
      return problem(400, "invalid_json", "The request body is not valid JSON.");
    }
  } else if (text !== "") {
    const characters = [...text];
    truncated = characters.length > maxEchoText;
    bodyText = characters.slice(0, maxEchoText).join("");
  }

  return json(200, {
    method: inputs.method,
    path: inputs.path,
    query: Object.fromEntries(query),
    headers,
    redacted: [...redacted].sort(),
    body,
    bodyText,
    truncated,
    bodyBytes: received,
  } satisfies Echo);
}

export const statusFixtures = [
  200, 201, 202, 204, 400, 401, 403, 404, 405, 408, 409, 410, 413, 415, 422, 429, 500, 501, 502,
  503, 504,
] as const;
type FixtureStatus = (typeof statusFixtures)[number];

const successTitles: Partial<Record<number, string>> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
};

// each status with the headers its definition requires; never cached
export function statusFixture(code: number): EngineResponse {
  if (!(statusFixtures as readonly number[]).includes(code)) {
    return problem(
      400,
      "unsupported_status",
      `This status has no fixture. Use one of: ${statusFixtures.join(", ")}.`,
    );
  }
  const status = code as FixtureStatus;
  const extra: Record<string, string> = { "cache-control": "no-store" };
  if (status === 204) return { status, headers: extra };
  if (status < 300) {
    if (status === 201) extra.location = "/v1/_utils/status/201";
    return json(status, { status, title: successTitles[status] ?? "" }, extra);
  }
  if (status === 401) extra["www-authenticate"] = 'Bearer realm="loadstate"';
  if (status === 405) extra.allow = "GET, HEAD";
  if (status === 429) extra["retry-after"] = "5";
  if (status === 503) extra["retry-after"] = "60";
  const response = problem(
    status as ProblemStatus,
    "status_fixture",
    `A ${status} from the status fixture.`,
  );
  return { ...response, headers: { ...response.headers, ...extra } };
}

// the docs UI: a pinned, integrity-checked script and no inline code
export const scalarVersion = "1.72.4";
export const scalarScript = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${scalarVersion}/dist/browser/standalone.js`;
export const scalarIntegrity =
  "sha384-omTRdD9MbjA1vm12DqRUVvqJlr3VzSixvAdF1Jruu9AJOiJKyTKraIB6DyX+m10M";

export const docsPage = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  "<title>Loadstate API reference</title>",
  "</head>",
  "<body>",
  `<script id="api-reference" data-url="./openapi.json" data-configuration='{"withDefaultFonts":false,"hideClientButton":true}'></script>`,
  `<script src="${scalarScript}" integrity="${scalarIntegrity}" crossorigin="anonymous"></script>`,
  "</body>",
  "</html>",
  "",
].join("\n");

export const docsPolicy = [
  "default-src 'none'",
  `script-src ${scalarScript}`,
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src blob:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");
