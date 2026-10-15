export const defaultLimit = 20;
export const maxLimit = 100;

export interface OffsetQuery {
  limit: number;
  offset: number;
}

export type QueryIssueCode =
  | "unknown_parameter"
  | "duplicate_parameter"
  | "invalid_integer"
  | "out_of_range";

export interface QueryIssue {
  field: string;
  code: QueryIssueCode;
  message: string;
}

export type QueryResult<T> = { ok: true; value: T } | { ok: false; issues: QueryIssue[] };

type Params = Iterable<readonly [string, string]>;

const known = new Set(["limit", "offset"]);

export function parseOffsetQuery(params: Params): QueryResult<OffsetQuery> {
  const values = new Map<string, string>();
  const unknown = new Set<string>();
  const duplicated = new Set<string>();

  for (const [name, value] of params) {
    if (!known.has(name)) unknown.add(name);
    else if (values.has(name)) duplicated.add(name);
    else values.set(name, value);
  }

  const issues = [...unknown].map(unknownParameter);
  for (const field of duplicated) {
    issues.push({
      field,
      code: "duplicate_parameter",
      message: `Query parameter "${field}" must appear at most once.`,
    });
  }

  // a duplicated value is ambiguous, so it is reported once and not parsed
  const raw = (field: string) => (duplicated.has(field) ? undefined : values.get(field));
  const limit = readInteger("limit", raw("limit"), defaultLimit, 1, maxLimit, issues);
  const offset = readInteger("offset", raw("offset"), 0, 0, Number.MAX_SAFE_INTEGER, issues);

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: { limit, offset } };
}

// for routes that take no query parameters yet
export function parseNoQuery(params: Params): QueryResult<null> {
  const unknown = new Set<string>();
  for (const [name] of params) unknown.add(name);
  return unknown.size > 0
    ? { ok: false, issues: [...unknown].map(unknownParameter) }
    : { ok: true, value: null };
}

function unknownParameter(field: string): QueryIssue {
  return { field, code: "unknown_parameter", message: `Unknown query parameter "${field}".` };
}

function readInteger(
  field: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  issues: QueryIssue[],
): number {
  if (raw === undefined) return fallback;

  if (!/^\d+$/.test(raw)) {
    issues.push({
      field,
      code: "invalid_integer",
      message: `"${field}" must be a whole number written with digits only.`,
    });
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    issues.push({
      field,
      code: "out_of_range",
      message: `"${field}" must be between ${min} and ${max}.`,
    });
    return fallback;
  }
  return value;
}
