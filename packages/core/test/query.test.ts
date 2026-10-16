import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  decodeCursor,
  encodeCursor,
  fieldKind,
  type ListQuery,
  listParameterNames,
  maxCursorLength,
  parseListQuery,
  parseNoQuery,
  parseReadQuery,
  type Resource,
  type ResourceName,
  readParameterNames,
  resourceNamed,
  resources,
} from "../src/index.js";

const scope = { path: "/v1/test", pack: "core@1" };
const parse = (name: ResourceName, query: string, at = scope) =>
  parseListQuery(resourceNamed(name), new URLSearchParams(query), at);
const value = (name: ResourceName, query: string): ListQuery => {
  const result = parse(name, query);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
};
const issues = (name: ResourceName, query: string, at = scope) => {
  const result = parse(name, query, at);
  return result.ok ? [] : result.issues;
};
const codes = (name: ResourceName, query: string, at = scope) =>
  issues(name, query, at).map((issue) => [issue.field, issue.code]);
const messages = (name: ResourceName, query: string) =>
  issues(name, query).map((issue) => issue.message);

describe("pagination modes", () => {
  it("defaults to offset pagination, 20 from the start", () => {
    expect(value("users", "")).toMatchObject({ mode: "offset", limit: 20, offset: 0 });
  });

  it("accepts plain integers at the bounds", () => {
    expect(value("users", "limit=1&offset=0")).toMatchObject({ limit: 1, offset: 0 });
    expect(value("users", "limit=100&offset=9007199254740991")).toMatchObject({
      limit: 100,
      offset: Number.MAX_SAFE_INTEGER,
    });
    expect(value("users", "limit=007")).toMatchObject({ limit: 7 });
  });

  it.each(["", "abc", "1.5", "-1", "+5", "1e2", "0x10", " 5", "5 ", "١٢"])(
    "rejects %j as a limit instead of coercing it",
    (raw) => {
      expect(codes("users", `limit=${encodeURIComponent(raw)}`)).toEqual([
        ["limit", "invalid_integer"],
      ]);
    },
  );

  it("rejects values outside the allowed range", () => {
    expect(codes("users", "limit=0")).toEqual([["limit", "out_of_range"]]);
    expect(codes("users", "limit=101")).toEqual([["limit", "out_of_range"]]);
    expect(codes("users", "offset=9007199254740992")).toEqual([["offset", "out_of_range"]]);
    expect(codes("users", `offset=1${"0".repeat(400)}`)).toEqual([["offset", "out_of_range"]]);
    expect(messages("users", "limit=500")).toEqual(['"limit" must be between 1 and 100.']);
  });

  it("chooses page mode from page or perPage, or when named", () => {
    expect(value("users", "page=3")).toMatchObject({ mode: "page", page: 3, limit: 20 });
    expect(value("users", "perPage=5")).toMatchObject({ mode: "page", page: 1, limit: 5 });
    expect(value("users", "pagination=page")).toMatchObject({ mode: "page", page: 1 });
    expect(codes("users", "page=0")).toEqual([["page", "out_of_range"]]);
    expect(codes("users", "perPage=101")).toEqual([["perPage", "out_of_range"]]);
  });

  it("chooses cursor mode from cursor, or when named", () => {
    expect(value("users", "pagination=cursor&limit=5")).toMatchObject({
      mode: "cursor",
      limit: 5,
      cursor: undefined,
      withTotal: false,
    });
    expect(value("users", "pagination=cursor&withTotal=true")).toMatchObject({
      mode: "cursor",
      withTotal: true,
    });
    expect(codes("users", "pagination=cursor&withTotal=yes")).toEqual([
      ["withTotal", "invalid_value"],
    ]);
  });

  it.each(["withTotal=true", "withTotal=false", "page=2&withTotal=true"])(
    "does not let %s choose cursor mode",
    (query) => {
      expect(codes("users", query)).toEqual([["withTotal", "conflicting_parameter"]]);
    },
  );

  it.each([
    ["page=2&offset=10", [["offset", "conflicting_parameter"]]],
    ["page=2&limit=10", [["limit", "conflicting_parameter"]]],
    ["perPage=5&cursor=abc", [["cursor", "conflicting_parameter"]]],
    ["pagination=offset&page=2", [["page", "conflicting_parameter"]]],
    [
      "pagination=page&limit=5&offset=1",
      [
        ["limit", "conflicting_parameter"],
        ["offset", "conflicting_parameter"],
      ],
    ],
    ["pagination=cursor&offset=5", [["offset", "conflicting_parameter"]]],
    ["withTotal=true&pagination=offset", [["withTotal", "conflicting_parameter"]]],
    ["pagination=pages&page=2", [["pagination", "invalid_value"]]],
  ])("rejects mixed modes in %j", (query, expected) => {
    expect(codes("users", query)).toEqual(expected);
  });

  it("explains a conflict", () => {
    expect(messages("users", "page=2&offset=10")).toEqual([
      '"offset" does not apply to page pagination. Use only "page", "perPage" with it.',
    ]);
    expect(messages("users", "pagination=page&withTotal=true")).toEqual([
      '"withTotal" applies only to cursor pagination; offset and page pagination always include the total.',
    ]);
  });

  it("reports a repeated parameter once without parsing its values", () => {
    expect(codes("users", "limit=5&limit=abc&limit=7")).toEqual([["limit", "duplicate_parameter"]]);
  });

  it("reports every problem in one result", () => {
    expect(codes("users", "nope=1&offset=1&offset=2&limit=0")).toEqual([
      ["nope", "unknown_parameter"],
      ["offset", "duplicate_parameter"],
      ["limit", "out_of_range"],
    ]);
  });
});

describe("search", () => {
  it("folds case and accents and splits terms", () => {
    expect(value("users", `q=${encodeURIComponent("  Zoë   ÅNGSTRÖM ")}`).terms).toEqual([
      "zoe",
      "angstrom",
    ]);
    expect(value("users", "q=%EF%BC%A1").terms).toEqual(["a"]);
  });

  it.each([
    ["", '"q" must not be empty.'],
    ["   ", '"q" must not be empty.'],
    ["x".repeat(101), '"q" must be at most 100 characters.'],
  ])("rejects q=%j", (raw, message) => {
    expect(issues("users", `q=${encodeURIComponent(raw)}`)).toEqual([
      { field: "q", code: "invalid_value", message },
    ]);
  });

  it("accepts 100 characters", () => {
    expect(value("users", `q=${"x".repeat(100)}`).terms).toEqual(["x".repeat(100)]);
  });

  it("counts characters, not UTF-16 units", () => {
    const emoji = (count: number) => encodeURIComponent("😀".repeat(count));
    expect(value("users", `q=${emoji(100)}`).terms).toEqual(["😀".repeat(100)]);
    expect(codes("users", `q=${emoji(101)}`)).toEqual([["q", "invalid_value"]]);
    expect(value("products", `brand=${encodeURIComponent("😀".repeat(200))}`).filters).toHaveLength(
      1,
    );
    expect(codes("products", `brand=${encodeURIComponent("😀".repeat(201))}`)).toEqual([
      ["brand", "invalid_value"],
    ]);
  });
});

describe("filters", () => {
  const filter = (name: ResourceName, query: string) => value(name, query).filters;

  it.each([
    ["posts", "userId=7", "userId", "eq", 7],
    ["products", "rating_gte=4.5", "rating", "gte", 4.5],
    ["products", "priceMinor_lt=-1", "priceMinor", "lt", -1],
    ["products", "status=active", "status", "eq", "active"],
    ["products", "brand=null", "brand", "eq", "null"],
    ["todos", "completed=false", "completed", "eq", false],
    ["todos", "dueDate_lte=2026-02-28", "dueDate", "lte", "2026-02-28"],
    ["todos", "dueDate=null", "dueDate", "eq", null],
    ["comments", "parentId_ne=null", "parentId", "ne", null],
    ["users", "createdAt_gte=2025-06-01", "createdAt", "gte", "2025-06-01T00:00:00.000Z"],
    [
      "users",
      `createdAt_lt=${encodeURIComponent("2025-06-01T02:30:00+02:00")}`,
      "createdAt",
      "lt",
      "2025-06-01T00:30:00.000Z",
    ],
    ["posts", "tags=react", "tags", "eq", "react"],
    ["posts", "status_ne=draft", "status", "ne", "draft"],
  ] as const)("parses %s %s by the field type", (name, query, field, operator, parsed) => {
    expect(filter(name, query)).toEqual([
      expect.objectContaining({ field, operator, value: parsed }),
    ]);
  });

  it.each([
    ["posts", "userId=7.5", '"userId" must be a whole number.'],
    ["comments", "parentId=x", '"parentId" must be a whole number or null.'],
    ["products", "rating=high", '"rating" must be a number.'],
    ["products", "status=gone", '"status" must be one of: active, draft, discontinued.'],
    ["todos", "completed=1", '"completed" must be true or false.'],
    ["todos", "dueDate=2026-13-01", '"dueDate" must be a date in YYYY-MM-DD form or null.'],
    [
      "users",
      "createdAt_gt=yesterday",
      '"createdAt_gt" must be a date (YYYY-MM-DD) or an ISO 8601 date-time with at most millisecond precision.',
    ],
    [
      "comments",
      "parentId_gt=null",
      '"parentId_gt" cannot be compared with null; use the field itself or _ne.',
    ],
    [
      "users",
      "createdAt_lt=2024-11-21T06:25:04.1111Z",
      '"createdAt_lt" must be a date (YYYY-MM-DD) or an ISO 8601 date-time with at most millisecond precision.',
    ],
    ["products", `rating_lt=${"9".repeat(309)}`, '"rating_lt" must be a number.'],
    ["products", "brand=", '"brand" must not be empty.'],
    ["products", `brand=${"b".repeat(201)}`, '"brand" must be at most 200 characters.'],
  ] as const)("rejects %s %s", (name, query, message) => {
    expect(issues(name, query)).toEqual([
      { field: query.split("=")[0], code: "invalid_value", message },
    ]);
  });

  it("allows ranges only on numbers and dates", () => {
    expect(issues("products", "status_gte=active")).toEqual([
      {
        field: "status_gte",
        code: "unsupported_operator",
        message: '"status" does not support "_gte". Use "status" or "status_ne".',
      },
    ]);
    expect(codes("posts", "tags_lt=a")).toEqual([["tags_lt", "unsupported_operator"]]);
    expect(codes("todos", "completed_gt=true")).toEqual([["completed_gt", "unsupported_operator"]]);
  });

  it("names the filters when a field is not one", () => {
    expect(messages("users", "name=Ada")).toEqual([
      '"name" is not a filter. Filter on: role, status, locale, createdAt.',
    ]);
    expect(messages("users", "name_ne=Ada")).toEqual([
      '"name" is not a filter. Filter on: role, status, locale, createdAt.',
    ]);
    expect(messages("users", "nickname=Ada")).toEqual(['Unknown query parameter "nickname".']);
  });

  it("rejects a repeated filter", () => {
    expect(codes("products", "status=active&status=draft")).toEqual([
      ["status", "duplicate_parameter"],
    ]);
  });
});

describe("sort", () => {
  const sort = (name: ResourceName, query: string) =>
    value(name, query).sort.map((key) => `${key.descending ? "-" : ""}${key.field}`);

  it("appends id as the last tie-breaker", () => {
    expect(sort("posts", "")).toEqual(["id"]);
    expect(sort("posts", "sort=-createdAt,title")).toEqual(["-createdAt", "title", "id"]);
    expect(sort("posts", "sort=-id")).toEqual(["-id"]);
    expect(sort("posts", "sort=title,id")).toEqual(["title", "id"]);
  });

  it.each([
    ["sort=", "invalid_value"],
    ["sort=title,", "invalid_value"],
    ["sort=-", "invalid_value"],
    ["sort=--title", "invalid_value"],
    ["sort=title,title", "invalid_value"],
    ["sort=-title,title", "invalid_value"],
    ["sort=body", "unknown_field"],
    ["sort=id,title,createdAt,updatedAt,publishedAt", "invalid_value"],
  ])("rejects %s", (query, code) => {
    expect(codes("posts", query)).toEqual([["sort", code]]);
  });

  it("names the sortable fields", () => {
    expect(messages("posts", "sort=body")).toEqual([
      '"sort" cannot use "body". Sort on: id, title, readingTimeMinutes, publishedAt, createdAt, updatedAt.',
    ]);
  });
});

describe("fields and expand", () => {
  it("keeps the record's field order", () => {
    expect(value("users", "fields=email,id,name").view).toEqual({
      fields: ["id", "name", "email"],
      expand: [],
    });
  });

  it.each([
    [
      "fields=avatar",
      "invalid_value",
      '"fields" cannot select "avatar": only top-level scalar fields can be selected.',
    ],
    [
      "fields=nickname",
      "unknown_field",
      '"fields" cannot select "nickname". Select from: id, name, username, email, role, status, company, locale, timezone, createdAt, updatedAt.',
    ],
    ["fields=id,id", "invalid_value", '"fields" lists "id" more than once.'],
    [
      "fields=",
      "invalid_value",
      '"fields" must list names separated by commas, such as "id,title".',
    ],
  ])("rejects users %s", (query, code, message) => {
    expect(issues("users", query)).toEqual([{ field: "fields", code, message }]);
  });

  it("expands only the resource's own references", () => {
    expect(value("comments", "expand=parent,author").view.expand).toEqual(["author", "parent"]);
    expect(issues("posts", "expand=comments")).toEqual([
      {
        field: "expand",
        code: "unknown_field",
        message: '"expand" cannot use "comments". Expand: author.',
      },
    ]);
    expect(codes("users", "expand=posts")).toEqual([["expand", "unknown_parameter"]]);
  });

  it("accepts only fields and expand on a single read", () => {
    const read = (name: ResourceName, query: string) =>
      parseReadQuery(resourceNamed(name), new URLSearchParams(query));
    expect(read("posts", "fields=id,title&expand=author")).toEqual({
      ok: true,
      value: { fields: ["id", "title"], expand: ["author"] },
    });
    expect(read("posts", "limit=2&sort=title")).toEqual({
      ok: false,
      issues: [
        { field: "limit", code: "unknown_parameter", message: 'Unknown query parameter "limit".' },
        { field: "sort", code: "unknown_parameter", message: 'Unknown query parameter "sort".' },
      ],
    });
    expect(read("users", "expand=posts").ok).toBe(false);
  });
});

describe("cursors", () => {
  const bound = (query: string, at = scope) => {
    const result = parse("posts", query, at);
    if (!result.ok) throw new Error("query should parse");
    return result.value.binding;
  };

  it.each([
    [
      "posts",
      "sort=title,publishedAt,createdAt,updatedAt",
      [
        "😀".repeat(200),
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        999_999,
      ],
    ],
    [
      "users",
      "sort=name,username,email,createdAt",
      [
        "😀".repeat(100),
        "u".repeat(50),
        `${"e".repeat(242)}@example.com`,
        "2026-01-01T00:00:00.000Z",
        999_999,
      ],
    ],
  ] as const)("fits the longest %s sort values in one cursor", (name, query, tuple) => {
    const result = parse(name, query);
    if (!result.ok) throw new Error("query should parse");
    const payload = { v: 1 as const, h: result.value.binding, d: "next" as const, t: [...tuple] };
    const text = encodeCursor(payload);
    expect(text.length).toBeLessThanOrEqual(maxCursorLength);
    expect(decodeCursor(text)).toEqual(payload);
    expect(codes(name, `${query}&cursor=${text}`)).toEqual([]);
  });

  it("round-trips a payload with Unicode and stays under the size limit", () => {
    const payload = {
      v: 1 as const,
      h: bound("sort=title,publishedAt,createdAt,updatedAt"),
      d: "next" as const,
      t: ["中".repeat(200), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", null, 999_999],
    };
    const text = encodeCursor(payload);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text.length).toBeLessThanOrEqual(maxCursorLength);
    expect(decodeCursor(text)).toEqual(payload);
  });

  it.each([
    ["an empty string", ""],
    ["text that is not base64url", "not a cursor!"],
    ["base64url that is not JSON", "bm90IGpzb24"],
    ["bytes that are not UTF-8", "_w"],
    ["JSON of the wrong shape", encodeCursorText('{"v":2}')],
    ["an oversized string", "A".repeat(maxCursorLength + 1)],
  ])("rejects %s", (_name, cursor) => {
    expect(issues("posts", `cursor=${encodeURIComponent(cursor)}`)).toEqual([
      {
        field: "cursor",
        code: "invalid_cursor",
        message: '"cursor" is not a valid cursor. Start again without a cursor.',
      },
    ]);
  });

  it("rejects a cursor whose sort values do not fit the sort", () => {
    const h = bound("sort=title&pagination=cursor");
    const wrong = encodeCursor({ v: 1, h, d: "next", t: [5, 1] });
    expect(codes("posts", `sort=title&cursor=${wrong}`)).toEqual([["cursor", "invalid_cursor"]]);
    const short = encodeCursor({ v: 1, h, d: "next", t: [1] });
    expect(codes("posts", `sort=title&cursor=${short}`)).toEqual([["cursor", "invalid_cursor"]]);
  });

  it.each([
    ["posts", "sort=createdAt", ["not-a-date", 1]],
    ["posts", "sort=createdAt", ["2026-01-01T00:00:00Z", 1]],
    ["posts", "sort=publishedAt", ["2026-02-30T00:00:00.000Z", 1]],
    ["todos", "sort=dueDate", ["2026-13-01", 1]],
    ["todos", "sort=dueDate", ["tomorrow", 1]],
    ["products", "sort=rating", [1.5, 0]],
  ] as const)("rejects a %s cursor for %s holding %j", (name, query, tuple) => {
    const result = parse(name, query);
    if (!result.ok) throw new Error("query should parse");
    const cursor = encodeCursor({ v: 1, h: result.value.binding, d: "next", t: [...tuple] });
    expect(codes(name, `${query}&cursor=${cursor}`)).toEqual([["cursor", "invalid_cursor"]]);
  });

  it.each([
    ["another sort", "sort=-title"],
    ["another filter", "sort=title&status=published"],
    ["a search", "sort=title&q=react"],
  ])("rejects a cursor reused with %s", (_name, query) => {
    const cursor = encodeCursor({ v: 1, h: bound("sort=title"), d: "next", t: ["a", 1] });
    expect(issues("posts", `${query}&cursor=${cursor}`)).toEqual([
      {
        field: "cursor",
        code: "cursor_mismatch",
        message:
          '"cursor" belongs to a different list, search, filter or sort. Repeat the parameters of the request that returned it, or start again without a cursor.',
      },
    ]);
  });

  it("binds the route and the fixture pack", () => {
    const cursor = encodeCursor({ v: 1, h: bound(""), d: "next", t: [1] });
    expect(codes("posts", `cursor=${cursor}`)).toEqual([]);
    expect(
      codes("posts", `cursor=${cursor}`, { path: "/v1/users/1/posts", pack: "core@1" }),
    ).toEqual([["cursor", "cursor_mismatch"]]);
    expect(codes("posts", `cursor=${cursor}`, { path: scope.path, pack: "core@2" })).toEqual([
      ["cursor", "cursor_mismatch"],
    ]);
  });

  it("ignores the order of filters when binding", () => {
    expect(bound("status=published&userId=1")).toBe(bound("userId=1&status=published"));
    expect(bound("limit=5")).toBe(bound("limit=50"));
  });
});

describe("the documented parameter lists", () => {
  // a valid value for every parameter name the lists document
  function sample(resource: Resource, name: string): string {
    const samples: Record<string, string> = {
      pagination: "offset",
      limit: "5",
      offset: "1",
      page: "2",
      perPage: "5",
      withTotal: "true",
      q: "a",
      sort: "-id",
      fields: "id",
      expand: Object.keys(resource.expansions)[0] ?? "",
    };
    if (name in samples) return samples[name] ?? "";
    if (name === "cursor") {
      const h = parseListQuery(resource, [], { path: "/x", pack: "core@1" });
      return h.ok ? encodeCursor({ v: 1, h: h.value.binding, d: "next", t: [1] }) : "";
    }
    const field = name.replace(/_(ne|gt|gte|lt|lte)$/, "");
    const kind = fieldKind(resource.schema.shape[field] as z.ZodType);
    const byType: Record<string, string> = {
      integer: "1",
      number: "1.5",
      boolean: "true",
      date: "2026-01-01",
      datetime: "2026-01-01",
      string: "x",
      tags: "x",
    };
    return kind.type === "enum" ? (kind.values[0] ?? "") : (byType[kind.type] ?? "");
  }

  it.each(resources.map((resource) => [resource.name, resource] as const))(
    "accepts every documented %s list parameter on its own",
    (_name, resource) => {
      for (const name of listParameterNames(resource)) {
        // withTotal only refines cursor mode, so it needs the mode named
        const pairs: [string, string][] =
          name === "withTotal"
            ? [
                ["pagination", "cursor"],
                [name, sample(resource, name)],
              ]
            : [[name, sample(resource, name)]];
        const result = parseListQuery(resource, pairs, { path: "/x", pack: "core@1" });
        expect([name, result.ok ? [] : result.issues]).toEqual([name, []]);
      }
      for (const name of readParameterNames(resource)) {
        expect(parseReadQuery(resource, [[name, sample(resource, name)]]).ok).toBe(true);
      }
    },
  );
});

describe("parseNoQuery", () => {
  it("accepts an empty query", () => {
    expect(parseNoQuery(new URLSearchParams(""))).toEqual({ ok: true, value: null });
  });

  it("reports each distinct parameter once", () => {
    const result = parseNoQuery(new URLSearchParams("a=1&b=2&a=3"));
    expect(result.ok ? [] : result.issues.map((issue) => [issue.field, issue.code])).toEqual([
      ["a", "unknown_parameter"],
      ["b", "unknown_parameter"],
    ]);
  });
});

// base64url of arbitrary ASCII, for malformed payloads
function encodeCursorText(ascii: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let i = 0; i < ascii.length; i += 3) {
    const n =
      (ascii.charCodeAt(i) << 16) |
      ((ascii.charCodeAt(i + 1) || 0) << 8) |
      (ascii.charCodeAt(i + 2) || 0);
    out += alphabet[(n >> 18) & 63] ?? "";
    out += alphabet[(n >> 12) & 63] ?? "";
    if (i + 1 < ascii.length) out += alphabet[(n >> 6) & 63] ?? "";
    if (i + 2 < ascii.length) out += alphabet[n & 63] ?? "";
  }
  return out;
}
