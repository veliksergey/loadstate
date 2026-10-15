import { paginate } from "./paginate.js";
import { parseNoQuery, parseOffsetQuery, type QueryResult } from "./query.js";
import { type EngineResponse, json, problem } from "./response.js";
import { users as fixture, parseUserCreate, type User } from "./users.js";

export type EngineState = "memory" | "stateless";

export interface EngineRequest {
  method: string;
  path: string;
  query?: Iterable<readonly [string, string]> | undefined;
  contentType?: string | undefined;
  body?: string | undefined;
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

interface Route {
  method: "GET" | "POST";
  pattern: string;
  run(params: Record<string, string>, request: EngineRequest): EngineResponse;
}

export function createEngine({ state, sequences = {}, now = defaultNow }: EngineOptions): Engine {
  let records: User[] = [];
  let nextId = 1;
  const positions = new Map<string, number>();

  const routes: Route[] = [
    { method: "GET", pattern: "/v1/users", run: (_, request) => listUsers(request) },
    {
      method: "GET",
      pattern: "/v1/users/:id",
      run: (params, request) => readUser(params, request),
    },
    { method: "POST", pattern: "/v1/users", run: (_, request) => createUser(request) },
  ];
  const plan = readSequences(sequences, routes);

  function reset() {
    records = [...fixture];
    nextId = Math.max(0, ...records.map((user) => user.id)) + 1;
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
    const matched = routes.flatMap((route) => {
      const params = matchPath(route.pattern, request.path);
      return params ? [{ route, params }] : [];
    });

    if (matched.length === 0) return problem(404, "not_found", "No route matches this path.");

    const hit = matched.find(({ route }) => route.method === method);
    if (!hit) {
      const allowed = matched.flatMap(({ route }) =>
        route.method === "GET" ? ["GET", "HEAD"] : [route.method],
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

  function listUsers(request: EngineRequest): EngineResponse {
    const query = parseOffsetQuery(request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    return json(200, paginate(records, query.value));
  }

  function readUser(params: Record<string, string>, request: EngineRequest): EngineResponse {
    const query = parseNoQuery(request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    const user = records.find((r) => r.id === Number(params.id));
    return user ? json(200, user) : problem(404, "not_found", "No user has this id.");
  }

  function createUser(request: EngineRequest): EngineResponse {
    const query = parseNoQuery(request.query ?? []);
    if (!query.ok) return invalidQuery(query);
    if (!isJson(request.contentType)) {
      return problem(415, "unsupported_media_type", "Send the request body as application/json.");
    }

    let input: unknown;
    try {
      input = JSON.parse(request.body ?? "");
    } catch {
      return problem(400, "invalid_json", "The request body is empty or not valid JSON.");
    }

    const parsed = parseUserCreate(input);
    if (!parsed.ok) {
      return problem(
        422,
        "validation_failed",
        "The request body has invalid fields.",
        parsed.issues,
      );
    }

    const at = now().toISOString();
    const user: User = Object.freeze({ id: nextId, ...parsed.value, createdAt: at, updatedAt: at });
    // stateless runs answer as if saved but keep nothing
    if (state === "memory") {
      records.push(user);
      nextId += 1;
    }
    return json(201, user, { location: `/v1/users/${user.id}` });
  }

  return { state, handle, reset };
}

function invalidQuery(result: Extract<QueryResult<unknown>, { ok: false }>): EngineResponse {
  return problem(400, "invalid_query", "The query string is not valid.", result.issues);
}

function isJson(contentType: string | undefined): boolean {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/json";
}

// a malformed id matches no route, so it is a 404 for every method
const paramFormats: Record<string, RegExp> = { id: /^[1-9]\d*$/ };

function matchPath(pattern: string, path: string): Record<string, string> | undefined {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return undefined;

  const params: Record<string, string> = {};
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
  const keys = routes.map((route) => `${route.method} ${route.pattern}`);
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
