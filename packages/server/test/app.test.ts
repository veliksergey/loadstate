import { corePack, createEngine, pageSchema, userSchema } from "@loadstate/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, maxBodyBytes } from "../src/app.js";

const app = createApp();
const userCount = corePack.data.users.length;
const nextId = userCount + 1;
const userPage = pageSchema(userSchema);

async function get(path: string) {
  const response = await app.request(path);
  return { response, body: await response.json() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("health endpoints", () => {
  it("reports liveness", async () => {
    const { response, body } = await get("/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(body).toEqual({ status: "ok" });
  });

  it("reports readiness", async () => {
    const { response, body } = await get("/readyz");
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ready" });
  });
});

describe("GET /v1/users", () => {
  it("returns the first page of 20 in the list envelope", async () => {
    const { response, body } = await get("/v1/users");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    const page = userPage.parse(body);
    expect(page.meta).toEqual({ limit: 20, offset: 0, total: userCount, hasMore: true });
    expect(page.data.map((user) => user.id)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("honors limit and offset", async () => {
    const page = userPage.parse((await get("/v1/users?limit=10&offset=20")).body);
    expect(page.data.map((user) => user.id)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(page.meta).toEqual({ limit: 10, offset: 20, total: userCount, hasMore: false });
  });

  it("rejects an invalid query as Problem Details", async () => {
    const { response, body } = await get("/v1/users?nickname=x&limit=0");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(body).toEqual({
      type: "about:blank",
      title: "Bad Request",
      status: 400,
      detail: "The query string is not valid.",
      code: "invalid_query",
      errors: [
        {
          field: "nickname",
          code: "unknown_parameter",
          message: 'Unknown query parameter "nickname".',
        },
        { field: "limit", code: "out_of_range", message: '"limit" must be between 1 and 100.' },
      ],
    });
  });
});

describe("error responses", () => {
  it("answers an unknown route with a 404 problem", async () => {
    const { response, body } = await get("/nope");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(body).toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "No route matches this path.",
      code: "not_found",
    });
  });

  it("hides the exception behind a 500 problem", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createApp();
    failing.get("/boom", () => {
      throw new Error("secret internal detail");
    });

    const response = await failing.request("/boom");
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(JSON.parse(text)).toEqual({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      detail: "The server could not complete this request.",
      code: "internal_error",
    });
    expect(text).not.toContain("secret internal detail");
    expect(logged).toHaveBeenCalledOnce();
  });
});

const newUser = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };

function postJson(target: ReturnType<typeof createApp>, body: string) {
  return target.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("engine routes", () => {
  it("answers creates statelessly by default", async () => {
    const stateless = createApp();
    const created = await postJson(stateless, JSON.stringify(newUser));
    expect(created.status).toBe(201);
    expect(created.headers.get("x-mock-state")).toBe("stateless");
    expect(created.headers.get("location")).toBe(`/v1/users/${nextId}`);
    expect((await stateless.request(`/v1/users/${nextId}`)).status).toBe(404);
  });

  it("stores creates in an injected memory engine", async () => {
    const stateful = createApp({ engine: createEngine({ state: "memory" }) });
    const created = await postJson(stateful, JSON.stringify(newUser));
    const read = await stateful.request(`/v1/users/${nextId}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("x-mock-state")).toBe("memory");
    expect(await read.json()).toEqual(await created.json());
  });

  it("answers HEAD without a body", async () => {
    const response = await app.request("/v1/users", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe("");
  });

  it("returns 405 with the allowed methods", async () => {
    const response = await app.request("/v1/users/1", { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, PUT, PATCH, DELETE");
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it("passes PUT, PATCH and DELETE bodies through to the engine", async () => {
    const stateful = createApp({ engine: createEngine({ state: "memory" }) });
    const send = (method: string, path: string, json?: unknown) =>
      stateful.request(path, {
        method,
        ...(json === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(json) }),
      });

    const patched = await send("PATCH", "/v1/users/1", { name: "Changed Name" });
    expect(patched.status).toBe(200);
    expect(await (await stateful.request("/v1/users/1")).json()).toMatchObject({
      name: "Changed Name",
    });

    const replaced = await send("PUT", "/v1/todos/1", { userId: 1, title: "Replaced" });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ title: "Replaced", priority: "normal" });

    const removed = await send("DELETE", "/v1/todos/1");
    expect(removed.status).toBe(204);
    expect(removed.headers.get("content-type")).toBeNull();
    expect(removed.headers.get("x-mock-state")).toBe("memory");
    expect(await removed.text()).toBe("");
    expect((await send("DELETE", "/v1/todos/1")).status).toBe(404);
  });

  it("stores nothing from writes in the default stateless engine", async () => {
    const response = await app.request("/v1/todos/1", { method: "DELETE" });
    expect(response.status).toBe(204);
    expect(response.headers.get("x-mock-state")).toBe("stateless");
    expect((await app.request("/v1/todos/1")).status).toBe(200);
  });

  it("keeps health checks outside the engine", async () => {
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-mock-state")).toBeNull();
  });
});

describe("images over Hono", () => {
  it("serves placeholder and avatar SVGs with cache and safety headers", async () => {
    const image = await app.request("/img/600x400?text=Hero");
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/svg+xml");
    expect(image.headers.get("cache-control")).toBe("public, max-age=604800");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(await image.text()).toContain(">Hero</text>");
    const avatar = await app.request("/img/avatar/jane-doe?size=40");
    expect(await avatar.text()).toContain('width="40" height="40"');
  });

  it("answers HEAD without a body and a broken image with no-store", async () => {
    const head = await app.request("/img/64", { method: "HEAD" });
    expect(head.headers.get("content-type")).toBe("image/svg+xml");
    expect(await head.text()).toBe("");
    const broken = await app.request("/img/64?_mock.status=404");
    expect(broken.status).toBe(404);
    expect(broken.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the avatar URL a fixture user carries", async () => {
    const [user] = corePack.data.users;
    const response = await app.request(user?.avatar.url ?? "");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('width="96" height="96"');
  });
});

describe("simulation controls over Hono", () => {
  it("reads control headers and waits out a simulated delay", async () => {
    const started = Date.now();
    const response = await app.request("/v1/users?_mock.delay=60", {
      headers: { "X-Mock-Scenario": "maintenance" },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-mock-applied")).toBe(
      "scenario=maintenance, status=503, delay=60",
    );
  });

  it("answers at once without a delay", async () => {
    const started = Date.now();
    expect((await app.request("/v1/users?_mock.status=204")).status).toBe(204);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("sends body faults as raw text", async () => {
    const malformed = await app.request("/v1/users/1?_mock.body=malformed-json");
    expect(malformed.headers.get("content-type")).toBe("application/json");
    await expect(malformed.json()).rejects.toThrow();
    const empty = await app.request("/v1/users/1?_mock.body=empty");
    expect(await empty.text()).toBe("");
  });

  it("reads another pack on the stateless default engine", async () => {
    const response = await app.request("/v1/users?_mock.fixture=edge@1");
    expect(userPage.parse(await response.json()).meta).toMatchObject({ total: 9 });
  });
});

describe("request body limit", () => {
  it("passes a body of exactly the limit to the engine", async () => {
    const engine = createEngine({ state: "memory" });
    const handle = vi.spyOn(engine, "handle");
    const response = await postJson(createApp({ engine }), `{}${" ".repeat(maxBodyBytes - 2)}`);
    expect(response.status).toBe(422);
    expect(handle).toHaveBeenCalledOnce();
  });

  it("rejects a larger body with 413 before the engine runs", async () => {
    const engine = createEngine({ state: "memory" });
    const handle = vi.spyOn(engine, "handle");
    const response = await postJson(createApp({ engine }), `{}${" ".repeat(maxBodyBytes - 1)}`);
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(await response.json()).toEqual({
      type: "about:blank",
      title: "Content Too Large",
      status: 413,
      detail: "The request body must be at most 262144 bytes.",
      code: "body_too_large",
    });
    expect(handle).not.toHaveBeenCalled();
  });
});
