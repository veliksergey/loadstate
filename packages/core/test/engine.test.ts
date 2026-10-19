import { describe, expect, it } from "vitest";
import {
  corePack,
  createEngine,
  type Engine,
  type EngineOptions,
  type Image,
  pageSchema,
  type ResourceName,
  resources,
  userSchema,
} from "../src/index.js";

type Row = { id: number } & Record<string, unknown>;
const rows = (name: ResourceName) => corePack.data[name] as readonly Row[];

const fixtureUsers = corePack.data.users;
const userCount = fixtureUsers.length;
const nextId = userCount + 1;

const memory = (options: Partial<EngineOptions> = {}) =>
  createEngine({ state: "memory", ...options });

const get = (engine: Engine, path: string, query = "") =>
  engine.handle({ method: "GET", path, query: new URLSearchParams(query) });

const post = (engine: Engine, body: unknown, ...type: [contentType?: string | undefined]) =>
  engine.handle({
    method: "POST",
    path: "/v1/users",
    // an explicit undefined means "no Content-Type header"
    contentType: type.length > 0 ? type[0] : "application/json",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const newUser = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };
const total = (engine: Engine) =>
  pageSchema(userSchema).parse(get(engine, "/v1/users").body).meta.total;
const errors = (body: unknown) => (body as { errors: { field: string; code: string }[] }).errors;

describe("routing", () => {
  it("lists users in the step 1 envelope", () => {
    const response = get(memory(), "/v1/users", "limit=2&offset=1");
    expect(response.status).toBe(200);
    expect(response.headers).toEqual({
      "content-type": "application/json",
      link: [
        '</v1/users?limit=2&offset=0>; rel="first"',
        '</v1/users?limit=2&offset=0>; rel="prev"',
        '</v1/users?limit=2&offset=3>; rel="next"',
        `</v1/users?limit=2&offset=${userCount - 2}>; rel="last"`,
      ].join(", "),
      "x-mock-state": "memory",
    });
    const page = pageSchema(userSchema).parse(response.body);
    expect(page.data.map((user) => user.id)).toEqual([2, 3]);
    expect(page.meta).toEqual({ limit: 2, offset: 1, total: userCount, hasMore: true });
  });

  it("reads one user as a bare record", () => {
    const response = get(memory(), "/v1/users/7");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(fixtureUsers[6]);
  });

  it.each([String(nextId), "9007199254740993"])("answers missing /v1/users/%s with 404", (id) => {
    const response = get(memory(), `/v1/users/${id}`);
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toBe("application/problem+json");
    expect(response.body).toMatchObject({ code: "not_found", detail: "No user has this id." });
  });

  it.each(["0", "007", "abc", "1.0", "-1", "7x"])(
    "answers malformed /v1/users/%s with 404",
    (id) => {
      const response = get(memory(), `/v1/users/${id}`);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        code: "not_found",
        detail: "No route matches this path.",
      });
    },
  );

  it.each(["/v1/widgets", "/v1/users/", "/v1/users/1/widgets", "/v2/users", "/", ""])(
    "answers unknown path %j with 404",
    (path) => {
      const response = get(memory(), path);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        code: "not_found",
        detail: "No route matches this path.",
      });
    },
  );

  it("answers HEAD like GET without a body", () => {
    const engine = memory();
    const head = engine.handle({ method: "HEAD", path: "/v1/users/1" });
    expect(head).toEqual({ status: 200, headers: get(engine, "/v1/users/1").headers });
  });

  it("lists allowed methods on a 405", () => {
    const engine = memory();
    const item = engine.handle({ method: "POST", path: "/v1/users/1" });
    expect(item.status).toBe(405);
    expect(item.headers.allow).toBe("GET, HEAD, PUT, PATCH, DELETE");
    expect(item.body).toMatchObject({ title: "Method Not Allowed", code: "method_not_allowed" });

    const list = engine.handle({ method: "PUT", path: "/v1/users" });
    expect(list.headers.allow).toBe("GET, HEAD, POST");
  });

  it.each(["/v1/nope", "/v1/users/abc", "/v1/users/007"])(
    "answers HEAD %s with a bodiless 404",
    (path) => {
      const response = memory().handle({ method: "HEAD", path });
      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toBe("application/problem+json");
      expect(response.body).toBeUndefined();
    },
  );

  it.each(["007", "0", "abc", "-1", "7x"])(
    "answers DELETE /v1/users/%s with 404, not 405",
    (id) => {
      const response = memory().handle({ method: "DELETE", path: `/v1/users/${id}` });
      expect(response.status).toBe(404);
      expect(response.headers.allow).toBeUndefined();
    },
  );

  it("keeps 405 for a well-formed id that does not exist", () => {
    const response = memory().handle({ method: "POST", path: `/v1/users/${nextId}` });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD, PUT, PATCH, DELETE");
  });

  it("rejects list parameters on a read and any parameter on a write", () => {
    const read = get(memory(), "/v1/users/1", "limit=2");
    expect(read.status).toBe(400);
    expect(errors(read.body)).toEqual([
      { field: "limit", code: "unknown_parameter", message: 'Unknown query parameter "limit".' },
    ]);

    const create = memory().handle({
      method: "POST",
      path: "/v1/users",
      query: new URLSearchParams("dryRun=1"),
      contentType: "application/json",
      body: JSON.stringify(newUser),
    });
    expect(create.status).toBe(400);
  });
});

describe("creating a user", () => {
  it("returns 201 with a location and stores the record in memory", () => {
    const engine = memory();
    const created = post(engine, newUser);

    expect(created.status).toBe(201);
    expect(created.headers).toEqual({
      "content-type": "application/json",
      location: `/v1/users/${nextId}`,
      "x-mock-state": "memory",
    });
    expect(created.body).toEqual({
      id: nextId,
      ...newUser,
      avatar: {
        url: "/img/avatar/ines.duarte?size=96",
        width: 96,
        height: 96,
        alt: "Ines Duarte",
        color: expect.stringMatching(/^#[0-9a-f]{6}$/),
      },
      role: "viewer",
      status: "active",
      address: null,
      company: null,
      locale: "en-US",
      timezone: "UTC",
      createdAt: "2026-03-01T12:00:00.000Z",
      updatedAt: "2026-03-01T12:00:00.000Z",
    });
    expect(userSchema.parse(created.body)).toEqual(created.body);
    expect(get(engine, `/v1/users/${nextId}`).body).toEqual(created.body);
    expect(total(engine)).toBe(nextId);
    const second = { ...newUser, username: "ines.d", email: "ines.d@example.com" };
    expect(post(engine, second).headers.location).toBe(`/v1/users/${nextId + 1}`);
  });

  it("stamps records with the injected clock", () => {
    const engine = memory({ now: () => new Date("2030-05-06T07:08:09.000Z") });
    expect(post(engine, newUser).body).toMatchObject({
      createdAt: "2030-05-06T07:08:09.000Z",
      updatedAt: "2030-05-06T07:08:09.000Z",
    });
  });

  it.each(["application/json; charset=utf-8", "APPLICATION/JSON", " application/json "])(
    "accepts content type %j",
    (contentType) => {
      expect(post(memory(), newUser, contentType).status).toBe(201);
    },
  );

  it.each([undefined, "", "text/plain", "application/json-patch+json", "application/jsonx"])(
    "rejects content type %j with 415",
    (contentType) => {
      const response = post(memory(), newUser, contentType);
      expect(response.status).toBe(415);
      expect(response.body).toMatchObject({ code: "unsupported_media_type" });
    },
  );

  it.each(["", "{", "nul", "{'name':'x'}"])("rejects body %j as invalid JSON", (body) => {
    const response = post(memory(), body);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "invalid_json" });
  });

  it.each([[[]], ["text"], [1], [null]])("rejects JSON %j that is not an object", (body) => {
    const response = post(memory(), JSON.stringify(body));
    expect(response.status).toBe(422);
    expect(errors(response.body)).toEqual([
      { field: "", code: "invalid_type", message: "The request body must be a JSON object." },
    ]);
  });

  it("reports every missing field", () => {
    const response = post(memory(), {});
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      title: "Unprocessable Content",
      code: "validation_failed",
    });
    expect(errors(response.body)).toEqual([
      { field: "name", code: "required", message: '"name" is required.' },
      { field: "username", code: "required", message: '"username" is required.' },
      { field: "email", code: "required", message: '"email" is required.' },
    ]);
  });

  it("names read-only, unknown and invalid fields", () => {
    const response = post(memory(), {
      id: 1,
      name: "",
      username: 5,
      email: "nope",
      createdAt: "2026-01-01T00:00:00.000Z",
      avatar: "ines.png",
      nickname: "ines",
    });
    const issues = errors(response.body);
    expect(issues).toHaveLength(7);
    expect(issues).toEqual(
      expect.arrayContaining([
        { field: "id", code: "read_only", message: '"id" is set by the server.' },
        { field: "createdAt", code: "read_only", message: '"createdAt" is set by the server.' },
        { field: "avatar", code: "read_only", message: '"avatar" is set by the server.' },
        { field: "nickname", code: "unknown_field", message: 'Unknown field "nickname".' },
        { field: "name", code: "too_short", message: '"name" must not be empty.' },
        { field: "username", code: "invalid_type", message: '"username" must be a string.' },
        {
          field: "email",
          code: "invalid_format",
          message: '"email" must be a valid email address.',
        },
      ]),
    );
  });

  it("bounds field lengths", () => {
    const response = post(memory(), { ...newUser, name: "x".repeat(101) });
    expect(errors(response.body)).toEqual([
      { field: "name", code: "too_long", message: '"name" must be at most 100 characters.' },
    ]);
    expect(post(memory(), { ...newUser, name: "x".repeat(100) }).status).toBe(201);
  });

  it("treats a JSON __proto__ key as an unknown field", () => {
    const body = `{"name":"A","username":"a","email":"a@example.com","__proto__":{"id":1}}`;
    expect(errors(post(memory(), body).body)).toEqual([
      { field: "__proto__", code: "unknown_field", message: 'Unknown field "__proto__".' },
    ]);
  });

  it("does not use up an id on a rejected create", () => {
    const engine = memory();
    post(engine, {});
    expect(post(engine, newUser).headers.location).toBe(`/v1/users/${nextId}`);
  });
});

describe("stateless engine", () => {
  it("answers creates as if saved but stores nothing", () => {
    const engine = createEngine({ state: "stateless" });
    const created = post(engine, newUser);
    expect(created.status).toBe(201);
    expect(created.headers["x-mock-state"]).toBe("stateless");
    expect(created.body).toMatchObject({ id: nextId });

    expect(get(engine, `/v1/users/${nextId}`).status).toBe(404);
    expect(total(engine)).toBe(userCount);
    expect(post(engine, newUser).body).toMatchObject({ id: nextId });
  });

  it("marks every response with its state", () => {
    const engine = createEngine({ state: "stateless" });
    for (const response of [
      get(engine, "/v1/users"),
      get(engine, "/nowhere"),
      engine.handle({ method: "DELETE", path: "/v1/users" }),
    ]) {
      expect(response.headers["x-mock-state"]).toBe("stateless");
    }
  });
});

describe("sequences", () => {
  it("returns the configured failures in order, then normal responses", () => {
    const engine = memory({ sequences: { "GET /v1/users/:id": [503, 429] } });

    const first = get(engine, "/v1/users/1");
    expect(first.status).toBe(503);
    expect(first.headers["content-type"]).toBe("application/problem+json");
    expect(first.body).toEqual({
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
      detail: "Simulated failure 1 of 2 for GET /v1/users/:id.",
      code: "simulated_failure",
    });
    expect(get(engine, "/v1/users/2").status).toBe(429);
    expect(get(engine, "/v1/users/1").status).toBe(200);
    expect(get(engine, "/v1/users/1").status).toBe(200);
  });

  it("does not spend a step on a malformed id", () => {
    const engine = memory({ sequences: { "GET /v1/users/:id": [503] } });
    expect(get(engine, "/v1/users/abc").status).toBe(404);
    expect(get(engine, "/v1/users/1").status).toBe(503);
  });

  it("counts steps per route", () => {
    const engine = memory({ sequences: { "GET /v1/users/:id": [500] } });
    expect(get(engine, "/v1/users").status).toBe(200);
    expect(get(engine, "/v1/users/1").status).toBe(500);
  });

  it("lets HEAD use the GET route's sequence", () => {
    const engine = memory({ sequences: { "GET /v1/users/:id": [503] } });
    expect(engine.handle({ method: "HEAD", path: "/v1/users/1" }).status).toBe(503);
    expect(get(engine, "/v1/users/1").status).toBe(200);
  });

  it("fails before a create changes anything", () => {
    const engine = memory({ sequences: { "POST /v1/users": [500] } });
    expect(post(engine, newUser).status).toBe(500);
    expect(total(engine)).toBe(userCount);
    expect(post(engine, newUser).headers.location).toBe(`/v1/users/${nextId}`);
  });

  it("copies the configuration", () => {
    const steps = [503];
    const engine = memory({ sequences: { "GET /v1/users": steps } });
    steps.push(503, 503);
    expect(get(engine, "/v1/users").status).toBe(503);
    expect(get(engine, "/v1/users").status).toBe(200);
  });

  it("rejects an unknown route key", () => {
    expect(() => memory({ sequences: { "GET /v1/widgets": [503] } })).toThrow(
      /^Unknown sequence route "GET \/v1\/widgets"\. Use one of: GET \/v1\/users, POST \/v1\/users, GET \/v1\/users\/:id, PUT \/v1\/users\/:id, .*DELETE \/v1\/todos\/:id.*, GET \/v1\/_utils\/status\/:code\.$/,
    );
  });

  it.each([200, 302, 418, 599])("rejects status %i", (status) => {
    expect(() => memory({ sequences: { "GET /v1/users": [status] } })).toThrow(
      `Status ${status} in sequence "GET /v1/users" is not supported.`,
    );
  });
});

describe("reset and isolation", () => {
  it("restores records, the next id and sequence positions", () => {
    const engine = memory({ sequences: { "GET /v1/users/:id": [503] } });
    post(engine, newUser);
    expect(get(engine, `/v1/users/${nextId}`).status).toBe(503);
    expect(get(engine, `/v1/users/${nextId}`).status).toBe(200);

    engine.reset();

    expect(get(engine, `/v1/users/${nextId}`).status).toBe(503);
    expect(get(engine, `/v1/users/${nextId}`).status).toBe(404);
    expect(total(engine)).toBe(userCount);
    expect(post(engine, newUser).headers.location).toBe(`/v1/users/${nextId}`);
  });

  it("keeps engines independent", () => {
    const sequences = { "GET /v1/users/:id": [503] };
    const first = memory({ sequences });
    const second = memory({ sequences });

    post(first, newUser);
    expect(get(first, "/v1/users/1").status).toBe(503);

    expect(total(second)).toBe(userCount);
    expect(get(second, "/v1/users/1").status).toBe(503);
    expect(fixtureUsers).toHaveLength(userCount);
  });
});

describe("resources", () => {
  const each = resources.map((resource) => [resource.name, resource] as const);

  it.each(each)("lists %s from the fixture pack", (name, resource) => {
    const all = rows(name);
    const response = get(memory(), `/v1/${name}`);
    expect(response.status).toBe(200);
    const page = pageSchema(resource.schema).parse(response.body);
    expect(page.meta).toEqual({
      limit: 20,
      offset: 0,
      total: all.length,
      hasMore: all.length > 20,
    });
    expect(page.data).toEqual(all.slice(0, 20));
  });

  it.each(each)("reads one of %s by id", (name, resource) => {
    const all = rows(name);
    const last = all[all.length - 1];
    const response = get(memory(), `/v1/${name}/${last?.id}`);
    expect(response.body).toEqual(last);
    expect(resource.schema.safeParse(response.body).success).toBe(true);

    const missing = get(memory(), `/v1/${name}/${all.length + 1}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({
      detail: `No ${resource.singular.toLowerCase()} has this id.`,
    });
  });

  const nested = resources.flatMap((resource) =>
    Object.entries(resource.relations).map(
      ([relation, target]) => [`${resource.name}/${relation}`, resource, relation, target] as const,
    ),
  );

  it.each(nested)("lists %s for a parent that has some", (_label, resource, relation, target) => {
    const children = rows(target.resource);
    const parent = rows(resource.name).find((row) =>
      children.some((child) => child[target.foreignKey] === row.id),
    );
    expect(parent).toBeDefined();
    const expected = children.filter((child) => child[target.foreignKey] === parent?.id);

    const response = get(memory(), `/v1/${resource.name}/${parent?.id}/${relation}`, "limit=100");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: expected,
      meta: { limit: 100, offset: 0, total: expected.length, hasMore: false },
    });
  });

  it("pages a nested list with the same rules", () => {
    const engine = memory();
    const page = get(engine, "/v1/categories/1/children", "limit=1&offset=1");
    expect(page.body).toMatchObject({ meta: { limit: 1, offset: 1, total: 2, hasMore: false } });
    expect(get(engine, "/v1/users/1/posts", "limit=0").status).toBe(400);
    expect(get(engine, "/v1/users/1/posts", "sort=nope").status).toBe(400);
  });

  it("answers a nested list of a missing parent with 404", () => {
    const response = get(memory(), `/v1/users/${nextId}/posts`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ code: "not_found", detail: "No user has this id." });
  });

  it("allows only GET and HEAD on nested lists", () => {
    const engine = memory();
    expect(engine.handle({ method: "HEAD", path: "/v1/posts/1/comments" })).toEqual({
      status: 200,
      headers: get(engine, "/v1/posts/1/comments").headers,
    });
    const response = engine.handle({ method: "POST", path: "/v1/posts/1/comments" });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD");
  });

  it("copies the shared fixture arrays into each memory engine", () => {
    const engine = memory();
    post(engine, newUser);
    expect(total(engine)).toBe(nextId);
    expect(fixtureUsers).toHaveLength(userCount);
    expect(Object.isFrozen(fixtureUsers)).toBe(true);
    expect(Object.isFrozen(fixtureUsers[0]?.avatar)).toBe(true);
  });
});

describe("image URLs", () => {
  const base = "https://api.example.test";
  const at = (engine: Engine, path: string, baseUrl?: string) =>
    engine.handle({ method: "GET", path, baseUrl }).body as Record<string, unknown>;
  const absolute = (image: unknown) => (image as Image).url.startsWith(`${base}/img/`);

  it("joins stored paths with the request base URL", () => {
    const engine = memory();
    const user = at(engine, "/v1/users/1", `${base}/`) as { avatar: Image };
    expect(user.avatar).toEqual({
      ...fixtureUsers[0]?.avatar,
      url: `${base}${fixtureUsers[0]?.avatar.url}`,
    });

    const product = at(engine, "/v1/products/1", base) as { images: Image[] };
    expect(product.images.length).toBe(corePack.data.products[0]?.images.length);
    for (const image of product.images) expect(absolute(image)).toBe(true);

    expect(absolute(at(engine, "/v1/posts/1", base).cover)).toBe(true);
    expect(absolute(at(engine, "/v1/categories/1", base).image)).toBe(true);
  });

  it("keeps a path prefix in the base URL", () => {
    const user = at(memory(), "/v1/users/1", `${base}/api`) as { avatar: Image };
    expect(user.avatar.url).toBe(`${base}/api${fixtureUsers[0]?.avatar.url}`);
  });

  it("joins URLs in lists, nested lists and created users", () => {
    const engine = memory();
    const list = at(engine, "/v1/users", base) as { data: { avatar: Image }[] };
    for (const user of list.data) expect(absolute(user.avatar)).toBe(true);

    const nested = at(engine, "/v1/categories/2/products", base) as {
      data: { images: Image[] }[];
    };
    expect(nested.data.length).toBeGreaterThan(0);
    for (const product of nested.data) {
      for (const image of product.images) expect(absolute(image)).toBe(true);
    }

    const created = engine.handle({
      method: "POST",
      path: "/v1/users",
      contentType: "application/json",
      body: JSON.stringify(newUser),
      baseUrl: base,
    });
    expect((created.body as { avatar: Image }).avatar.url).toBe(
      `${base}/img/avatar/ines.duarte?size=96`,
    );
  });

  it("keeps root-relative paths without a base URL and never changes the fixture", () => {
    const engine = memory();
    at(engine, "/v1/users/1", base);
    const user = at(engine, "/v1/users/1") as { avatar: Image };
    expect(user.avatar.url).toBe(fixtureUsers[0]?.avatar.url);
    expect(fixtureUsers[0]?.avatar.url.startsWith("/img/")).toBe(true);
  });

  it("validates the username that builds a created user's avatar path", () => {
    const response = post(memory(), { ...newUser, username: "ines_d-2.x" });
    expect((response.body as { avatar: Image }).avatar.url).toBe("/img/avatar/ines_d-2.x?size=96");
    const rejected = post(memory(), { ...newUser, username: "Ines Duarte" });
    expect(errors(rejected.body)).toEqual([
      {
        field: "username",
        code: "invalid_format",
        message:
          '"username" may only contain lowercase letters, digits, ".", "_" and "-", starting with a letter or digit.',
      },
    ]);
  });
});

describe("stored records stay immutable", () => {
  it("rejects edits to a created user's nested fields through an in-process response", () => {
    const engine = memory();
    const created = post(engine, newUser).body as { avatar: Image };
    expect(() => {
      created.avatar.width = -1;
    }).toThrow(TypeError);
    const read = get(engine, `/v1/users/${nextId}`).body as { avatar: Image };
    expect(read.avatar.width).toBe(96);
    expect(userSchema.safeParse(read).success).toBe(true);
  });
});
