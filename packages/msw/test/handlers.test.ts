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

describe("CORS and discovery through MSW", () => {
  it("adds CORS headers and answers preflights before the engine", async () => {
    const response = await fetch("http://api.loadstate.test/api/v1/users?limit=1", {
      headers: { origin: "https://app.test" },
    });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const handle = vi.spyOn(engine, "handle");
    const answer = await fetch("http://api.loadstate.test/api/v1/users", {
      method: "OPTIONS",
      headers: { origin: "https://app.test", "access-control-request-method": "POST" },
    });
    expect(answer.status).toBe(204);
    expect(answer.headers.get("access-control-allow-headers")).toContain("X-Mock-Status");
    expect(handle).not.toHaveBeenCalled();
  });

  it("serves the catalog and the documents under the base path", async () => {
    const catalog = await (await fetch("http://api.loadstate.test/api/v1")).json();
    expect(catalog.links.openapi).toBe("http://api.loadstate.test/api/openapi.json");
    const document = await (await fetch(catalog.links.openapi)).json();
    expect(document.openapi).toBe("3.1.2");
  });
});

describe("images through MSW", () => {
  it("serves image URLs under the base path", async () => {
    const response = await fetch("http://api.loadstate.test/api/img/120x80?style=gradient");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toContain('width="120" height="80"');
  });

  it("serves the image URLs that records carry", async () => {
    const page = await (await fetch("http://api.loadstate.test/api/v1/products/1")).json();
    const image = await fetch(page.images[0].url);
    expect(image.status).toBe(200);
    expect(await image.text()).toContain('width="800" height="800"');
  });
});

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

describe("echo through MSW", () => {
  it("echoes a JSON body and counts received bytes", async () => {
    const response = await fetch("http://api.loadstate.test/api/v1/_utils/echo", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: "session=secret" },
      body: JSON.stringify({ hello: "wörld" }),
    });
    const echoed = await response.json();
    expect(echoed).toMatchObject({ body: { hello: "wörld" }, bodyBytes: 18, redacted: ["cookie"] });
    const bom = await fetch("http://api.loadstate.test/api/v1/_utils/echo", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: new Uint8Array([0xef, 0xbb, 0xbf, 0x61]),
    });
    expect((await bom.json()).bodyBytes).toBe(4);
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
