import { type CursorValue, encodeCursor } from "./cursor.js";
import type { FieldKind } from "./fields.js";
import { type ListMeta, paginate } from "./paginate.js";
import type { Filter, ListQuery, SortKey } from "./query.js";
import type { Resource } from "./resources.js";
import { fold } from "./text.js";

type Row = { id: number } & Record<string, unknown>;
type Pair = readonly [string, string];

export interface ListLinks {
  path: string;
  // trusted absolute base; links stay root-relative without one
  baseUrl: string | undefined;
  params: readonly Pair[];
}

export interface ListPage {
  data: Row[];
  meta: ListMeta;
  link: string;
}

export function listRows(
  resource: Resource,
  rows: readonly Row[],
  query: ListQuery,
  links: ListLinks,
): ListPage {
  let matched = rows;
  if (query.terms.length > 0) {
    matched = matched.filter((row) => matchesSearch(resource, row, query.terms));
  }
  if (query.filters.length > 0) {
    matched = matched.filter((row) => query.filters.every((filter) => matchesFilter(row, filter)));
  }
  const keyed = matched.map((row) => ({ row, key: keyOf(row, query.sort) }));
  keyed.sort((a, b) => compareKeys(a.key, b.key, query.sort));

  const total = keyed.length;
  const href = linker(links, query);

  if (query.mode === "offset") {
    const { data, meta } = paginate(keyed, query);
    const last = total === 0 ? 0 : Math.floor((total - 1) / query.limit) * query.limit;
    return {
      data: data.map((entry) => entry.row),
      meta,
      link: header([
        ["first", href({ limit: query.limit, offset: 0 })],
        query.offset > 0
          ? [
              "prev",
              href({
                limit: query.limit,
                offset: Math.max(0, Math.min(query.offset - query.limit, last)),
              }),
            ]
          : undefined,
        meta.hasMore
          ? ["next", href({ limit: query.limit, offset: query.offset + query.limit })]
          : undefined,
        ["last", href({ limit: query.limit, offset: last })],
      ]),
    };
  }

  if (query.mode === "page") {
    const totalPages = Math.ceil(total / query.limit);
    const start = (query.page - 1) * query.limit;
    const lastPage = Math.max(1, totalPages);
    const hasMore = query.page < totalPages;
    return {
      data: keyed.slice(start, start + query.limit).map((entry) => entry.row),
      meta: { page: query.page, perPage: query.limit, total, totalPages, hasMore },
      link: header([
        ["first", href({ page: 1, perPage: query.limit })],
        query.page > 1
          ? ["prev", href({ page: Math.min(query.page - 1, lastPage), perPage: query.limit })]
          : undefined,
        hasMore ? ["next", href({ page: query.page + 1, perPage: query.limit })] : undefined,
        ["last", href({ page: lastPage, perPage: query.limit })],
      ]),
    };
  }

  // cursor mode: keyset pagination on the full sort tuple, which ends in the unique id
  const { cursor } = query;
  const firstAfter = (inclusive: boolean) => {
    if (!cursor) return 0;
    const index = keyed.findIndex((entry) => {
      const order = compareKeys(entry.key, cursor.t, query.sort);
      return inclusive ? order >= 0 : order > 0;
    });
    return index === -1 ? total : index;
  };
  let start: number;
  let end: number;
  if (cursor?.d === "prev") {
    end = firstAfter(true);
    start = Math.max(0, end - query.limit);
  } else {
    start = firstAfter(false);
    end = Math.min(total, start + query.limit);
  }
  const page = keyed.slice(start, end);
  const first = page[0];
  const lastEntry = page[page.length - 1];
  const nextCursor =
    lastEntry && end < total
      ? encodeCursor({ v: 1, h: query.binding, d: "next", t: lastEntry.key })
      : null;
  const prevCursor =
    first && start > 0 ? encodeCursor({ v: 1, h: query.binding, d: "prev", t: first.key }) : null;
  return {
    data: page.map((entry) => entry.row),
    meta: {
      limit: query.limit,
      nextCursor,
      prevCursor,
      hasMore: nextCursor !== null,
      ...(query.withTotal ? { total } : {}),
    },
    link: header([
      ["first", href({ limit: query.limit })],
      prevCursor ? ["prev", href({ limit: query.limit, cursor: prevCursor })] : undefined,
      nextCursor ? ["next", href({ limit: query.limit, cursor: nextCursor })] : undefined,
    ]),
  };
}

const pagingNames = new Set(["limit", "offset", "page", "perPage", "cursor"]);

// keeps the request's other parameters in order and appends the page's own
function linker(links: ListLinks, query: ListQuery) {
  const kept = links.params.filter(([name]) => !pagingNames.has(name));
  // a first cursor page has no cursor, so it must name the mode itself
  const named =
    query.mode === "cursor" && !kept.some(([name]) => name === "pagination")
      ? [["pagination", "cursor"] as const]
      : [];
  const base = (links.baseUrl ?? "").replace(/\/+$/, "");
  return (paging: Record<string, string | number>) => {
    const pairs = [
      ...kept,
      ...named,
      ...Object.entries(paging).map(([k, v]) => [k, String(v)] as const),
    ];
    const search = pairs
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${base}${links.path}?${search}`;
  };
}

function header(entries: ([string, string] | undefined)[]): string {
  return entries
    .filter((entry): entry is [string, string] => entry !== undefined)
    .map(([rel, url]) => `<${url}>; rel="${rel}"`)
    .join(", ");
}

function keyOf(row: Row, sort: readonly SortKey[]): CursorValue[] {
  return sort.map((key) => (row[key.field] ?? null) as CursorValue);
}

// nulls sort last in both directions; `id` ends every sort, so no two rows tie
export function compareKeys(
  a: readonly CursorValue[],
  b: readonly CursorValue[],
  sort: readonly SortKey[],
): number {
  for (const [i, key] of sort.entries()) {
    const x = a[i] ?? null;
    const y = b[i] ?? null;
    if (x === y) continue;
    if (x === null) return 1;
    if (y === null) return -1;
    const order = compareValues(x, y, key.kind);
    if (order !== 0) return key.descending ? -order : order;
  }
  return 0;
}

function compareValues(a: unknown, b: unknown, kind: FieldKind): number {
  switch (kind.type) {
    case "integer":
    case "number":
      return Math.sign((a as number) - (b as number));
    case "boolean":
      return Number(a) - Number(b);
    case "enum":
      return Math.sign(kind.values.indexOf(String(a)) - kind.values.indexOf(String(b)));
    case "string": {
      const order = textOrder(folded(String(a)), folded(String(b)));
      return order !== 0 ? order : textOrder(String(a), String(b));
    }
    case "datetime":
      // a filter instant can fall outside four-digit years, where ISO text stops sorting
      return Math.sign(Date.parse(String(a)) - Date.parse(String(b)));
    default:
      // YYYY-MM-DD dates order as text
      return textOrder(String(a), String(b));
  }
}

const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// folding is the costly step, so each distinct string is folded once
const foldCache = new Map<string, string>();
function folded(text: string): string {
  let value = foldCache.get(text);
  if (value === undefined) {
    if (foldCache.size >= 10_000) foldCache.clear();
    value = fold(text);
    foldCache.set(text, value);
  }
  return value;
}

function matchesFilter(row: Row, filter: Filter): boolean {
  const value = row[filter.field] ?? null;
  if (filter.kind.type === "tags") {
    const has = Array.isArray(value) && value.includes(filter.value);
    return filter.operator === "eq" ? has : !has;
  }
  if (filter.operator === "eq") return value === filter.value;
  if (filter.operator === "ne") return value !== filter.value;
  // null never matches a range
  if (value === null) return false;
  const order = compareValues(value, filter.value, filter.kind);
  switch (filter.operator) {
    case "gt":
      return order > 0;
    case "gte":
      return order >= 0;
    case "lt":
      return order < 0;
    default:
      return order <= 0;
  }
}

// records are frozen, so a record's folded search text never changes
const haystacks = new WeakMap<object, string>();
function matchesSearch(resource: Resource, row: Row, terms: readonly string[]): boolean {
  let text = haystacks.get(row);
  if (text === undefined) {
    text = resource.search
      .map((field) => {
        const value = row[field];
        return fold(Array.isArray(value) ? value.join(" ") : String(value ?? ""));
      })
      // a term has no whitespace, so it cannot match across two fields
      .join("\n");
    haystacks.set(row, text);
  }
  return terms.every((term) => text.includes(term));
}
