import { hashKey } from "./text.js";

export const defaultMaxDelayMs = 10_000;

export const controlNames = [
  "delay",
  "status",
  "scenario",
  "body",
  "step",
  "failRate",
  "fixture",
  "seed",
] as const;
export type ControlName = (typeof controlNames)[number];

export const controlHeaders: Record<ControlName, string> = {
  delay: "X-Mock-Delay",
  status: "X-Mock-Status",
  scenario: "X-Mock-Scenario",
  body: "X-Mock-Body",
  step: "X-Mock-Step",
  failRate: "X-Mock-Fail-Rate",
  fixture: "X-Mock-Fixture",
  seed: "X-Mock-Seed",
};

export const simulatedStatuses = [
  204, 400, 401, 403, 404, 408, 409, 410, 413, 415, 422, 429, 500, 501, 502, 503, 504,
] as const;
export type SimulatedStatus = (typeof simulatedStatuses)[number];

export const scenarioNames = [
  "slow",
  "empty",
  "error",
  "unauthorized",
  "forbidden",
  "notfound",
  "ratelimited",
  "maintenance",
  "timeout",
  "validation-error",
  "retry-then-ok",
  "flaky",
] as const;
export type ScenarioName = (typeof scenarioNames)[number];

export const bodyFaults = ["malformed-json", "empty", "html", "wrong-content-type"] as const;
export type BodyFault = (typeof bodyFaults)[number];

export const retryAfterSeconds: Partial<Record<number, number>> = { 429: 5, 503: 60 };
export const retrySteps = 3;
export const maxSeed = 0xffffffff;

export interface Controls {
  delay?: number | undefined;
  status?: SimulatedStatus | undefined;
  scenario?: ScenarioName | undefined;
  body?: BodyFault | undefined;
  step?: number | undefined;
  failRate?: number | undefined;
  fixture?: string | undefined;
  seed?: number | undefined;
}

export interface ControlIssue {
  field: string;
  code:
    | "unknown_control"
    | "duplicate_control"
    | "invalid_value"
    | "limit_exceeded"
    | "incompatible_controls";
  message: string;
}

export interface ParsedControls {
  controls: Controls;
  // the request's query without the controls, for the route to read
  query: [string, string][];
  // true when any control was given, even one that resolves to the defaults
  given: boolean;
  // the query parameter or header each given control was read from
  fields: Partial<Record<ControlName, string>>;
}

export interface ControlLimits {
  maxDelayMs: number;
  fixtures: readonly string[];
  method: string;
}

type Pairs = Iterable<readonly [string, string]>;

const prefix = "_mock.";
const queryName = (name: ControlName) => `${prefix}${name}`;
const byHeader = new Map(
  controlNames.map((name) => [controlHeaders[name].toLowerCase(), name] as const),
);

export function parseControls(
  query: Pairs,
  headers: Pairs | undefined,
  limits: ControlLimits,
): { ok: true; value: ParsedControls } | { ok: false; issues: ControlIssue[] } {
  const issues: ControlIssue[] = [];
  const rest: [string, string][] = [];
  // raw value and the field name the client used, per control
  const raw = new Map<ControlName, { value: string; field: string }>();
  const repeated = new Set<string>();

  for (const [name, value] of query) {
    if (!name.startsWith(prefix)) {
      rest.push([name, value]);
      continue;
    }
    const control = controlNames.find((known) => queryName(known) === name);
    if (!control) {
      issues.push(unknown(name, controlNames.map(queryName)));
    } else if (raw.has(control)) {
      repeated.add(name);
    } else {
      raw.set(control, { value, field: name });
    }
  }

  const fromQuery = new Set(raw.keys());
  const seenHeaders = new Set<ControlName>();
  for (const [name, value] of headers ?? []) {
    const lower = name.toLowerCase();
    if (!lower.startsWith("x-mock-")) continue;
    const control = byHeader.get(lower);
    if (!control) {
      issues.push(
        unknown(
          name,
          controlNames.map((known) => controlHeaders[known]),
        ),
      );
      continue;
    }
    // a query control wins, and its header is then not read at all
    if (fromQuery.has(control)) continue;
    if (seenHeaders.has(control)) repeated.add(controlHeaders[control]);
    else {
      seenHeaders.add(control);
      raw.set(control, { value, field: controlHeaders[control] });
    }
  }
  for (const field of repeated) {
    issues.push({
      field,
      code: "duplicate_control",
      message: `Control "${field}" must appear at most once.`,
    });
  }

  const controls: Controls = {};
  const read = <T>(name: ControlName, parse: (value: string, field: string) => T | undefined) => {
    const entry = raw.get(name);
    if (!entry || repeated.has(entry.field)) return undefined;
    return parse(entry.value, entry.field);
  };
  const invalid = (field: string, text: string) => {
    issues.push({ field, code: "invalid_value", message: `"${field}" ${text}.` });
    return undefined;
  };

  controls.delay = read("delay", (value, field) => {
    if (!/^\d+$/.test(value)) return invalid(field, "must be a whole number of milliseconds");
    const ms = Number(value);
    if (ms > limits.maxDelayMs) {
      issues.push({
        field,
        code: "limit_exceeded",
        message: `"${field}" must be at most ${limits.maxDelayMs} ms on this host.`,
      });
      return undefined;
    }
    return ms;
  });
  controls.status = read("status", (value, field) =>
    (simulatedStatuses as readonly number[]).includes(Number(value)) && /^\d{3}$/.test(value)
      ? (Number(value) as SimulatedStatus)
      : invalid(field, `must be one of: ${simulatedStatuses.join(", ")}`),
  );
  controls.scenario = read("scenario", (value, field) =>
    (scenarioNames as readonly string[]).includes(value)
      ? (value as ScenarioName)
      : invalid(field, `must be one of: ${scenarioNames.join(", ")}`),
  );
  controls.body = read("body", (value, field) =>
    (bodyFaults as readonly string[]).includes(value)
      ? (value as BodyFault)
      : invalid(field, `must be one of: ${bodyFaults.join(", ")}`),
  );
  controls.step = read("step", (value, field) =>
    /^[1-9]\d*$/.test(value) && Number(value) <= retrySteps
      ? Number(value)
      : invalid(field, `must be a step from 1 to ${retrySteps}`),
  );
  controls.failRate = read("failRate", (value, field) =>
    /^(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+)$/.test(value)
      ? Number(value)
      : invalid(field, "must be a number from 0 to 1"),
  );
  controls.fixture = read("fixture", (value, field) =>
    limits.fixtures.includes(value)
      ? value
      : invalid(field, `must be one of: ${limits.fixtures.join(", ")}`),
  );
  controls.seed = read("seed", (value, field) =>
    /^\d{1,10}$/.test(value) && Number(value) <= maxSeed
      ? Number(value)
      : invalid(field, `must be a whole number from 0 to ${maxSeed}`),
  );

  for (const name of controlNames) if (controls[name] === undefined) delete controls[name];
  const field = (name: ControlName) => raw.get(name)?.field ?? queryName(name);
  const incompatible = (name: ControlName, text: string) =>
    issues.push({
      field: field(name),
      code: "incompatible_controls",
      message: `"${field(name)}" ${text}.`,
    });

  if (controls.step !== undefined && controls.scenario !== "retry-then-ok") {
    incompatible("step", 'works only with the "retry-then-ok" scenario');
  }
  if (controls.scenario === "retry-then-ok" && controls.step === undefined && !raw.has("step")) {
    incompatible("scenario", `"retry-then-ok" needs a step from 1 to ${retrySteps}`);
  }
  if (
    controls.seed !== undefined &&
    controls.failRate === undefined &&
    controls.scenario !== "flaky"
  ) {
    incompatible("seed", 'has no effect without a fail rate or the "flaky" scenario');
  }
  if (controls.body !== undefined) {
    if (limits.method === "HEAD" || limits.method === "DELETE") {
      incompatible("body", `cannot apply to ${limits.method}, which has no response body`);
    } else if (controls.status === 204) {
      incompatible("body", "cannot apply to a 204 response, which has no body");
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  const fields = Object.fromEntries([...raw].map(([name, entry]) => [name, entry.field]));
  return { ok: true, value: { controls, query: rest, given: raw.size > 0, fields } };
}

function unknown(name: string, known: readonly string[]): ControlIssue {
  return {
    field: name,
    code: "unknown_control",
    message: `Unknown control "${name}". Use one of: ${known.join(", ")}.`,
  };
}

// what the request will do once every control and recipe default is resolved
export interface Plan {
  delayMs: number;
  // answer with this status before the route runs
  status?: SimulatedStatus;
  retryAfter?: number;
  body?: BodyFault;
  // GET and HEAD see no records
  empty: boolean;
  // POST, PUT and PATCH answer 422 before the route runs
  validation: boolean;
  applied: [string, string][];
}

export interface PlanInputs {
  controls: Controls;
  method: string;
  // identifies the request for seeded draws: method, path and the route's own query
  requestKey: string;
  maxDelayMs: number;
  random: () => number;
}

// explicit controls first, then the recipe's defaults; the host limit caps everything
export function resolvePlan({
  controls,
  method,
  requestKey,
  maxDelayMs,
  random,
}: PlanInputs): Plan {
  const draw = (salt: string) =>
    controls.seed === undefined
      ? random()
      : Number.parseInt(hashKey(`${controls.seed}|${salt}|${requestKey}`), 36) / 2 ** 53;

  let recipeDelay = 0;
  let recipeStatus: SimulatedStatus | undefined;
  let recipeRetryAfter: number | undefined;
  let recipeFailRate: number | undefined;
  let empty = false;
  let validation = false;

  switch (controls.scenario) {
    case "slow":
      recipeDelay = 2_000;
      break;
    case "empty":
      empty = method === "GET" || method === "HEAD";
      break;
    case "error":
      recipeStatus = 500;
      break;
    case "unauthorized":
      recipeStatus = 401;
      break;
    case "forbidden":
      recipeStatus = 403;
      break;
    case "notfound":
      recipeStatus = 404;
      break;
    case "ratelimited":
      recipeStatus = 429;
      recipeRetryAfter = 5;
      break;
    case "maintenance":
      recipeStatus = 503;
      recipeRetryAfter = 60;
      break;
    case "timeout":
      recipeDelay = maxDelayMs;
      recipeStatus = 504;
      break;
    case "validation-error":
      validation = method === "POST" || method === "PUT" || method === "PATCH";
      break;
    case "retry-then-ok":
      if ((controls.step ?? retrySteps) < retrySteps) {
        recipeStatus = 503;
        recipeRetryAfter = 1;
      }
      break;
    case "flaky":
      recipeDelay = 200 + Math.floor(draw("flaky-delay") * 601);
      recipeFailRate = 0.3;
      break;
    default:
      break;
  }

  const delayMs = Math.min(controls.delay ?? recipeDelay, maxDelayMs);
  const failRate = controls.failRate ?? recipeFailRate;
  let status = controls.status ?? recipeStatus;
  if (status === undefined && failRate !== undefined && draw("fail") < failRate) status = 500;
  const retryAfter =
    status === undefined
      ? undefined
      : status === recipeStatus && recipeRetryAfter !== undefined
        ? recipeRetryAfter
        : retryAfterSeconds[status];

  const applied: [string, string][] = [];
  const add = (name: string, value: unknown) => {
    if (value !== undefined) applied.push([name, String(value)]);
  };
  add("fixture", controls.fixture);
  add("scenario", controls.scenario);
  add("step", controls.step);
  add("status", status ?? (validation ? 422 : undefined));
  add("delay", delayMs > 0 || controls.delay !== undefined ? delayMs : undefined);
  add("body", controls.body);
  add("failRate", failRate);
  add("seed", controls.seed);

  return {
    delayMs,
    ...(status !== undefined ? { status } : {}),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(controls.body !== undefined ? { body: controls.body } : {}),
    empty,
    validation: validation && status === undefined,
    applied,
  };
}
