import type { Image } from "./contracts.js";
import {
  controlHeaders,
  defaultMaxDelayMs,
  type Plan,
  parseControls,
  resolvePlan,
  type SimulatedStatus,
} from "./controls.js";
import { defaultFixture, type FixturePack, fixturePacks } from "./fixtures/index.js";
import { deepFreeze } from "./freeze.js";
import { parseAvatar, parsePlaceholder, renderAvatar, renderPlaceholder } from "./images.js";
import { listRows } from "./list.js";
import {
  parseListQuery,
  parseNoQuery,
  parseReadQuery,
  type QueryResult,
  type View,
} from "./query.js";
import {
  type Relation,
  type Resource,
  type ResourceName,
  resourceNamed,
  resources,
} from "./resources.js";
import {
  type EngineResponse,
  type FieldIssue,
  json,
  type ProblemStatus,
  problem,
} from "./response.js";
import { parseInput } from "./validation.js";
import { type Values, type WriteContext, type WriteRule, writeRules } from "./writes.js";

export type EngineState = "memory" | "stateless";

export interface EngineRequest {
  method: string;
  path: string;
  query?: Iterable<readonly [string, string]> | undefined;
  contentType?: string | undefined;
  body?: string | undefined;
  // trusted absolute base for image URLs; without it they stay root-relative
  baseUrl?: string | undefined;
  // request headers; only the X-Mock-* controls are read
  headers?: Iterable<readonly [string, string]> | undefined;
}

export interface EngineOptions {
  state: EngineState;
  sequences?: Readonly<Record<string, readonly number[]>> | undefined;
  now?: (() => Date) | undefined;
  // the pack a memory engine runs on, and a stateless engine's default pack
  fixture?: string | undefined;
  // the host limit for simulated delays
  maxDelayMs?: number | undefined;
  // source for exploratory draws without a seed
  random?: (() => number) | undefined;
}

export interface Engine {
  readonly state: EngineState;
  handle(request: EngineRequest): EngineResponse;
  reset(): void;
}

export const sequenceStatuses = [400, 401, 403, 404, 409, 429, 500, 502, 503, 504] as const;
type SequenceStatus = (typeof sequenceStatuses)[number];

const defaultNow = () => new Date(Date.UTC(2026, 2, 1, 12));

type Row = { id: number } & Record<string, unknown>;
type Store = Record<ResourceName, Row[]>;
type Params = Record<string, string>;

// the records one request works on: the run's own in memory, a pack's when stateless
interface Data {
  pack: string;
  store: Store;
  nextIds: Record<ResourceName, number>;
  // the empty scenario: reads see no records
  empty: boolean;
}

// what a route sees: the query without controls, and the full query for links
interface RouteRequest extends EngineRequest {
  links: readonly (readonly [string, string])[];
}

interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: string;
  run(params: Params, request: RouteRequest, data: Data): EngineResponse;
}

const route = (method: Route["method"], pattern: string, run: Route["run"]): Route => ({
  method,
  pattern,
  run,
});

export function createEngine({
  state,
  sequences = {},
  now = defaultNow,
  fixture = defaultFixture,
  maxDelayMs = defaultMaxDelayMs,
  random = Math.random,
}: EngineOptions): Engine {
  const runPack = packNamed(fixture);
  if (!Number.isSafeInteger(maxDelayMs) || maxDelayMs < 0) {
    throw new Error(`maxDelayMs must be a whole number of milliseconds, got ${maxDelayMs}.`);
  }
  let run = dataOf(runPack);
  // stateless engines read packs and never change them, so one copy per pack is enough
  const packData = new Map<string, Data>();
  const positions = new Map<string, number>();

  const routes: Route[] = [
    ...resources.flatMap((resource) => [
      route("GET", `/v1/${resource.name}`, (_, request, data) => list(resource, request, data)),
      route("POST", `/v1/${resource.name}`, (_, request, data) =>
        write(resource, "create", undefined, request, data),
      ),
      route("GET", `/v1/${resource.name}/:id`, (params, request, data) =>
        read(resource, params, request, data),
      ),
      route("PUT", `/v1/${resource.name}/:id`, (params, request, data) =>
        write(resource, "replace", params, request, data),
      ),
      route("PATCH", `/v1/${resource.name}/:id`, (params, request, data) =>
        write(resource, "update", params, request, data),
      ),
      route("DELETE", `/v1/${resource.name}/:id`, (params, request, data) =>
        remove(resource, params, request, data),
      ),
      ...Object.entries(resource.relations).map(([name, relation]) =>
        route("GET", `/v1/${resource.name}/:id/${name}`, (params, request, data) =>
          related(resource, relation, params, request, data),
        ),
      ),
    ]),
    route("GET", "/img/:size", (params, request) => {
      const parsed = parsePlaceholder(params.size ?? "", request.query ?? []);
      return parsed.ok ? svg(renderPlaceholder(parsed.value)) : invalidImage(parsed.issues);
    }),
    route("GET", "/img/avatar/:name", (params, request) => {
      const parsed = parseAvatar(params.name ?? "", request.query ?? []);
      return parsed.ok ? svg(renderAvatar(parsed.value)) : invalidImage(parsed.issues);
    }),
  ];
  const plan = readSequences(sequences, routes);

  function reset() {
    run = dataOf(runPack);
    positions.clear();
  }

  function dataFor(pack: string, empty: boolean): Data {
    let data = state === "memory" ? run : packData.get(pack);
    if (!data) {
      data = dataOf(packNamed(pack));
      packData.set(pack, data);
    }
    return empty ? { ...data, empty } : data;
  }

  function handle(request: EngineRequest): EngineResponse {
    const response = dispatch(request);
    const headers = { ...response.headers, "x-mock-state": state };
    // HEAD never carries a body, whatever the outcome
    if (request.method === "HEAD") {
      const { body: _body, rawBody: _raw, ...rest } = response;
      return { ...rest, headers };
    }
    return { ...response, headers };
  }

  function dispatch(request: EngineRequest): EngineResponse {
    const method = request.method === "HEAD" ? "GET" : request.method;
    const matched = routes.flatMap((candidate) => {
      const params = matchPath(candidate.pattern, request.path);
      return params ? [{ route: candidate, params }] : [];
    });

    if (matched.length === 0) return problem(404, "not_found", "No route matches this path.");

    const hit = matched.find((candidate) => candidate.route.method === method);
    if (!hit) {
      const allowed = matched.flatMap((candidate) =>
        candidate.route.method === "GET" ? ["GET", "HEAD"] : [candidate.route.method],
      );
      const response = problem(405, "method_not_allowed", "This method is not allowed here.");
      return { ...response, headers: { ...response.headers, allow: allowed.join(", ") } };
    }

    // read once: a caller may pass a one-shot iterable
    const pairs = [...(request.query ?? [])];
    const parsed = parseControls(pairs, request.headers, {
      maxDelayMs,
      fixtures: Object.keys(fixturePacks),
      method: request.method,
    });
    if (!parsed.ok) {
      return problem(
        400,
        "invalid_controls",
        "The simulation controls are not valid.",
        parsed.issues,
      );
    }
    const { controls, query, given } = parsed.value;
    // links repeat the query controls, so following one keeps the same pack and recipe
    const routeRequest: RouteRequest = { ...request, query, links: pairs };

    if (
      state === "memory" &&
      controls.fixture !== undefined &&
      controls.fixture !== runPack.manifest.id
    ) {
      return problem(
        409,
        "fixture_locked",
        `This run uses ${runPack.manifest.id}. Create a new engine to use ${controls.fixture}.`,
      );
    }

    const resolved = resolvePlan({
      controls,
      method: request.method,
      requestKey: `${request.method} ${request.path}?${query
        .map(([name, value]) => `${name}=${value}`)
        .sort()
        .join("&")}`,
      maxDelayMs,
      random,
    });
    const data = dataFor(controls.fixture ?? runPack.manifest.id, resolved.empty);
    const key = `${hit.route.method} ${hit.route.pattern}`;

    // explicit controls outrank configured sequences, so they do not consume a step
    const response =
      resolved.status !== undefined
        ? simulatedStatus(resolved.status, resolved.retryAfter, controls.scenario)
        : resolved.validation
          ? simulatedValidation(hit.route.pattern)
          : (nextFailure(key) ?? hit.route.run(hit.params, routeRequest, data));
    const shaped = given ? applyPlan(response, resolved) : response;
    // a sequenced route answers by run position, so no cache may keep any of its answers
    return plan.has(key)
      ? { ...shaped, headers: { ...shaped.headers, "cache-control": "no-store" } }
      : shaped;
  }

  function nextFailure(key: string): EngineResponse | undefined {
    const steps = plan.get(key);
    if (!steps) return undefined;
    const position = positions.get(key) ?? 0;
    const status = steps[position];
    if (status === undefined) return undefined;
    positions.set(key, position + 1);
    return problem(
      status,
      "simulated_failure",
      `Simulated failure ${position + 1} of ${steps.length} for ${key}.`,
    );
  }

  function find(data: Data, name: ResourceName, id: string | undefined): Row | undefined {
    if (data.empty) return undefined;
    return data.store[name].find((row) => row.id === Number(id));
  }

  function list(resource: Resource, request: RouteRequest, data: Data): EngineResponse {
    return listOf(resource, data.empty ? [] : data.store[resource.name], request, data);
  }

  function related(
    resource: Resource,
    relation: Relation,
    params: Params,
    request: RouteRequest,
    data: Data,
  ): EngineResponse {
    const child = resourceNamed(relation.resource);
    const parent = find(data, resource.name, params.id);
    // the query is checked first, so a bad query on a missing parent is still 400
    const rows = parent
      ? data.store[relation.resource].filter((row) => row[relation.foreignKey] === parent.id)
      : [];
    return listOf(child, rows, request, data, parent ? undefined : resource);
  }

  function listOf(
    resource: Resource,
    rows: readonly Row[],
    request: RouteRequest,
    data: Data,
    missingParent?: Resource,
  ): EngineResponse {
    const params = [...(request.query ?? [])];
    const query = parseListQuery(resource, params, { path: request.path, pack: data.pack });
    if (!query.ok) return invalidQuery(query);
    if (missingParent) return notFound(missingParent);
    const page = listRows(resource, rows, query.value, {
      path: request.path,
      baseUrl: request.baseUrl,
      params: request.links,
    });
    return json(
      200,
      {
        data: page.data.map((row) => shape(resource, row, request.baseUrl, query.value.view, data)),
        meta: page.meta,
      },
      { link: page.link },
    );
  }

  function read(
    resource: Resource,
    params: Params,
    request: EngineRequest,
    data: Data,
  ): EngineResponse {
    const query = parseReadQuery(resource, request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    const row = find(data, resource.name, params.id);
    return row
      ? json(200, shape(resource, row, request.baseUrl, query.value, data))
      : notFound(resource);
  }

  // projection keeps the selected fields, then each expansion adds a full related record
  function shape(
    resource: Resource,
    row: Row,
    baseUrl: string | undefined,
    view: View,
    data: Data,
  ): Record<string, unknown> {
    const shown = present(resource, row, baseUrl);
    if (view.fields === undefined && view.expand.length === 0) return shown;
    const out: Record<string, unknown> = view.fields
      ? Object.fromEntries(view.fields.map((field) => [field, shown[field]]))
      : { ...shown };
    for (const name of view.expand) {
      const reference = resource.expansions[name];
      if (!reference) continue;
      const id = row[reference.field];
      const target =
        id === null ? undefined : data.store[reference.resource].find((r) => r.id === id);
      out[name] = target ? present(resourceNamed(reference.resource), target, baseUrl) : null;
    }
    return out;
  }

  function write(
    resource: Resource,
    mode: "create" | "replace" | "update",
    params: Params | undefined,
    request: EngineRequest,
    data: Data,
  ): EngineResponse {
    const query = parseNoQuery(request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    const existing = params ? find(data, resource.name, params.id) : undefined;
    if (params && !existing) return notFound(resource);

    const body = readJson(request);
    if ("response" in body) return body.response;

    const rule = writeRules[resource.name];
    const schema = mode === "update" ? rule.input.partial() : rule.input;
    const parsed = parseInput(schema, body.input, readOnlyFields(resource, rule));
    if (!parsed.ok) return invalidBody(parsed.issues);

    // PATCH merges onto the stored writable fields; POST and PUT start from the defaults
    const values: Values =
      existing && mode === "update"
        ? { ...writableOf(existing, rule), ...parsed.value }
        : { ...rule.defaults, ...parsed.value };
    const context: WriteContext = {
      id: existing?.id ?? data.nextIds[resource.name],
      at: now().toISOString(),
      existing,
      rows: (name) => data.store[name],
    };

    const issues = [
      ...referenceIssues(rule, values, context),
      ...(rule.check?.(values, context) ?? []),
    ];
    if (issues.length > 0) return invalidBody(issues);

    const conflicts = uniqueIssues(resource, rule, values, context);
    if (conflicts.length > 0) {
      return problem(
        409,
        "conflict",
        `Another ${resource.singular.toLowerCase()} already uses this value.`,
        conflicts,
      );
    }

    const record = deepFreeze(rule.build(values, context));
    // stateless runs answer as if saved but keep nothing
    if (state === "memory") {
      const rows = data.store[resource.name];
      if (existing) {
        rows[rows.indexOf(existing)] = record;
      } else {
        rows.push(record);
        data.nextIds[resource.name] += 1;
      }
    }
    const shown = present(resource, record, request.baseUrl);
    const path = `/v1/${resource.name}/${record.id}`;
    // a stateless create on another pack points at that pack, not the default one
    const location =
      data.pack === runPack.manifest.id ? path : `${path}?_mock.fixture=${data.pack}`;
    return existing ? json(200, shown) : json(201, shown, { location });
  }

  function remove(
    resource: Resource,
    params: Params,
    request: EngineRequest,
    data: Data,
  ): EngineResponse {
    const query = parseNoQuery(request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    const existing = find(data, resource.name, params.id);
    if (!existing) return notFound(resource);

    // deletes are restrictive: dependents must go first
    const dependents = Object.entries(resource.relations).flatMap(([name, relation]) => {
      const count = data.store[relation.resource].filter(
        (row) => row[relation.foreignKey] === existing.id,
      ).length;
      return count > 0 ? [`${name} (${count})`] : [];
    });
    if (dependents.length > 0) {
      return problem(
        409,
        "has_dependents",
        `This ${resource.singular.toLowerCase()} still has ${dependents.join(", ")}. Delete or move them first.`,
      );
    }

    if (state === "memory") {
      data.store[resource.name] = data.store[resource.name].filter((row) => row.id !== existing.id);
    }
    return { status: 204, headers: {} };
  }

  return { state, handle, reset };
}

function packNamed(id: string): FixturePack {
  const pack = fixturePacks[id];
  if (!pack) {
    throw new Error(
      `Unknown fixture pack "${id}". Use one of: ${Object.keys(fixturePacks).join(", ")}.`,
    );
  }
  return pack;
}

function dataOf(pack: FixturePack): Data {
  const store = freshStore(pack);
  return { pack: pack.manifest.id, store, nextIds: nextIdsOf(store), empty: false };
}

function simulatedStatus(
  status: SimulatedStatus,
  retryAfter: number | undefined,
  scenario: string | undefined,
): EngineResponse {
  if (status === 204) return { status: 204, headers: {} };
  const source = scenario ? `the ${scenario} scenario` : "_mock.status";
  const response = problem(
    status as ProblemStatus,
    "simulated_status",
    `Simulated ${status} from ${source}.`,
  );
  return retryAfter === undefined
    ? response
    : { ...response, headers: { ...response.headers, "retry-after": String(retryAfter) } };
}

// one field error per required input field, as if each had been rejected
function simulatedValidation(pattern: string): EngineResponse {
  const name = pattern.split("/")[2] as ResourceName;
  const shape = writeRules[name].input.shape;
  const required = Object.keys(shape).filter((field) => !shape[field]?.isOptional());
  return problem(
    422,
    "validation_failed",
    "The request body has invalid fields.",
    required.map((field) => ({
      field,
      code: "simulated",
      message: `"${field}" was rejected by the validation-error scenario.`,
    })),
  );
}

const htmlPage = (status: number) =>
  `<!doctype html><html><head><title>${status} Error</title></head><body><h1>${status} Error</h1><p>A proxy answered instead of the API.</p></body></html>`;

// body faults replace the final body; headers say which controls shaped the response
function applyPlan(response: EngineResponse, plan: Plan): EngineResponse {
  const headers: Record<string, string> = {
    ...response.headers,
    "x-mock-applied": plan.applied.map(([name, value]) => `${name}=${value}`).join(", "),
    "cache-control": "no-store",
  };
  const shaped: EngineResponse = { ...response, headers };
  if (plan.delayMs > 0) shaped.delayMs = plan.delayMs;
  // an image's body is its SVG text; a record's is its JSON
  const text =
    response.rawBody ?? (response.body === undefined ? "" : JSON.stringify(response.body));
  switch (plan.body) {
    case "malformed-json":
      return { ...shaped, rawBody: text.slice(0, Math.max(1, Math.floor(text.length / 2))) };
    case "empty":
      return { ...shaped, rawBody: "" };
    case "html":
      return {
        ...shaped,
        headers: { ...headers, "content-type": "text/html; charset=utf-8" },
        rawBody: htmlPage(response.status),
      };
    case "wrong-content-type":
      return {
        ...shaped,
        headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
        rawBody: text,
      };
    default:
      return shaped;
  }
}

function freshStore(pack: FixturePack): Store {
  const entries = resources.map((resource) => [resource.name, [...pack.data[resource.name]]]);
  return Object.fromEntries(entries) as Store;
}

function nextIdsOf(store: Store): Record<ResourceName, number> {
  const entries = resources.map((resource) => [
    resource.name,
    Math.max(0, ...store[resource.name].map((row) => row.id)) + 1,
  ]);
  return Object.fromEntries(entries) as Record<ResourceName, number>;
}

// fields a record has but a client cannot write
const readOnlyCache = new Map<ResourceName, ReadonlySet<string>>();
function readOnlyFields(resource: Resource, rule: WriteRule): ReadonlySet<string> {
  let fields = readOnlyCache.get(resource.name);
  if (!fields) {
    fields = new Set(
      Object.keys(resource.schema.shape).filter((key) => !(key in rule.input.shape)),
    );
    readOnlyCache.set(resource.name, fields);
  }
  return fields;
}

function writableOf(row: Row, rule: WriteRule): Values {
  return Object.fromEntries(Object.keys(rule.input.shape).map((key) => [key, row[key]]));
}

function readJson(request: EngineRequest): { input: unknown } | { response: EngineResponse } {
  if (!isJson(request.contentType)) {
    return {
      response: problem(
        415,
        "unsupported_media_type",
        "Send the request body as application/json.",
      ),
    };
  }
  try {
    return { input: JSON.parse(request.body ?? "") };
  } catch {
    return {
      response: problem(400, "invalid_json", "The request body is empty or not valid JSON."),
    };
  }
}

function invalidBody(issues: FieldIssue[]): EngineResponse {
  return problem(422, "validation_failed", "The request body has invalid fields.", issues);
}

function referenceIssues(rule: WriteRule, values: Values, context: WriteContext): FieldIssue[] {
  return Object.entries(rule.references).flatMap(([field, target]): FieldIssue[] => {
    const value = values[field];
    if (value === null || value === undefined) return [];
    if (context.rows(target).some((row) => row.id === value)) return [];
    const noun = resourceNamed(target).singular.toLowerCase();
    return [
      {
        field,
        code: "invalid_reference",
        message: `"${field}" must refer to an existing ${noun}.`,
      },
    ];
  });
}

function uniqueIssues(
  resource: Resource,
  rule: WriteRule,
  values: Values,
  context: WriteContext,
): FieldIssue[] {
  const noun = resource.singular.toLowerCase();
  return rule.unique.flatMap((field): FieldIssue[] => {
    const value = String(values[field]).toLowerCase();
    const taken = context
      .rows(resource.name)
      .some((row) => row.id !== context.id && String(row[field]).toLowerCase() === value);
    return taken
      ? [{ field, code: "already_used", message: `"${field}" is already used by another ${noun}.` }]
      : [];
  });
}

function notFound(resource: Resource): EngineResponse {
  return problem(404, "not_found", `No ${resource.singular.toLowerCase()} has this id.`);
}

// stored image paths are root-relative; responses join them with the base URL
function present(resource: Resource, row: Row, baseUrl: string | undefined): Row {
  if (baseUrl === undefined || resource.images.length === 0) return row;
  const base = baseUrl.replace(/\/+$/, "");
  const absolute = (image: Image): Image => ({ ...image, url: `${base}${image.url}` });
  const copy: Row = { ...row };
  for (const field of resource.images) {
    const value = copy[field];
    copy[field] = Array.isArray(value) ? value.map(absolute) : absolute(value as Image);
  }
  return copy;
}

function invalidQuery(result: Extract<QueryResult<unknown>, { ok: false }>): EngineResponse {
  return problem(400, "invalid_query", "The query string is not valid.", result.issues);
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

// a malformed id matches no route, so it is a 404 for every method
const paramFormats: Record<string, RegExp> = {
  id: /^[1-9]\d*$/,
  // any plain number is a size, so the range check can answer 400 instead of 404
  size: /^(?:0|[1-9]\d*)(?:x(?:0|[1-9]\d*))?$/,
  name: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
};

// an SVG opened directly is a document on the API's origin, so it may not load or run anything
const imageHeaders = {
  "content-type": "image/svg+xml",
  "cache-control": "public, max-age=604800",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  // a cached image must not answer a request whose control headers ask for something else
  vary: Object.values(controlHeaders).join(", "),
};

function svg(text: string): EngineResponse {
  return { status: 200, headers: { ...imageHeaders }, rawBody: text };
}

function invalidImage(issues: FieldIssue[]): EngineResponse {
  return problem(400, "invalid_image", "The image request is not valid.", issues);
}

function matchPath(pattern: string, path: string): Params | undefined {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return undefined;

  const params: Params = {};
  for (const [i, part] of want.entries()) {
    const actual = got[i] ?? "";
    if (part.startsWith(":")) {
      const name = part.slice(1);
      if (!(paramFormats[name] ?? /./).test(actual)) return undefined;
      params[name] = actual;
    } else if (part !== actual) {
      return undefined;
    }
  }
  return params;
}

function readSequences(
  sequences: Readonly<Record<string, readonly number[]>>,
  routes: readonly Route[],
): Map<string, SequenceStatus[]> {
  const keys = routes.map((candidate) => `${candidate.method} ${candidate.pattern}`);
  const plan = new Map<string, SequenceStatus[]>();

  for (const [key, steps] of Object.entries(sequences)) {
    if (!keys.includes(key)) {
      throw new Error(`Unknown sequence route "${key}". Use one of: ${keys.join(", ")}.`);
    }
    plan.set(
      key,
      steps.map((status) => {
        if (!isSequenceStatus(status)) {
          throw new Error(
            `Status ${status} in sequence "${key}" is not supported. Use one of: ${sequenceStatuses.join(", ")}.`,
          );
        }
        return status;
      }),
    );
  }
  return plan;
}

function isSequenceStatus(status: number): status is SequenceStatus {
  return (sequenceStatuses as readonly number[]).includes(status);
}
