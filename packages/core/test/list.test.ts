import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  corePack,
  createEngine,
  type Engine,
  type EngineResponse,
  type FieldKind,
  fieldKind,
  type ResourceName,
  resourceNamed,
  resources,
} from "../src/index.js";
import { fold } from "../src/text.js";
import { type Row, rows } from "./samples.js";

const base = "https://api.example.test";
const memory = () => createEngine({ state: "memory" });

function get(engine: Engine, path: string, query = ""): EngineResponse {
  return engine.handle({
    method: "GET",
    path,
    query: new URLSearchParams(query),
    baseUrl: base,
  });
}

type Body = { data: Row[]; meta: Record<string, unknown> };
const body = (response: EngineResponse) => response.body as Body;
const ids = (response: EngineResponse) => body(response).data.map((row) => row.id);
const issues = (response: EngineResponse) =>
  (response.body as { errors: { field: string; code: string }[] }).errors.map(
    (issue) => `${issue.field}:${issue.code}`,
  );
const kind = (name: ResourceName, field: string): FieldKind =>
  fieldKind(resourceNamed(name).schema.shape[field] as z.ZodType);

// the documented order, written independently of the engine's comparator
function expectedOrder(
  name: ResourceName,
  list: readonly Row[],
  field: string,
  descending: boolean,
) {
  const type = kind(name, field);
  const compare = (x: unknown, y: unknown): number => {
    if (typeof x === "number" && typeof y === "number") return x - y;
    if (typeof x === "boolean" && typeof y === "boolean") return Number(x) - Number(y);
    if (type.type === "enum")
      return type.values.indexOf(String(x)) - type.values.indexOf(String(y));
    const [a, b] =
      type.type === "string" ? [fold(String(x)), fold(String(y))] : [String(x), String(y)];
    if (a !== b) return a < b ? -1 : 1;
    return String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
  };
  return [...list]
    .sort((r, s) => {
      const x = r[field] ?? null;
      const y = s[field] ?? null;
      if (x !== y) {
        if (x === null) return 1;
        if (y === null) return -1;
        const order = compare(x, y);
        if (order !== 0) return descending ? -order : order;
      }
      return field === "id" && descending ? 0 : r.id - s.id;
    })
    .map((row) => row.id);
}

// follows nextCursor from the first page, then prevCursor back from the last
function walk(engine: Engine, path: string, query: string) {
  const forward: number[][] = [];
  let response = get(engine, path, `${query}&pagination=cursor&limit=13`);
  let pages = 0;
  for (;;) {
    expect(response.status).toBe(200);
    forward.push(ids(response));
    const next = body(response).meta.nextCursor as string | null;
    if (next === null || ++pages > 100) break;
    response = get(engine, path, `${query}&limit=13&cursor=${next}`);
  }
  const backward: number[][] = [ids(response)];
  for (;;) {
    const prev = body(response).meta.prevCursor as string | null;
    if (prev === null || ++pages > 200) break;
    response = get(engine, path, `${query}&limit=13&cursor=${prev}`);
    expect(response.status).toBe(200);
    backward.unshift(ids(response));
  }
  return { forward: forward.flat(), backward: backward.flat(), pages: forward.length };
}

describe("cursor pagination", () => {
  const cases = resources.flatMap((resource) =>
    resource.sortable.flatMap((field) => [
      [resource.name, field, false] as const,
      [resource.name, field, true] as const,
    ]),
  );

  it.each(cases)(
    "visits every %s row once sorted by %s (descending: %s)",
    (name, field, descending) => {
      const order = expectedOrder(name, rows(name), field, descending);
      const walked = walk(memory(), `/v1/${name}`, `sort=${descending ? "-" : ""}${field}`);
      expect(walked.forward).toEqual(order);
      expect(walked.backward).toEqual(order);
    },
  );

  it("starts with no previous page and reports a total only on request", () => {
    const first = body(get(memory(), "/v1/posts", "pagination=cursor&limit=5"));
    expect(first.meta).toEqual({
      limit: 5,
      nextCursor: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      prevCursor: null,
      hasMore: true,
    });
    const counted = body(
      get(memory(), "/v1/posts", "pagination=cursor&withTotal=true&status=draft"),
    );
    const drafts = rows("posts").filter((post) => post.status === "draft");
    expect(counted.meta).toMatchObject({ limit: 20, total: drafts.length });
  });

  it("walks a filtered, searched and nested list", () => {
    const comments = rows("comments").filter((comment) => comment.userId === 1);
    const walked = walk(memory(), "/v1/users/1/comments", "sort=-likes&likes_gte=1");
    const expected = expectedOrder(
      "comments",
      comments.filter((comment) => (comment.likes as number) >= 1),
      "likes",
      true,
    );
    expect(walked.forward).toEqual(expected);
    expect(walked.backward).toEqual(expected);
  });

  it("walks past a title made of 200 emoji", () => {
    const engine = memory();
    const title = "😀".repeat(200);
    const created = engine.handle({
      method: "POST",
      path: "/v1/posts",
      contentType: "application/json",
      body: JSON.stringify({ userId: 1, title, body: "Emoji." }),
    });
    expect(created.status).toBe(201);
    const first = get(engine, "/v1/posts", "pagination=cursor&limit=1&sort=-title");
    expect(body(first).data[0]?.title).toBe(title);
    const next = body(first).meta.nextCursor as string;
    const second = get(engine, "/v1/posts", `sort=-title&limit=1&cursor=${next}`);
    expect(second.status).toBe(200);
    const back = get(
      engine,
      "/v1/posts",
      `sort=-title&limit=1&cursor=${body(second).meta.prevCursor}`,
    );
    expect(body(back).data[0]?.title).toBe(title);
  });

  it("ends with no next page", () => {
    const all = get(memory(), "/v1/categories", "pagination=cursor&limit=100");
    expect(body(all).meta).toMatchObject({ nextCursor: null, prevCursor: null, hasMore: false });
    expect(ids(all)).toHaveLength(rows("categories").length);
  });

  it("refuses a cursor from another nested list", () => {
    const engine = memory();
    const first = body(get(engine, "/v1/users/1/comments", "pagination=cursor&limit=1"));
    const cursor = first.meta.nextCursor as string;
    expect(get(engine, "/v1/users/1/comments", `cursor=${cursor}&limit=1`).status).toBe(200);
    expect(issues(get(engine, "/v1/users/2/comments", `cursor=${cursor}&limit=1`))).toEqual([
      "cursor:cursor_mismatch",
    ]);
  });
});

describe("page pagination", () => {
  it("returns numbered pages with totals", () => {
    const users = rows("users");
    const response = get(memory(), "/v1/users", "page=2&perPage=7");
    expect(ids(response)).toEqual(users.slice(7, 14).map((user) => user.id));
    expect(body(response).meta).toEqual({
      page: 2,
      perPage: 7,
      total: users.length,
      totalPages: Math.ceil(users.length / 7),
      hasMore: true,
    });
  });

  it("answers a page past the end with an empty 200", () => {
    const response = get(memory(), "/v1/users", "page=99&perPage=10");
    expect(response.status).toBe(200);
    expect(body(response)).toEqual({
      data: [],
      meta: { page: 99, perPage: 10, total: 30, totalPages: 3, hasMore: false },
    });
  });
});

describe("search", () => {
  it("matches every term across the resource's search fields", () => {
    const [post] = rows("posts");
    const words = String(post?.title).split(" ");
    const q = `${words[0]?.toUpperCase()} ${words[1]}`;
    const expected = rows("posts")
      .filter((row) => {
        const text = fold([row.title, row.excerpt, (row.tags as string[]).join(" ")].join("\n"));
        return [words[0], words[1]].every((term) => text.includes(fold(String(term))));
      })
      .map((row) => row.id);
    expect(expected).toContain(post?.id);
    expect(ids(get(memory(), "/v1/posts", `q=${encodeURIComponent(q)}&limit=100`))).toEqual(
      expected,
    );
  });

  it("ignores case and accents", () => {
    const engine = memory();
    engine.handle({
      method: "POST",
      path: "/v1/users",
      contentType: "application/json",
      body: JSON.stringify({ name: "Zoë Ångström", username: "zoe.a", email: "zoe@example.com" }),
    });
    expect(ids(get(engine, "/v1/users", "q=ZOE%20angstrom"))).toEqual([31]);
    expect(ids(get(engine, "/v1/users", "q=zo%C3%AB"))).toEqual([31]);
    expect(ids(get(engine, "/v1/users", "q=zoe%20nobody"))).toEqual([]);
    // U+1AB0 is a combining mark outside the U+0300-U+036F block
    expect(ids(get(engine, "/v1/users", "q=Zoe%E1%AA%B0"))).toEqual([31]);
  });

  it("does not search fields outside the list", () => {
    const [comment] = rows("comments");
    const word = String(comment?.body).split(" ")[0] ?? "";
    // comment bodies are searchable, comment ids are not
    expect(ids(get(memory(), "/v1/comments", `q=${encodeURIComponent(word)}&limit=100`))).toContain(
      comment?.id,
    );
    expect(ids(get(memory(), "/v1/users", "q=example.com&limit=100"))).toHaveLength(30);
    expect(ids(get(memory(), "/v1/users", "q=viewer"))).toEqual([]);
  });
});

describe("filters", () => {
  const all = "limit=100";
  const where = (name: ResourceName, test: (row: Row) => boolean) =>
    rows(name)
      .filter(test)
      .map((row) => row.id)
      .slice(0, 100);

  it.each([
    ["products", "status=active", (row: Row) => row.status === "active"],
    ["products", "status_ne=active", (row: Row) => row.status !== "active"],
    [
      "products",
      "priceMinor_gte=1000&priceMinor_lte=5000",
      (row: Row) => (row.priceMinor as number) >= 1000 && (row.priceMinor as number) <= 5000,
    ],
    ["products", "rating_gt=4.5", (row: Row) => (row.rating as number) > 4.5],
    ["products", "stock=0", (row: Row) => row.stock === 0],
    ["products", "categoryId=2", (row: Row) => row.categoryId === 2],
    ["posts", "tags=react", (row: Row) => (row.tags as string[]).includes("react")],
    ["posts", "tags_ne=react", (row: Row) => !(row.tags as string[]).includes("react")],
    [
      "posts",
      "publishedAt_lt=2025-07-01",
      (row: Row) => row.publishedAt !== null && String(row.publishedAt) < "2025-07-01",
    ],
    ["comments", "parentId=null", (row: Row) => row.parentId === null],
    ["comments", "parentId_ne=null", (row: Row) => row.parentId !== null],
    ["comments", "parentId_ne=2", (row: Row) => row.parentId !== 2],
    [
      "todos",
      "completed=false&priority=high",
      (row: Row) => row.completed === false && row.priority === "high",
    ],
    ["todos", "dueDate=null", (row: Row) => row.dueDate === null],
    [
      "todos",
      "dueDate_gte=2026-01-01",
      (row: Row) => row.dueDate !== null && String(row.dueDate) >= "2026-01-01",
    ],
    [
      "users",
      `createdAt_gte=2025-06-01&createdAt_lt=${encodeURIComponent("2025-09-01T00:00:00Z")}`,
      (row: Row) => String(row.createdAt) >= "2025-06-01" && String(row.createdAt) < "2025-09-01",
    ],
    ["categories", "parentId=1", (row: Row) => row.parentId === 1],
  ] as const)("filters %s by %s", (name, query, test) => {
    const expected = where(name, test);
    expect(ids(get(memory(), `/v1/${name}`, `${query}&${all}`))).toEqual(expected);
    expect(body(get(memory(), `/v1/${name}`, query)).meta.total).toBe(
      rows(name).filter(test).length,
    );
  });

  it("compares timestamps at full millisecond precision", () => {
    const [user] = rows("users");
    const at = String(user?.createdAt);
    const shifted = new Date(Date.parse(at) + 1).toISOString();
    const withOffset = new Date(Date.parse(at) + 2 * 3600_000).toISOString().replace("Z", "+02:00");
    const found = (query: string) => ids(get(memory(), "/v1/users", `${query}&limit=100`));
    expect(found(`createdAt=${at}`)).toEqual([user?.id]);
    expect(found(`createdAt=${encodeURIComponent(withOffset)}`)).toEqual([user?.id]);
    expect(found(`createdAt_lt=${shifted}`)).toContain(user?.id);
    expect(found(`createdAt_lt=${at}`)).not.toContain(user?.id);
    expect(found(`createdAt_lte=${at}`)).toContain(user?.id);
  });

  it.each([
    ["createdAt_lt=9999-12-31T23:59:59-01:00", 30],
    ["createdAt_gt=9999-12-31T23:59:59-01:00", 0],
    ["createdAt_gt=0000-01-01T00:30:00%2B01:00", 30],
    ["createdAt_lte=0000-01-01T00:30:00%2B01:00", 0],
  ])("compares %s as an instant beyond four-digit years", (query, total) => {
    expect(body(get(memory(), "/v1/users", query)).meta.total).toBe(total);
  });

  it("keeps a filter that matches nothing an empty 200", () => {
    const response = get(memory(), "/v1/products", "priceMinor_gt=100000000");
    expect(response.status).toBe(200);
    expect(body(response).meta).toMatchObject({ total: 0, hasMore: false });
  });
});

describe("sort", () => {
  it.each([
    ["users", "name"],
    ["posts", "publishedAt"],
    ["todos", "dueDate"],
    ["todos", "priority"],
    ["todos", "completed"],
    ["products", "rating"],
  ] as const)("orders %s by %s both ways", (name, field) => {
    for (const descending of [false, true]) {
      const response = get(
        memory(),
        `/v1/${name}`,
        `sort=${descending ? "-" : ""}${field}&limit=100`,
      );
      expect(ids(response)).toEqual(
        expectedOrder(name, rows(name), field, descending).slice(0, 100),
      );
    }
  });

  it("puts nulls last in both directions", () => {
    for (const sort of ["publishedAt", "-publishedAt"]) {
      const published = body(get(memory(), "/v1/posts", `sort=${sort}&limit=100&offset=20`)).data;
      const nulls = published.filter((post) => post.publishedAt === null);
      expect(nulls.length).toBeGreaterThan(0);
      expect(published.slice(-nulls.length).every((post) => post.publishedAt === null)).toBe(true);
    }
  });

  it("combines several keys with id last", () => {
    const response = get(memory(), "/v1/todos", "sort=-priority,completed&limit=100");
    expect(ids(response)).toEqual(
      [...rows("todos")]
        .sort((a, b) => {
          const levels = ["low", "normal", "high"];
          return (
            levels.indexOf(String(b.priority)) - levels.indexOf(String(a.priority)) ||
            Number(a.completed) - Number(b.completed) ||
            a.id - b.id
          );
        })
        .map((todo) => todo.id)
        .slice(0, 100),
    );
  });
});

describe("fields and expand", () => {
  it("returns only the selected scalar fields in record order", () => {
    const response = get(memory(), "/v1/users", "fields=email,id&limit=2");
    expect(body(response).data).toEqual(
      rows("users")
        .slice(0, 2)
        .map((user) => ({ id: user.id, email: user.email })),
    );
    expect(Object.keys(body(response).data[0] ?? {})).toEqual(["id", "email"]);
  });

  it("adds each expanded record in full with absolute image URLs", () => {
    const [post] = rows("posts");
    const author = rows("users").find((user) => user.id === post?.userId);
    if (!post || !author) throw new Error("The core pack needs a post with an author.");
    const avatar = author.avatar as { url: string };
    const response = get(memory(), `/v1/posts/${post.id}`, "fields=id,title&expand=author");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: post.id,
      title: post.title,
      author: { ...author, avatar: { ...avatar, url: `${base}${avatar.url}` } },
    });
    expect(Object.keys(response.body as object)).toEqual(["id", "title", "author"]);
  });

  it("keeps every field when only expanding", () => {
    const [product] = rows("products");
    const shown = get(memory(), `/v1/products/${product?.id}`, "expand=category").body as Row;
    expect(Object.keys(shown)).toEqual([...Object.keys(product ?? {}), "category"]);
    expect(shown.category).toMatchObject({ id: product?.categoryId });
  });

  it("expands a null reference to null", () => {
    const top = rows("comments").find((comment) => comment.parentId === null);
    const reply = rows("comments").find((comment) => comment.parentId !== null);
    const list = get(memory(), "/v1/comments", `expand=parent,post&fields=id&limit=100`);
    const shown = body(list).data;
    expect(shown.find((row) => row.id === top?.id)).toMatchObject({ parent: null });
    expect(shown.find((row) => row.id === reply?.id)).toMatchObject({
      parent: { id: reply?.parentId },
      post: { id: reply?.postId },
    });
  });

  it.each([
    ["posts", "author", "userId", "users"],
    ["comments", "author", "userId", "users"],
    ["categories", "parent", "parentId", "categories"],
    ["products", "category", "categoryId", "categories"],
    ["todos", "user", "userId", "users"],
  ] as const)("expands %s %s from %s", (name, expansion, field, target) => {
    const list = body(get(memory(), `/v1/${name}`, `expand=${expansion}&limit=100`)).data;
    for (const row of list) {
      const id = row[field];
      expect(row[expansion]).toEqual(
        id === null
          ? null
          : expect.objectContaining({
              id,
              createdAt: rows(target).find((r) => r.id === id)?.createdAt,
            }),
      );
    }
  });

  it("projects nested lists the same way", () => {
    const response = get(memory(), "/v1/users/1/posts", "fields=id,userId&sort=-id");
    const posts = rows("posts").filter((post) => post.userId === 1);
    expect(body(response).data).toEqual(
      posts
        .map((post) => ({ id: post.id, userId: 1 }))
        .reverse()
        .slice(0, 20),
    );
  });
});

describe("Link headers", () => {
  const links = (response: EngineResponse) =>
    Object.fromEntries(
      (response.headers.link ?? "").split(", ").map((part) => {
        const [, url, rel] = /^<([^>]*)>; rel="(\w+)"$/.exec(part) ?? [];
        return [rel, url];
      }),
    );

  it("keeps the other parameters and pages in offset mode", () => {
    const response = get(
      memory(),
      "/v1/products",
      "status=active&sort=-priceMinor&limit=5&offset=5",
    );
    const total = body(response).meta.total as number;
    expect(links(response)).toEqual({
      first: `${base}/v1/products?status=active&sort=-priceMinor&limit=5&offset=0`,
      prev: `${base}/v1/products?status=active&sort=-priceMinor&limit=5&offset=0`,
      next: `${base}/v1/products?status=active&sort=-priceMinor&limit=5&offset=10`,
      last: `${base}/v1/products?status=active&sort=-priceMinor&limit=5&offset=${Math.floor((total - 1) / 5) * 5}`,
    });
  });

  it("links numbered pages", () => {
    const response = get(memory(), "/v1/users", "page=1&perPage=10&q=example");
    expect(links(response)).toEqual({
      first: `${base}/v1/users?q=example&page=1&perPage=10`,
      next: `${base}/v1/users?q=example&page=2&perPage=10`,
      last: `${base}/v1/users?q=example&page=3&perPage=10`,
    });
  });

  it("links cursor pages and names the mode on the first", () => {
    const engine = memory();
    const first = get(engine, "/v1/posts", "cursor=&limit=2");
    expect(first.status).toBe(400);
    const start = get(engine, "/v1/posts", "pagination=cursor&limit=2&sort=title");
    const next = body(start).meta.nextCursor as string;
    expect(links(start)).toEqual({
      first: `${base}/v1/posts?pagination=cursor&sort=title&limit=2`,
      next: `${base}/v1/posts?pagination=cursor&sort=title&limit=2&cursor=${next}`,
    });
    const second = get(engine, "/v1/posts", `sort=title&limit=2&cursor=${next}`);
    const prev = body(second).meta.prevCursor as string;
    expect(links(second)).toMatchObject({
      first: `${base}/v1/posts?sort=title&pagination=cursor&limit=2`,
      prev: `${base}/v1/posts?sort=title&pagination=cursor&limit=2&cursor=${prev}`,
    });
  });

  it("stays root-relative without a base URL and encodes values", () => {
    const response = memory().handle({
      method: "GET",
      path: "/v1/users",
      query: new URLSearchParams("q=zoë a&limit=50"),
    });
    expect(response.headers.link).toBe(
      '</v1/users?q=zo%C3%AB%20a&limit=50&offset=0>; rel="first", </v1/users?q=zo%C3%AB%20a&limit=50&offset=0>; rel="last"',
    );
  });

  it("links a nested list under its own path", () => {
    const response = get(memory(), "/v1/users/1/posts", "limit=1");
    expect(links(response).first).toBe(`${base}/v1/users/1/posts?limit=1&offset=0`);
  });
});

describe("the default order", () => {
  it("lists every resource by ascending id without sort", () => {
    for (const resource of resources) {
      expect(ids(get(memory(), `/v1/${resource.name}`, "limit=100"))).toEqual(
        rows(resource.name)
          .map((row) => row.id)
          .slice(0, 100),
      );
    }
  });

  it("keeps fixtures unchanged", () => {
    expect(Object.isFrozen(corePack.data.posts)).toBe(true);
  });
});
