import { describe, expect, it } from "vitest";
import {
  createEngine,
  type Engine,
  type EngineOptions,
  pageSchema,
  userSchema,
  users,
} from "../src/index.js";

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
      "x-mock-state": "memory",
    });
    const page = pageSchema(userSchema).parse(response.body);
    expect(page.data.map((user) => user.id)).toEqual([2, 3]);
    expect(page.meta).toEqual({ limit: 2, offset: 1, total: 25, hasMore: true });
  });

  it("reads one user as a bare record", () => {
    const response = get(memory(), "/v1/users/7");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(users[6]);
  });

  it.each(["26", "9007199254740993"])("answers missing /v1/users/%s with 404", (id) => {
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

  it.each(["/v1/posts", "/v1/users/", "/v1/users/1/posts", "/v2/users", "/", ""])(
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
    const item = engine.handle({ method: "DELETE", path: "/v1/users/1" });
    expect(item.status).toBe(405);
    expect(item.headers.allow).toBe("GET, HEAD");
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
    const response = memory().handle({ method: "DELETE", path: "/v1/users/26" });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD");
  });

  it("rejects query parameters on routes that take none", () => {
    const read = get(memory(), "/v1/users/1", "fields=name");
    expect(read.status).toBe(400);
    expect(errors(read.body)).toEqual([
      { field: "fields", code: "unknown_parameter", message: 'Unknown query parameter "fields".' },
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
      location: "/v1/users/26",
      "x-mock-state": "memory",
    });
    expect(created.body).toEqual({
      id: 26,
      ...newUser,
      createdAt: "2026-03-01T12:00:00.000Z",
      updatedAt: "2026-03-01T12:00:00.000Z",
    });
    expect(get(engine, "/v1/users/26").body).toEqual(created.body);
    expect(total(engine)).toBe(26);
    expect(post(engine, { ...newUser, username: "ines.d" }).headers.location).toBe("/v1/users/27");
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
      role: "admin",
    });
    const issues = errors(response.body);
    expect(issues).toHaveLength(6);
    expect(issues).toEqual(
      expect.arrayContaining([
        { field: "id", code: "read_only", message: '"id" is set by the server.' },
        { field: "createdAt", code: "read_only", message: '"createdAt" is set by the server.' },
        { field: "role", code: "unknown_field", message: 'Unknown field "role".' },
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
    expect(post(engine, newUser).headers.location).toBe("/v1/users/26");
  });
});

describe("stateless engine", () => {
  it("answers creates as if saved but stores nothing", () => {
    const engine = createEngine({ state: "stateless" });
    const created = post(engine, newUser);
    expect(created.status).toBe(201);
    expect(created.headers["x-mock-state"]).toBe("stateless");
    expect(created.body).toMatchObject({ id: 26 });

    expect(get(engine, "/v1/users/26").status).toBe(404);
    expect(total(engine)).toBe(25);
    expect(post(engine, newUser).body).toMatchObject({ id: 26 });
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
    expect(total(engine)).toBe(25);
    expect(post(engine, newUser).headers.location).toBe("/v1/users/26");
  });

  it("copies the configuration", () => {
    const steps = [503];
    const engine = memory({ sequences: { "GET /v1/users": steps } });
    steps.push(503, 503);
    expect(get(engine, "/v1/users").status).toBe(503);
    expect(get(engine, "/v1/users").status).toBe(200);
  });

  it("rejects an unknown route key", () => {
    expect(() => memory({ sequences: { "GET /v1/posts": [503] } })).toThrow(
      'Unknown sequence route "GET /v1/posts". Use one of: GET /v1/users, GET /v1/users/:id, POST /v1/users.',
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
    expect(get(engine, "/v1/users/26").status).toBe(503);
    expect(get(engine, "/v1/users/26").status).toBe(200);

    engine.reset();

    expect(get(engine, "/v1/users/26").status).toBe(503);
    expect(get(engine, "/v1/users/26").status).toBe(404);
    expect(total(engine)).toBe(25);
    expect(post(engine, newUser).headers.location).toBe("/v1/users/26");
  });

  it("keeps engines independent", () => {
    const sequences = { "GET /v1/users/:id": [503] };
    const first = memory({ sequences });
    const second = memory({ sequences });

    post(first, newUser);
    expect(get(first, "/v1/users/1").status).toBe(503);

    expect(total(second)).toBe(25);
    expect(get(second, "/v1/users/1").status).toBe(503);
    expect(users).toHaveLength(25);
  });
});
