import { createEngine, type Engine, type EngineOptions, serialize } from "@loadstate/core";
import { startServer } from "@loadstate/server";
import { setupServer } from "msw/node";
import { describe, expect, it } from "vitest";
import { createHandlers } from "../src/index.js";

type Send = (method: string, path: string, json?: unknown) => Promise<Response>;

const options: EngineOptions = {
  state: "memory",
  sequences: { "GET /v1/users/:id": [503, 503] },
};
const newUser = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };
const observedHeaders = ["content-type", "location", "x-mock-state", "allow"];

function init(method: string, json?: unknown): RequestInit {
  return json === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(json) };
}

async function observe(response: Response) {
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(observedHeaders.map((name) => [name, response.headers.get(name)])),
    body: text === "" ? null : JSON.parse(text),
  };
}

// one workflow: list, create, retry through failures, validate, reset
async function runScenario(engine: Engine, send: Send) {
  const results: Awaited<ReturnType<typeof observe>>[] = [];
  const step = async (method: string, path: string, json?: unknown) => {
    results.push(await observe(await send(method, path, json)));
  };

  await step("GET", "/v1/users?limit=2");
  await step("POST", "/v1/users", newUser);
  await step("GET", "/v1/users/26");
  await step("GET", "/v1/users/26");
  await step("GET", "/v1/users/26");
  await step("GET", "/v1/users?offset=24");
  await step("POST", "/v1/users", { id: 99, name: "" });
  await step("DELETE", "/v1/users/26");
  await step("DELETE", "/v1/users/007");
  await step("HEAD", "/v1/nope");
  engine.reset();
  await step("GET", "/v1/users/26");
  await step("GET", "/v1/users/26");
  await step("GET", "/v1/users/26");
  await step("GET", "/v1/users?limit=1&offset=24");
  return results;
}

async function inProcess() {
  const engine = createEngine(options);
  return runScenario(engine, async (method, path, json) => {
    const url = new URL(path, "http://in-process.test");
    const { status, headers, body } = serialize(
      engine.handle({
        method,
        path: url.pathname,
        query: url.searchParams,
        contentType: json === undefined ? undefined : "application/json",
        body: json === undefined ? undefined : JSON.stringify(json),
      }),
    );
    return new Response(body, { status, headers });
  });
}

async function overHttp() {
  const engine = createEngine(options);
  const server = await startServer({ port: 0, engine });
  try {
    return await runScenario(engine, (method, path, json) =>
      fetch(`${server.url}${path}`, init(method, json)),
    );
  } finally {
    await server.close();
  }
}

async function throughMsw() {
  const engine = createEngine(options);
  const baseUrl = "http://api.loadstate.test";
  const server = setupServer(...createHandlers(engine, { baseUrl }));
  server.listen({ onUnhandledFrame: "error" });
  try {
    return await runScenario(engine, (method, path, json) =>
      fetch(`${baseUrl}${path}`, init(method, json)),
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
      200, 201, 503, 503, 200, 200, 422, 405, 404, 404, 503, 503, 404, 200,
    ]);
    expect(reference[1]?.headers.location).toBe("/v1/users/26");
    expect(reference[4]?.body).toEqual(reference[1]?.body);
    expect(reference[5]?.body).toMatchObject({ meta: { total: 26 } });
    expect(reference[7]?.headers.allow).toBe("GET, HEAD");
    expect(reference[9]?.body).toBeNull();
    expect(reference[13]?.body).toMatchObject({ meta: { total: 25 } });
    for (const result of reference) expect(result.headers["x-mock-state"]).toBe("memory");

    expect(http).toEqual(reference);
    expect(msw).toEqual(reference);

    // an engine created alongside the others is untouched
    expect(bystander.handle({ method: "GET", path: "/v1/users/1" }).status).toBe(503);
    expect(bystander.handle({ method: "GET", path: "/v1/users" }).body).toMatchObject({
      meta: { total: 25 },
    });
  });
});
