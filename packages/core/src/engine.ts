import type { Image } from "./contracts.js";
import { corePack } from "./fixtures/index.js";
import { deepFreeze } from "./freeze.js";
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
import { type EngineResponse, type FieldIssue, json, problem } from "./response.js";
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
}

export interface EngineOptions {
  state: EngineState;
  sequences?: Readonly<Record<string, readonly number[]>> | undefined;
  now?: (() => Date) | undefined;
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

interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: string;
  run(params: Params, request: EngineRequest): EngineResponse;
}

const route = (method: Route["method"], pattern: string, run: Route["run"]): Route => ({
  method,
  pattern,
  run,
});

export function createEngine({ state, sequences = {}, now = defaultNow }: EngineOptions): Engine {
  let store = freshStore();
  let nextIds = nextIdsOf(store);
  const positions = new Map<string, number>();

  const routes: Route[] = [
    ...resources.flatMap((resource) => [
      route("GET", `/v1/${resource.name}`, (_, request) => list(resource, request)),
      route("POST", `/v1/${resource.name}`, (_, request) =>
        write(resource, "create", undefined, request),
      ),
      route("GET", `/v1/${resource.name}/:id`, (params, request) =>
        read(resource, params, request),
      ),
      route("PUT", `/v1/${resource.name}/:id`, (params, request) =>
        write(resource, "replace", params, request),
      ),
      route("PATCH", `/v1/${resource.name}/:id`, (params, request) =>
        write(resource, "update", params, request),
      ),
      route("DELETE", `/v1/${resource.name}/:id`, (params, request) =>
        remove(resource, params, request),
      ),
      ...Object.entries(resource.relations).map(([name, relation]) =>
        route("GET", `/v1/${resource.name}/:id/${name}`, (params, request) =>
          related(resource, relation, params, request),
        ),
      ),
    ]),
  ];
  const plan = readSequences(sequences, routes);

  function reset() {
    store = freshStore();
    nextIds = nextIdsOf(store);
    positions.clear();
  }
  reset();

  function handle(request: EngineRequest): EngineResponse {
    const response = dispatch(request);
    const headers = { ...response.headers, "x-mock-state": state };
    // HEAD never carries a body, whatever the outcome
    return request.method === "HEAD"
      ? { status: response.status, headers }
      : { ...response, headers };
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

    const key = `${hit.route.method} ${hit.route.pattern}`;
    return nextFailure(key) ?? hit.route.run(hit.params, request);
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

  function find(name: ResourceName, id: string | undefined): Row | undefined {
    return store[name].find((row) => row.id === Number(id));
  }

  function list(resource: Resource, request: EngineRequest): EngineResponse {
    return listOf(resource, store[resource.name], request);
  }

  function related(
    resource: Resource,
    relation: Relation,
    params: Params,
    request: EngineRequest,
  ): EngineResponse {
    const child = resourceNamed(relation.resource);
    const parent = find(resource.name, params.id);
    // the query is checked first, so a bad query on a missing parent is still 400
    const rows = parent
      ? store[relation.resource].filter((row) => row[relation.foreignKey] === parent.id)
      : [];
    return listOf(child, rows, request, parent ? undefined : resource);
  }

  function listOf(
    resource: Resource,
    rows: readonly Row[],
    request: EngineRequest,
    missingParent?: Resource,
  ): EngineResponse {
    const params = [...(request.query ?? [])];
    const query = parseListQuery(resource, params, {
      path: request.path,
      pack: corePack.manifest.id,
    });
    if (!query.ok) return invalidQuery(query);
    if (missingParent) return notFound(missingParent);
    const page = listRows(resource, rows, query.value, {
      path: request.path,
      baseUrl: request.baseUrl,
      params,
    });
    return json(
      200,
      {
        data: page.data.map((row) => shape(resource, row, request.baseUrl, query.value.view)),
        meta: page.meta,
      },
      { link: page.link },
    );
  }

  function read(resource: Resource, params: Params, request: EngineRequest): EngineResponse {
    const query = parseReadQuery(resource, request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    const row = find(resource.name, params.id);
    return row ? json(200, shape(resource, row, request.baseUrl, query.value)) : notFound(resource);
  }

  // projection keeps the selected fields, then each expansion adds a full related record
  function shape(
    resource: Resource,
    row: Row,
    baseUrl: string | undefined,
    view: View,
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
      const target = id === null ? undefined : store[reference.resource].find((r) => r.id === id);
      out[name] = target ? present(resourceNamed(reference.resource), target, baseUrl) : null;
    }
    return out;
  }

  function write(
    resource: Resource,
    mode: "create" | "replace" | "update",
    params: Params | undefined,
    request: EngineRequest,
  ): EngineResponse {
    const query = parseNoQuery(request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    const existing = params ? find(resource.name, params.id) : undefined;
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
      id: existing?.id ?? nextIds[resource.name],
      at: now().toISOString(),
      existing,
      rows: (name) => store[name],
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
      const rows = store[resource.name];
      if (existing) {
        rows[rows.indexOf(existing)] = record;
      } else {
        rows.push(record);
        nextIds[resource.name] += 1;
      }
    }
    const shown = present(resource, record, request.baseUrl);
    return existing
      ? json(200, shown)
      : json(201, shown, { location: `/v1/${resource.name}/${record.id}` });
  }

  function remove(resource: Resource, params: Params, request: EngineRequest): EngineResponse {
    const query = parseNoQuery(request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    const existing = find(resource.name, params.id);
    if (!existing) return notFound(resource);

    // deletes are restrictive: dependents must go first
    const dependents = Object.entries(resource.relations).flatMap(([name, relation]) => {
      const count = store[relation.resource].filter(
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
      store[resource.name] = store[resource.name].filter((row) => row.id !== existing.id);
    }
    return { status: 204, headers: {} };
  }

  return { state, handle, reset };
}

function freshStore(): Store {
  const entries = resources.map((resource) => [resource.name, [...corePack.data[resource.name]]]);
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
const paramFormats: Record<string, RegExp> = { id: /^[1-9]\d*$/ };

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
