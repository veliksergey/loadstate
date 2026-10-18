import { corePack, createEngine } from "@loadstate/core";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHandlers } from "../src/index.js";

const engine = createEngine({ state: "memory" });
const server = setupServer(
  ...createHandlers(engine, { baseUrl: "http://api.loadstate.test/api/" }),
);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  engine.reset();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

describe("simulation controls through MSW", () => {
  it("reads control headers and waits out a simulated delay", async () => {
    const started = Date.now();
    const response = await fetch("http://api.loadstate.test/api/v1/users/1?_mock.delay=60", {
      headers: { "X-Mock-Status": "503" },
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-mock-applied")).toBe("status=503, delay=60");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("sends a body fault as raw text", async () => {
    const response = await fetch("http://api.loadstate.test/api/v1/users/1?_mock.body=html");
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toMatch(/^<!doctype html>/);
  });
});

describe("createHandlers", () => {
  it("forwards requests under the base path to the engine", async () => {
    const response = await fetch("http://api.loadstate.test/api/v1/users?limit=1&offset=2");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-mock-state")).toBe("memory");
    expect(await response.json()).toMatchObject({
      data: [{ id: 3 }],
      meta: { limit: 1, offset: 2, total: corePack.data.users.length, hasMore: true },
    });
  });

  it("passes the method, content type and body through", async () => {
    const created = await fetch("http://api.loadstate.test/api/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ines Duarte", username: "ines", email: "ines@example.com" }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("location")).toBe(`/v1/users/${corePack.data.users.length + 1}`);

    const wrongType = await fetch("http://api.loadstate.test/api/v1/users", {
      method: "POST",
      body: "name=Ines",
    });
    expect(wrongType.status).toBe(415);
  });

  it("answers unknown paths under the base path from the engine", async () => {
    const response = await fetch("http://api.loadstate.test/api/v1/widgets");
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
  });

  it.each([
    "http://api.loadstate.test/v1/users",
    "http://api.loadstate.test/apix/v1/users",
    "http://elsewhere.test/api/v1/users",
  ])("treats %s as unhandled", async (url) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(fetch(url)).rejects.toThrow();
  });
});

describe("base URLs with pattern characters", () => {
  it.each([
    ["http://api.loadstate.test/api:v1", "/api:v1/v1/users", "/apiXYZ/v1/users"],
    ["http://api.loadstate.test/v*", "/v*/v1/users", "/vanything/v1/users"],
  ])("matches %s literally", async (baseUrl, inside, outside) => {
    server.resetHandlers(...createHandlers(engine, { baseUrl }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await fetch(`http://api.loadstate.test${inside}`)).status).toBe(200);
    await expect(fetch(`http://api.loadstate.test${outside}`)).rejects.toThrow();
  });
});
