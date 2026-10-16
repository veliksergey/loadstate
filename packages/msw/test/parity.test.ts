import {
  corePack,
  createEngine,
  type Engine,
  type EngineOptions,
  serialize,
} from "@loadstate/core";
import { startServer } from "@loadstate/server";
import { setupServer } from "msw/node";
import { describe, expect, it } from "vitest";
import { createHandlers } from "../src/index.js";

type Send = (method: string, path: string, json?: unknown) => Promise<Response>;

const options: EngineOptions = {
  state: "memory",
  sequences: { "GET /v1/users/:id": [503, 503] },
};
const userCount = corePack.data.users.length;
const nextId = userCount + 1;
const newUser = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };
const observedHeaders = ["content-type", "location", "x-mock-state", "allow"];

function init(method: string, json?: unknown): RequestInit {
  return json === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(json) };
}

// image URLs carry each adapter's own base, so compare them with that base masked
async function observe(response: Response, base: string) {
  const text = (await response.text()).replaceAll(base, "<base>");
  return {
    status: response.status,
    headers: Object.fromEntries(observedHeaders.map((name) => [name, response.headers.get(name)])),
    body: text === "" ? null : JSON.parse(text),
  };
}

// one workflow: list, create, retry through failures, validate, write, delete, reset
async function runScenario(engine: Engine, base: string, send: Send) {
  const results: Awaited<ReturnType<typeof observe>>[] = [];
  const step = async (method: string, path: string, json?: unknown) => {
    results.push(await observe(await send(method, path, json), base));
  };

  await step("GET", "/v1/users?limit=2");
  await step("POST", "/v1/users", newUser);
  await step("GET", `/v1/users/${nextId}`);
  await step("GET", `/v1/users/${nextId}`);
  await step("GET", `/v1/users/${nextId}`);
  await step("GET", `/v1/users?offset=${userCount - 1}`);
  await step("POST", "/v1/users", { id: 99, name: "" });
  await step("PATCH", `/v1/users/${nextId}`, { name: "Ines D." });
  await step("PUT", `/v1/users/${nextId}`, { ...newUser, role: "editor" });
  await step("POST", "/v1/users", { ...newUser, username: "ines.other" });
  await step("DELETE", "/v1/users/1");
  await step("DELETE", `/v1/users/${nextId}`);
  await step("DELETE", `/v1/users/${nextId}`);
  await step("POST", `/v1/users/${nextId}`);
  await step("DELETE", "/v1/users/007");
  await step("HEAD", "/v1/nope");
  await step("GET", "/v1/products/1");
  await step("GET", "/v1/categories/2/products?limit=3");
  engine.reset();
  await step("GET", `/v1/users/${nextId}`);
  await step("GET", `/v1/users/${nextId}`);
  await step("GET", `/v1/users/${nextId}`);
  await step("GET", `/v1/users?limit=1&offset=${userCount - 1}`);
  return results;
}

async function inProcess() {
  const engine = createEngine(options);
  const base = "http://in-process.test";
  return runScenario(engine, base, async (method, path, json) => {
    const url = new URL(path, base);
    const { status, headers, body } = serialize(
      engine.handle({
        method,
        path: url.pathname,
        query: url.searchParams,
        contentType: json === undefined ? undefined : "application/json",
        body: json === undefined ? undefined : JSON.stringify(json),
        baseUrl: base,
      }),
    );
    return new Response(body, { status, headers });
  });
}

async function overHttp() {
  const engine = createEngine(options);
  const server = await startServer({ port: 0, engine });
  try {
    return await runScenario(engine, server.url, (method, path, json) =>
      fetch(`${server.url}${path}`, init(method, json)),
    );
  } finally {
    await server.close();
  }
}

async function throughMsw() {
  const engine = createEngine(options);
  const base = "http://api.loadstate.test";
  const server = setupServer(...createHandlers(engine, { baseUrl: base }));
  server.listen({ onUnhandledFrame: "error" });
  try {
    return await runScenario(engine, base, (method, path, json) =>
      fetch(`${base}${path}`, init(method, json)),
    );
  } finally {
    server.close();
  }
}

describe("adapter parity", () => {
  it("gives identical results in-process, over HTTP and through MSW", async () => {
    const bystander = createEngine(options);

    const reference = await inProcess();
    const http = await overHttp();
    const msw = await throughMsw();

    expect(reference.map((result) => result.status)).toEqual([
      200, 201, 503, 503, 200, 200, 422, 200, 200, 409, 409, 204, 404, 405, 404, 404, 200, 200, 503,
      503, 404, 200,
    ]);
    expect(reference[1]?.headers.location).toBe(`/v1/users/${nextId}`);
    expect(reference[4]?.body).toEqual(reference[1]?.body);
    expect(reference[4]?.body).toMatchObject({
      avatar: { url: "<base>/img/avatar/ines.duarte?size=96" },
    });
    expect(reference[5]?.body).toMatchObject({ meta: { total: nextId } });
    expect(reference[7]?.body).toMatchObject({ id: nextId, name: "Ines D." });
    expect(reference[8]?.body).toMatchObject({
      name: "Ines Duarte",
      role: "editor",
      createdAt: reference[1]?.body.createdAt,
    });
    expect(reference[9]?.body).toMatchObject({ code: "conflict" });
    expect(reference[10]?.body).toMatchObject({ code: "has_dependents" });
    expect(reference[11]).toMatchObject({ body: null, headers: { "content-type": null } });
    expect(reference[13]?.headers.allow).toBe("GET, HEAD, PUT, PATCH, DELETE");
    expect(reference[16]?.body).toMatchObject({
      images: [{ url: expect.stringMatching(/^<base>\/img\//) }],
    });
    expect(reference[17]?.body).toMatchObject({ meta: { limit: 3 } });
    expect(reference[21]?.body).toMatchObject({ meta: { total: userCount } });
    for (const result of reference) expect(result.headers["x-mock-state"]).toBe("memory");

    expect(http).toEqual(reference);
    expect(msw).toEqual(reference);

    // an engine created alongside the others is untouched
    expect(bystander.handle({ method: "GET", path: "/v1/users/1" }).status).toBe(503);
    expect(bystander.handle({ method: "GET", path: "/v1/users" }).body).toMatchObject({
      meta: { total: userCount },
    });
  });
});
