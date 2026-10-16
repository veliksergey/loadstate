import { z } from "zod";
import { type CursorPayload, decodeCursor } from "./cursor.js";
import { type FieldKind, fieldKind, isRanged, isScalar } from "./fields.js";
import type { Resource } from "./resources.js";
import { fold, hashKey } from "./text.js";

export const defaultLimit = 20;
export const maxLimit = 100;
export const maxSortFields = 4;
export const maxSearchLength = 100;
export const maxFilterLength = 200;

export type QueryIssueCode =
  | "unknown_parameter"
  | "duplicate_parameter"
  | "invalid_integer"
  | "out_of_range"
  | "conflicting_parameter"
  | "invalid_value"
  | "unknown_field"
  | "unsupported_operator"
  | "invalid_cursor"
  | "cursor_mismatch";

export interface QueryIssue {
  field: string;
  code: QueryIssueCode;
  message: string;
}

export type QueryResult<T> = { ok: true; value: T } | { ok: false; issues: QueryIssue[] };

export type PaginationMode = "offset" | "page" | "cursor";
export const paginationModes = ["offset", "page", "cursor"] as const;
export type FilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
export const rangeOperators = ["gt", "gte", "lt", "lte"] as const;
export type FilterValue = string | number | boolean | null;

export interface Filter {
  field: string;
  operator: FilterOperator;
  value: FilterValue;
  kind: FieldKind;
}

export interface SortKey {
  field: string;
  descending: boolean;
  kind: FieldKind;
}

export interface View {
  // undefined keeps every field
  fields: readonly string[] | undefined;
  expand: readonly string[];
}

export interface ListQuery {
  mode: PaginationMode;
  // page size in every mode; `perPage` in page mode
  limit: number;
  offset: number;
  page: number;
  cursor: CursorPayload | undefined;
  withTotal: boolean;
  terms: readonly string[];
  filters: readonly Filter[];
  // the requested keys, then `id` ascending unless the request sorted on it
  sort: readonly SortKey[];
  // what a cursor must match: route, pack, search, filters and sort
  binding: string;
  view: View;
}

export interface ListScope {
  path: string;
  pack: string;
}

type Params = Iterable<readonly [string, string]>;

// the parameters that belong to each pagination mode
const modeParameters: Record<PaginationMode, readonly string[]> = {
  offset: ["limit", "offset"],
  page: ["page", "perPage"],
  cursor: ["limit", "cursor", "withTotal"],
};
const pagingNames = new Set([
  "pagination",
  "limit",
  "offset",
  "page",
  "perPage",
  "cursor",
  "withTotal",
]);
const viewNames = new Set(["fields", "expand"]);

interface Collected {
  values: Map<string, string>;
  // names in first-seen order, each once
  names: string[];
  duplicated: Set<string>;
}

function collect(params: Params): Collected {
  const values = new Map<string, string>();
  const names: string[] = [];
  const duplicated = new Set<string>();
  for (const [name, value] of params) {
    if (values.has(name)) duplicated.add(name);
    else {
      values.set(name, value);
      names.push(name);
    }
  }
  return { values, names, duplicated };
}

const issue = (field: string, code: QueryIssueCode, message: string): QueryIssue => ({
  field,
  code,
  message,
});

const duplicateIssue = (field: string) =>
  issue(field, "duplicate_parameter", `Query parameter "${field}" must appear at most once.`);

export function unknownParameter(field: string): QueryIssue {
  return issue(field, "unknown_parameter", `Unknown query parameter "${field}".`);
}

const kindCache = new WeakMap<Resource, Map<string, FieldKind>>();
export function kindOf(resource: Resource, field: string): FieldKind {
  let kinds = kindCache.get(resource);
  if (!kinds) {
    kinds = new Map();
    kindCache.set(resource, kinds);
  }
  let kind = kinds.get(field);
  if (!kind) {
    const schema = resource.schema.shape[field];
    if (!schema) throw new Error(`"${field}" is not a ${resource.singular} field.`);
    kind = fieldKind(schema as z.ZodType);
    kinds.set(field, kind);
  }
  return kind;
}

export function selectableFields(resource: Resource): string[] {
  return Object.keys(resource.schema.shape).filter((field) => isScalar(kindOf(resource, field)));
}

// every query parameter name a list of this resource accepts, in documentation order
export function listParameterNames(resource: Resource): string[] {
  return [
    "pagination",
    "limit",
    "offset",
    "page",
    "perPage",
    "cursor",
    "withTotal",
    "q",
    "sort",
    "fields",
    ...(Object.keys(resource.expansions).length > 0 ? ["expand"] : []),
    ...resource.filters.flatMap((field) => [
      field,
      `${field}_ne`,
      ...(isRanged(kindOf(resource, field)) ? rangeOperators.map((op) => `${field}_${op}`) : []),
    ]),
  ];
}

export function readParameterNames(resource: Resource): string[] {
  return ["fields", ...(Object.keys(resource.expansions).length > 0 ? ["expand"] : [])];
}

export function parseListQuery(
  resource: Resource,
  params: Params,
  scope: ListScope,
): QueryResult<ListQuery> {
  const { values, names, duplicated } = collect(params);
  const issues: QueryIssue[] = [];
  const filterNames: string[] = [];

  const expandable = Object.keys(resource.expansions).length > 0;
  for (const name of names) {
    if (name === "expand" && !expandable) issues.push(unknownParameter(name));
    if (pagingNames.has(name) || viewNames.has(name) || name === "q" || name === "sort") continue;
    const classified = classifyFilter(resource, name);
    if (classified.issue) issues.push(classified.issue);
    else filterNames.push(name);
  }
  for (const name of duplicated) issues.push(duplicateIssue(name));

  // a repeated value is ambiguous, so it is reported once and not parsed
  const raw = (name: string) => (duplicated.has(name) ? undefined : values.get(name));
  const mode = paginationMode(names, raw("pagination"), issues);
  // a parameter of another mode is reported as a conflict only, not parsed too
  const own = (name: string) => (modeParameters[mode].includes(name) ? raw(name) : undefined);
  const limitName = mode === "page" ? "perPage" : "limit";
  const limit = readInteger(limitName, own(limitName), defaultLimit, 1, maxLimit, issues);
  const offset = readInteger("offset", own("offset"), 0, 0, Number.MAX_SAFE_INTEGER, issues);
  const page = readInteger("page", own("page"), 1, 1, Number.MAX_SAFE_INTEGER, issues);
  const withTotal = readBoolean("withTotal", own("withTotal"), issues) ?? false;

  const terms = readSearch(raw("q"), issues);
  const filters = filterNames.flatMap((name) => {
    const value = raw(name);
    return value === undefined ? [] : readFilter(resource, name, value, issues);
  });
  const sort = readSort(resource, raw("sort"), issues);
  const view = readView(resource, raw("fields"), expandable ? raw("expand") : undefined, issues);

  const binding = hashKey(
    JSON.stringify([
      scope.path,
      scope.pack,
      terms,
      filters
        .map((filter) => [filter.field, filter.operator, filter.value])
        .sort((a, b) => (`${a[0]}_${a[1]}` < `${b[0]}_${b[1]}` ? -1 : 1)),
      sort.map((key) => [key.field, key.descending]),
    ]),
  );

  const rawCursor = raw("cursor");
  let cursor: CursorPayload | undefined;
  if (rawCursor !== undefined && issues.length === 0) {
    const checked = readCursor(resource, rawCursor, binding, sort);
    if ("issue" in checked) issues.push(checked.issue);
    else cursor = checked.cursor;
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: { mode, limit, offset, page, cursor, withTotal, terms, filters, sort, binding, view },
  };
}

export function parseReadQuery(resource: Resource, params: Params): QueryResult<View> {
  const { values, names, duplicated } = collect(params);
  const issues: QueryIssue[] = [];
  const allowed = new Set(readParameterNames(resource));
  for (const name of names) if (!allowed.has(name)) issues.push(unknownParameter(name));
  for (const name of duplicated) issues.push(duplicateIssue(name));
  const raw = (name: string) => (duplicated.has(name) ? undefined : values.get(name));
  const view = readView(resource, raw("fields"), raw("expand"), issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: view };
}

// for routes that take no query parameters
export function parseNoQuery(params: Params): QueryResult<null> {
  const unknown = new Set<string>();
  for (const [name] of params) unknown.add(name);
  return unknown.size > 0
    ? { ok: false, issues: [...unknown].map(unknownParameter) }
    : { ok: true, value: null };
}

function classifyFilter(resource: Resource, name: string): { issue?: QueryIssue } {
  if (resource.filters.includes(name)) return {};
  const match = /^(.+)_(ne|gt|gte|lt|lte)$/.exec(name);
  const base = match?.[1] ?? name;
  const operator = match?.[2];
  if (match && resource.filters.includes(base)) {
    if (operator === "ne" || isRanged(kindOf(resource, base))) return {};
    return {
      issue: issue(
        name,
        "unsupported_operator",
        `"${base}" does not support "_${operator}". Use "${base}" or "${base}_ne".`,
      ),
    };
  }
  if (base in resource.schema.shape) {
    const allowed =
      resource.filters.length > 0
        ? `Filter on: ${resource.filters.join(", ")}.`
        : `${capitalize(resource.name)} have no filters.`;
    return { issue: issue(name, "unknown_parameter", `"${base}" is not a filter. ${allowed}`) };
  }
  return { issue: unknownParameter(name) };
}

function paginationMode(
  names: readonly string[],
  explicit: string | undefined,
  issues: QueryIssue[],
): PaginationMode {
  const given = names.filter((name) => pagingNames.has(name) && name !== "pagination");
  // without an explicit choice, page, perPage or cursor picks the mode; withTotal only refines it
  const inferred: PaginationMode = given.some((name) => name === "page" || name === "perPage")
    ? "page"
    : given.some((name) => name === "cursor")
      ? "cursor"
      : "offset";
  if (explicit !== undefined && !(paginationModes as readonly string[]).includes(explicit)) {
    // one error is enough; conflicts against an unknown mode would only add noise
    issues.push(
      issue(
        "pagination",
        "invalid_value",
        `"pagination" must be one of: ${paginationModes.join(", ")}.`,
      ),
    );
    return inferred;
  }
  const mode = (explicit as PaginationMode | undefined) ?? inferred;
  for (const name of given) {
    if (modeParameters[mode].includes(name)) continue;
    issues.push(
      issue(
        name,
        "conflicting_parameter",
        name === "withTotal"
          ? `"withTotal" applies only to cursor pagination; offset and page pagination always include the total.`
          : `"${name}" does not apply to ${mode} pagination. Use only ${modeParameters[mode]
              .map((own) => `"${own}"`)
              .join(", ")} with it.`,
      ),
    );
  }
  return mode;
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
    issues.push(
      issue(
        field,
        "invalid_integer",
        `"${field}" must be a whole number written with digits only.`,
      ),
    );
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    issues.push(issue(field, "out_of_range", `"${field}" must be between ${min} and ${max}.`));
    return fallback;
  }
  return value;
}

function readBoolean(field: string, raw: string | undefined, issues: QueryIssue[]) {
  if (raw === undefined) return undefined;
  if (raw === "true" || raw === "false") return raw === "true";
  issues.push(issue(field, "invalid_value", `"${field}" must be true or false.`));
  return undefined;
}

function readSearch(raw: string | undefined, issues: QueryIssue[]): string[] {
  if (raw === undefined) return [];
  if (characters(raw) > maxSearchLength) {
    issues.push(issue("q", "invalid_value", `"q" must be at most ${maxSearchLength} characters.`));
    return [];
  }
  const terms = fold(raw)
    .split(/\s+/)
    .filter((term) => term !== "");
  if (terms.length === 0) issues.push(issue("q", "invalid_value", `"q" must not be empty.`));
  return terms;
}

function readFilter(resource: Resource, name: string, raw: string, issues: QueryIssue[]): Filter[] {
  const match = /^(.+)_(ne|gt|gte|lt|lte)$/.exec(name);
  const field = match && resource.filters.includes(match[1] ?? "") ? (match[1] ?? name) : name;
  const operator = (field === name ? "eq" : match?.[2]) as FilterOperator;
  const kind = kindOf(resource, field);
  const value = filterValue(name, raw, kind, operator);
  if (typeof value === "object" && value !== null) {
    issues.push(value);
    return [];
  }
  return [{ field, operator, value, kind }];
}

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
// the form every stored date-time has: UTC with exactly three fractional digits
const storedDateTime = z.iso.datetime({ precision: 3 });

// a QueryIssue result means the value was rejected
function filterValue(
  name: string,
  raw: string,
  kind: FieldKind,
  operator: FilterOperator,
): FilterValue | QueryIssue {
  const invalid = (text: string) => issue(name, "invalid_value", `"${name}" ${text}.`);
  if (kind.nullable && raw === "null") {
    return operator === "eq" || operator === "ne"
      ? null
      : invalid("cannot be compared with null; use the field itself or _ne");
  }
  switch (kind.type) {
    case "integer": {
      const value = Number(raw);
      return /^-?\d+$/.test(raw) && Number.isSafeInteger(value)
        ? value
        : invalid(`must be a whole number${kind.nullable ? " or null" : ""}`);
    }
    case "number": {
      const value = Number(raw);
      return /^-?\d+(\.\d+)?$/.test(raw) && Number.isFinite(value)
        ? value
        : invalid("must be a number");
    }
    case "boolean":
      return raw === "true" || raw === "false" ? raw === "true" : invalid("must be true or false");
    case "enum":
      return kind.values.includes(raw) ? raw : invalid(`must be one of: ${kind.values.join(", ")}`);
    case "date":
      return isoDate.safeParse(raw).success
        ? raw
        : invalid(`must be a date in YYYY-MM-DD form${kind.nullable ? " or null" : ""}`);
    case "datetime":
      // a bare date means midnight UTC at its start
      if (isoDate.safeParse(raw).success) return `${raw}T00:00:00.000Z`;
      // Date keeps milliseconds only, so finer fractions are refused rather than truncated
      return isoDateTime.safeParse(raw).success && !/\.\d{4,}/.test(raw)
        ? new Date(raw).toISOString()
        : invalid(
            `must be a date (YYYY-MM-DD) or an ISO 8601 date-time with at most millisecond precision${kind.nullable ? ", or null" : ""}`,
          );
    default:
      if (raw === "") return invalid("must not be empty");
      return characters(raw) <= maxFilterLength
        ? raw
        : invalid(`must be at most ${maxFilterLength} characters`);
  }
}

function readSort(resource: Resource, raw: string | undefined, issues: QueryIssue[]): SortKey[] {
  const tieBreak = (keys: SortKey[]) =>
    keys.some((key) => key.field === "id")
      ? keys
      : [...keys, { field: "id", descending: false, kind: kindOf(resource, "id") }];
  if (raw === undefined) return tieBreak([]);
  const items = raw.split(",");
  const invalid = (text: string) => issues.push(issue("sort", "invalid_value", `"sort" ${text}.`));
  if (items.some((item) => !/^-?[A-Za-z][A-Za-z0-9]*$/.test(item))) {
    invalid(
      'must list field names separated by commas, each optionally prefixed with "-", such as "-createdAt,title"',
    );
    return tieBreak([]);
  }
  if (items.length > maxSortFields) {
    invalid(`takes at most ${maxSortFields} fields`);
    return tieBreak([]);
  }
  const keys: SortKey[] = [];
  for (const item of items) {
    const field = item.replace(/^-/, "");
    if (!resource.sortable.includes(field)) {
      issues.push(
        issue(
          "sort",
          "unknown_field",
          `"sort" cannot use "${field}". Sort on: ${resource.sortable.join(", ")}.`,
        ),
      );
    } else if (keys.some((key) => key.field === field)) {
      invalid(`lists "${field}" more than once`);
    } else {
      keys.push({ field, descending: item.startsWith("-"), kind: kindOf(resource, field) });
    }
  }
  return tieBreak(keys);
}

function readView(
  resource: Resource,
  rawFields: string | undefined,
  rawExpand: string | undefined,
  issues: QueryIssue[],
): View {
  const selectable = selectableFields(resource);
  const fields = readList("fields", rawFields, issues, (name) => {
    if (selectable.includes(name)) return undefined;
    return name in resource.schema.shape
      ? issue(
          "fields",
          "invalid_value",
          `"fields" cannot select "${name}": only top-level scalar fields can be selected.`,
        )
      : issue(
          "fields",
          "unknown_field",
          `"fields" cannot select "${name}". Select from: ${selectable.join(", ")}.`,
        );
  });
  const expansions = Object.keys(resource.expansions);
  const expand = readList("expand", rawExpand, issues, (name) =>
    expansions.includes(name)
      ? undefined
      : issue(
          "expand",
          "unknown_field",
          `"expand" cannot use "${name}". Expand: ${expansions.join(", ")}.`,
        ),
  );
  return {
    // the record's own field order, whatever order the request used
    fields: fields && Object.keys(resource.schema.shape).filter((name) => fields.includes(name)),
    expand: expand ? expansions.filter((name) => expand.includes(name)) : [],
  };
}

function readList(
  field: string,
  raw: string | undefined,
  issues: QueryIssue[],
  check: (name: string) => QueryIssue | undefined,
): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = raw.split(",");
  if (items.some((item) => !/^[A-Za-z][A-Za-z0-9]*$/.test(item))) {
    issues.push(
      issue(
        field,
        "invalid_value",
        `"${field}" must list names separated by commas, such as "id,title".`,
      ),
    );
    return undefined;
  }
  const seen: string[] = [];
  for (const item of items) {
    const problem = check(item);
    if (problem) issues.push(problem);
    else if (seen.includes(item)) {
      issues.push(issue(field, "invalid_value", `"${field}" lists "${item}" more than once.`));
    } else seen.push(item);
  }
  return seen;
}

const restart = "Start again without a cursor.";

function readCursor(
  resource: Resource,
  raw: string,
  binding: string,
  sort: readonly SortKey[],
): { cursor: CursorPayload } | { issue: QueryIssue } {
  const payload = decodeCursor(raw);
  if (!payload) {
    return {
      issue: issue("cursor", "invalid_cursor", `"cursor" is not a valid cursor. ${restart}`),
    };
  }
  if (payload.h !== binding) {
    return {
      issue: issue(
        "cursor",
        "cursor_mismatch",
        `"cursor" belongs to a different list, search, filter or sort. Repeat the parameters of the request that returned it, or ${restart.toLowerCase()}`,
      ),
    };
  }
  const fits =
    payload.t.length === sort.length &&
    sort.every((key, i) => fitsField(resource, key, payload.t[i] ?? null));
  return fits
    ? { cursor: payload }
    : { issue: issue("cursor", "invalid_cursor", `"cursor" is not a valid cursor. ${restart}`) };
}

// a boundary value must be one the record itself could hold, in its stored form
function fitsField(resource: Resource, key: SortKey, value: unknown): boolean {
  const schema = resource.schema.shape[key.field] as z.ZodType | undefined;
  if (!schema?.safeParse(value).success) return false;
  return key.kind.type !== "datetime" || value === null || storedDateTime.safeParse(value).success;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// code points, as Zod and JSON Schema maxLength count, not UTF-16 units
const characters = (text: string) => [...text].length;
