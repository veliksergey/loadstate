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

type Send = (
  method: string,
  path: string,
  json?: unknown,
  headers?: Record<string, string>,
) => Promise<Response>;

const options: EngineOptions = {
  state: "memory",
  sequences: { "GET /v1/users/:id": [503, 503] },
};
const userCount = corePack.data.users.length;
const nextId = userCount + 1;
const newUser = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };
const observedHeaders = [
  "content-type",
  "location",
  "x-mock-state",
  "allow",
  "link",
  "x-mock-applied",
  "cache-control",
  "retry-after",
];
// each transport adds its own accept, user-agent and content-length, so an echo is compared
// on the headers the scenario sets
const echoCompared = ["content-type", "x-request-id"];

// a body sent as it is, with its own media type, instead of as JSON
interface Raw {
  raw: string;
  type: string;
}
const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && "raw" in value;

function encode(json: unknown): { type: string; body: string } {
  return isRaw(json)
    ? { type: json.type, body: json.raw }
    : { type: "application/json", body: JSON.stringify(json) };
}

function init(method: string, json?: unknown, headers: Record<string, string> = {}): RequestInit {
  if (json === undefined) return { method, headers };
  const { type, body } = encode(json);
  return { method, headers: { "content-type": type, ...headers }, body };
}

// body faults are not JSON, so they compare as text
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// image URLs carry each adapter's own base, so compare them with that base masked
async function observe(response: Response, base: string) {
  const text = (await response.text()).replaceAll(base, "<base>");
  return {
    status: response.status,
    headers: Object.fromEntries(
      observedHeaders.map((name) => [
        name,
        response.headers.get(name)?.replaceAll(base, "<base>") ?? null,
      ]),
    ),
    body: comparable(text === "" ? null : parse(text)),
  };
}

function comparable(body: unknown): unknown {
  const isEcho =
    typeof body === "object" && body !== null && "bodyBytes" in body && "headers" in body;
  if (!isEcho) return body;
  const headers = Object.entries(body.headers as Record<string, string>);
  return {
    ...body,
    headers: Object.fromEntries(headers.filter(([name]) => echoCompared.includes(name))),
  };
}

// one workflow: list, create, retry through failures, validate, write, delete, query, reset
async function runScenario(engine: Engine, base: string, send: Send) {
  const results: Awaited<ReturnType<typeof observe>>[] = [];
  const step = async (
    method: string,
    path: string,
    json?: unknown,
    headers?: Record<string, string>,
  ) => {
    results.push(await observe(await send(method, path, json, headers), base));
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
  await step("GET", "/v1/products?page=2&perPage=5&sort=-priceMinor");
  await step("GET", "/v1/posts?pagination=cursor&limit=3&sort=title&q=a");
  const cursor = (results.at(-1)?.body as { meta: { nextCursor: string } } | undefined)?.meta
    .nextCursor;
  await step("GET", `/v1/posts?sort=title&q=a&limit=3&cursor=${cursor}`);
  await step("GET", "/v1/comments/1?fields=id,body&expand=author,post");
  await step("GET", "/v1/users/1/posts?fields=id,title&status=published");
  await step("GET", "/v1/products?status=nope");
  await step("GET", "/v1/users/1", undefined, { "X-Mock-Status": "503" });
  await step("GET", "/v1/users?_mock.scenario=slow&_mock.delay=30&limit=1");
  await step("GET", "/v1/users/1?_mock.body=html");
  await step("GET", "/v1/products?_mock.scenario=empty");
  await step("GET", "/v1/users?_mock.fixture=edge@1");
  await step("POST", "/v1/users?_mock.scenario=validation-error", newUser);
  await step("GET", "/v1/users?_mock.nope=1");
  await step("GET", "/img/600x400?seed=parity&style=pattern&text=Hi");
  await step("HEAD", "/img/avatar/jane-doe?style=identicon");
  await step("GET", "/img/5x400");
  await step("GET", "/img/600?_mock.status=404");
  await step("GET", "/v1");
  await step("GET", "/capabilities");
  await step("GET", "/v1/_utils/status/401");
  await step("HEAD", "/openapi.json");
  await step(
    "POST",
    "/v1/_utils/echo?tag=a&tag=b",
    { hello: "wörld" },
    { authorization: "Bearer parity-token", "x-request-id": "parity-1" },
  );
  await step(
    "PUT",
    "/v1/_utils/echo",
    { raw: "plain text ✓", type: "text/plain; charset=utf-8" },
    { "x-api-key": "parity-key" },
  );
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
  return runScenario(engine, base, async (method, path, json, sent = {}) => {
    const url = new URL(path, base);
    const encoded = json === undefined ? undefined : encode(json);
    // a transport passes Content-Type among the request headers too
    const all = encoded ? { "content-type": encoded.type, ...sent } : sent;
    const { status, headers, body } = serialize(
      engine.handle({
        method,
        path: url.pathname,
        query: url.searchParams,
        headers: Object.entries(all),
        contentType: encoded?.type,
        body: encoded?.body,
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
    return await runScenario(engine, server.url, (method, path, json, headers) =>
      fetch(`${server.url}${path}`, init(method, json, headers)),
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
    return await runScenario(engine, base, (method, path, json, headers) =>
      fetch(`${base}${path}`, init(method, json, headers)),
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
      200, 201, 503, 503, 200, 200, 422, 200, 200, 409, 409, 204, 404, 405, 404, 404, 200, 200, 200,
      200, 200, 200, 200, 400, 503, 200, 200, 200, 409, 422, 400, 200, 200, 400, 404, 200, 200, 401,
      200, 200, 200, 503, 503, 404, 200,
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
      createdAt: (reference[1]?.body as { createdAt: string } | undefined)?.createdAt,
    });
    expect(reference[9]?.body).toMatchObject({ code: "conflict" });
    expect(reference[10]?.body).toMatchObject({ code: "has_dependents" });
    expect(reference[11]).toMatchObject({ body: null, headers: { "content-type": null } });
    expect(reference[13]?.headers.allow).toBe("GET, HEAD, PUT, PATCH, DELETE");
    expect(reference[16]?.body).toMatchObject({
      images: [{ url: expect.stringMatching(/^<base>\/img\//) }],
    });
    expect(reference[17]?.body).toMatchObject({ meta: { limit: 3 } });
    expect(reference[18]?.body).toMatchObject({ meta: { page: 2, perPage: 5 } });
    expect(reference[18]?.headers.link).toContain(
      '<<base>/v1/products?sort=-priceMinor&page=1&perPage=5>; rel="first"',
    );
    expect(reference[19]?.body).toMatchObject({ meta: { prevCursor: null, hasMore: true } });
    expect(reference[20]?.body).toMatchObject({ meta: { prevCursor: expect.any(String) } });
    expect(reference[21]?.body).toMatchObject({
      id: 1,
      author: { avatar: { url: expect.stringMatching(/^<base>\/img\//) } },
      post: { id: expect.any(Number) },
    });
    expect(Object.keys(reference[21]?.body as object)).toEqual(["id", "body", "author", "post"]);
    expect(reference[22]?.body).toMatchObject({ data: expect.any(Array) });
    expect(reference[23]?.body).toMatchObject({ code: "invalid_query" });
    expect(reference[24]?.headers).toMatchObject({
      "retry-after": "60",
      "x-mock-applied": "status=503",
      "cache-control": "no-store",
    });
    expect(reference[25]?.headers["x-mock-applied"]).toBe("scenario=slow, delay=30");
    expect(reference[26]?.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(reference[26]?.body).toMatch(/^<!doctype html>/);
    expect(reference[27]?.body).toMatchObject({ data: [], meta: { total: 0 } });
    expect(reference[28]?.body).toMatchObject({ code: "fixture_locked" });
    expect(reference[29]?.body).toMatchObject({ code: "validation_failed" });
    expect(reference[30]?.body).toMatchObject({ code: "invalid_controls" });
    expect(reference[31]?.headers).toMatchObject({
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=604800",
    });
    expect(reference[31]?.body).toMatch(/^<svg /);
    expect(reference[32]).toMatchObject({
      body: null,
      headers: { "content-type": "image/svg+xml" },
    });
    expect(reference[33]?.body).toMatchObject({ code: "invalid_image" });
    expect(reference[34]?.headers["cache-control"]).toBe("no-store");
    expect(reference[35]?.body).toMatchObject({
      links: { docs: "<base>/docs" },
      resources: expect.arrayContaining([expect.objectContaining({ href: "<base>/v1/users" })]),
    });
    expect(reference[36]?.body).toMatchObject({ state: "memory" });
    expect(reference[37]?.headers).toMatchObject({ "cache-control": "no-store" });
    expect(reference[38]).toMatchObject({
      body: null,
      headers: { "content-type": "application/json" },
    });
    expect(reference[39]?.body).toEqual({
      method: "POST",
      path: "/v1/_utils/echo",
      query: { tag: ["a", "b"] },
      headers: { "content-type": "application/json", "x-request-id": "parity-1" },
      redacted: ["authorization"],
      body: { hello: "wörld" },
      bodyText: null,
      truncated: false,
      bodyBytes: 18,
    });
    expect(reference[40]?.body).toMatchObject({
      headers: { "content-type": "text/plain; charset=utf-8" },
      redacted: ["x-api-key"],
      body: null,
      bodyText: "plain text ✓",
      bodyBytes: 14,
    });
    expect(reference[44]?.body).toMatchObject({ meta: { total: userCount } });
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
