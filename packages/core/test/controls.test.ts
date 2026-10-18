import { describe, expect, it } from "vitest";
import {
  corePack,
  createEngine,
  type Engine,
  type EngineOptions,
  type EngineResponse,
  edgePack,
  serialize,
  simulatedStatuses,
} from "../src/index.js";

const stateless = (options: Partial<EngineOptions> = {}) =>
  createEngine({ state: "stateless", random: () => 0.5, ...options });
const memory = (options: Partial<EngineOptions> = {}) =>
  createEngine({ state: "memory", random: () => 0.5, ...options });

function send(
  engine: Engine,
  method: string,
  path: string,
  query = "",
  headers: [string, string][] = [],
  body?: unknown,
): EngineResponse {
  return engine.handle({
    method,
    path,
    query: new URLSearchParams(query),
    headers,
    ...(body === undefined ? {} : { contentType: "application/json", body: JSON.stringify(body) }),
  });
}

type Issue = { field: string; code: string; message: string };
const issues = (response: EngineResponse) => (response.body as { errors?: Issue[] }).errors ?? [];
const codes = (response: EngineResponse) =>
  issues(response).map((issue) => `${issue.field}:${issue.code}`);
const total = (response: EngineResponse) =>
  (response.body as { meta: { total: number } }).meta.total;
const users = corePack.data.users.length;
const newUser = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };

describe("reading controls", () => {
  it("takes the same control from the query or a header", () => {
    const fromQuery = send(stateless(), "GET", "/v1/users", "_mock.status=503");
    const fromHeader = send(stateless(), "GET", "/v1/users", "", [["X-Mock-Status", "503"]]);
    expect(fromQuery.status).toBe(503);
    expect(fromHeader).toEqual(fromQuery);
  });

  it("matches header names without regard to case", () => {
    expect(send(stateless(), "GET", "/v1/users", "", [["x-mock-status", "404"]]).status).toBe(404);
  });

  it("lets the query win and then ignores the header entirely", () => {
    const response = send(stateless(), "GET", "/v1/users", "_mock.status=500", [
      ["X-Mock-Status", "not a status"],
    ]);
    expect(response.status).toBe(500);
  });

  it("removes controls before the route reads its own query", () => {
    const response = send(stateless(), "GET", "/v1/users/1", "_mock.delay=0");
    expect(response.status).toBe(200);
    expect(response.body).toEqual(corePack.data.users[0]);
  });

  it("answers routing errors before reading controls", () => {
    expect(send(stateless(), "GET", "/v1/nope", "_mock.nope=1").status).toBe(404);
    expect(send(stateless(), "DELETE", "/v1/users", "_mock.status=503").status).toBe(405);
  });

  it.each([
    ["_mock.nope=1", [], "_mock.nope:unknown_control"],
    ["", [["X-Mock-Nope", "1"]], "X-Mock-Nope:unknown_control"],
    ["_mock.delay=1&_mock.delay=2", [], "_mock.delay:duplicate_control"],
    [
      "",
      [
        ["X-Mock-Delay", "1"],
        ["X-Mock-Delay", "2"],
      ],
      "X-Mock-Delay:duplicate_control",
    ],
    ["_mock.delay=soon", [], "_mock.delay:invalid_value"],
    ["_mock.status=418", [], "_mock.status:invalid_value"],
    ["_mock.status=503.0", [], "_mock.status:invalid_value"],
    ["_mock.scenario=chaos", [], "_mock.scenario:invalid_value"],
    ["_mock.body=xml", [], "_mock.body:invalid_value"],
    ["_mock.scenario=retry-then-ok&_mock.step=4", [], "_mock.step:invalid_value"],
    ["_mock.failRate=1.5", [], "_mock.failRate:invalid_value"],
    ["_mock.fixture=core@9", [], "_mock.fixture:invalid_value"],
    ["_mock.failRate=0.5&_mock.seed=-1", [], "_mock.seed:invalid_value"],
    ["_mock.failRate=0.5&_mock.seed=4294967296", [], "_mock.seed:invalid_value"],
  ] as [string, [string, string][], string][])("refuses %s %j", (query, headers, expected) => {
    const response = send(stateless(), "GET", "/v1/users", query, headers);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      title: "Bad Request",
      code: "invalid_controls",
      detail: "The simulation controls are not valid.",
    });
    expect(codes(response)).toEqual([expected]);
  });

  it("explains each problem", () => {
    expect(issues(send(stateless(), "GET", "/v1/users", "_mock.dealy=5"))[0]?.message).toBe(
      'Unknown control "_mock.dealy". Use one of: _mock.delay, _mock.status, _mock.scenario, _mock.body, _mock.step, _mock.failRate, _mock.fixture, _mock.seed.',
    );
    expect(issues(send(stateless(), "GET", "/v1/users", "_mock.status=418"))[0]?.message).toBe(
      `"_mock.status" must be one of: ${simulatedStatuses.join(", ")}.`,
    );
  });
});

describe("delays", () => {
  it("returns the delay as an effect and never waits itself", () => {
    const started = Date.now();
    const response = send(stateless(), "GET", "/v1/users", "_mock.delay=10000");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(response.status).toBe(200);
    expect(response.delayMs).toBe(10_000);
    expect(response.headers["x-mock-applied"]).toBe("delay=10000");
  });

  it("reports a zero delay without an effect", () => {
    const response = send(stateless(), "GET", "/v1/users", "_mock.delay=0");
    expect(response.delayMs).toBeUndefined();
    expect(response.headers["x-mock-applied"]).toBe("delay=0");
  });

  it("refuses a delay over the host limit", () => {
    const response = send(stateless({ maxDelayMs: 500 }), "GET", "/v1/users", "_mock.delay=501");
    expect(issues(response)).toEqual([
      {
        field: "_mock.delay",
        code: "limit_exceeded",
        message: '"_mock.delay" must be at most 500 ms on this host.',
      },
    ]);
    expect(send(stateless(), "GET", "/v1/users", "_mock.delay=10001").status).toBe(400);
  });

  it("refuses an invalid host limit", () => {
    expect(() => createEngine({ state: "stateless", maxDelayMs: -1 })).toThrow(/maxDelayMs/);
  });
});

describe("simulated statuses", () => {
  const errors = simulatedStatuses.filter((status) => status !== 204);

  it.each(errors)("answers %i with Problem Details", (status) => {
    const response = send(stateless(), "GET", "/v1/users", `_mock.status=${status}`);
    expect(response.status).toBe(status);
    expect(response.headers["content-type"]).toBe("application/problem+json");
    expect(response.body).toMatchObject({
      status,
      code: "simulated_status",
      detail: `Simulated ${status} from _mock.status.`,
    });
    const retry = status === 429 ? "5" : status === 503 ? "60" : undefined;
    expect(response.headers["retry-after"]).toBe(retry);
  });

  it("answers 204 with no body", () => {
    const response = send(stateless(), "GET", "/v1/users", "_mock.status=204");
    expect(response.status).toBe(204);
    expect(response.body).toBeUndefined();
    expect(response.headers["content-type"]).toBeUndefined();
  });

  it("answers before a write, so nothing changes", () => {
    const engine = memory();
    expect(send(engine, "POST", "/v1/users", "_mock.status=500", [], newUser).status).toBe(500);
    expect(send(engine, "DELETE", "/v1/todos/1", "_mock.status=204").status).toBe(204);
    expect(total(send(engine, "GET", "/v1/users"))).toBe(users);
    expect(send(engine, "GET", "/v1/todos/1").status).toBe(200);
  });

  it("outranks a configured sequence without consuming its step", () => {
    const engine = memory({ sequences: { "GET /v1/users/:id": [503] } });
    expect(send(engine, "GET", "/v1/users/1", "_mock.status=404").status).toBe(404);
    expect(send(engine, "GET", "/v1/users/1").status).toBe(503);
    expect(send(engine, "GET", "/v1/users/1").status).toBe(200);
  });
});

describe("scenarios", () => {
  const scenario = (name: string, method = "GET", path = "/v1/users", extra = "") =>
    send(
      stateless(),
      method,
      path,
      `_mock.scenario=${name}${extra}`,
      [],
      method === "GET" ? undefined : newUser,
    );

  it.each([
    ["error", 500, undefined],
    ["unauthorized", 401, undefined],
    ["forbidden", 403, undefined],
    ["notfound", 404, undefined],
    ["ratelimited", 429, "5"],
    ["maintenance", 503, "60"],
  ])("answers %s with %i", (name, status, retry) => {
    const response = scenario(name);
    expect(response.status).toBe(status);
    expect(response.body).toMatchObject({
      code: "simulated_status",
      detail: `Simulated ${status} from the ${name} scenario.`,
    });
    expect(response.headers["retry-after"]).toBe(retry);
    expect(response.headers["x-mock-applied"]).toBe(`scenario=${name}, status=${status}`);
  });

  it("waits 2000 ms for slow, within the host limit, unless a delay is given", () => {
    expect(scenario("slow")).toMatchObject({ status: 200, delayMs: 2_000 });
    const capped = send(
      stateless({ maxDelayMs: 1_000 }),
      "GET",
      "/v1/users",
      "_mock.scenario=slow",
    );
    expect(capped.delayMs).toBe(1_000);
    expect(scenario("slow", "GET", "/v1/users", "&_mock.delay=100").delayMs).toBe(100);
  });

  it("waits the host limit, then answers 504, for timeout", () => {
    expect(scenario("timeout")).toMatchObject({ status: 504, delayMs: 10_000 });
    const short = send(
      stateless({ maxDelayMs: 300 }),
      "GET",
      "/v1/users",
      "_mock.scenario=timeout",
    );
    expect(short).toMatchObject({ status: 504, delayMs: 300 });
  });

  it("hides every record from reads for empty", () => {
    const list = scenario("empty");
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ data: [], meta: { total: 0, hasMore: false } });
    expect(scenario("empty", "GET", "/v1/users/1").status).toBe(404);
    expect(scenario("empty", "GET", "/v1/users/1/posts").status).toBe(404);
    const page = scenario("empty", "GET", "/v1/posts", "&page=2&perPage=5");
    expect(page.body).toMatchObject({ meta: { page: 2, total: 0, totalPages: 0 } });
    expect(scenario("empty", "POST").status).toBe(201);
  });

  it("refuses every required field of a write for validation-error", () => {
    const response = scenario("validation-error", "POST");
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: "validation_failed" });
    expect(issues(response)).toEqual(
      ["name", "username", "email"].map((field) => ({
        field,
        code: "simulated",
        message: `"${field}" was rejected by the validation-error scenario.`,
      })),
    );
    expect(scenario("validation-error", "PATCH", "/v1/users/1").status).toBe(422);
    expect(scenario("validation-error", "PUT", "/v1/users/1").status).toBe(422);
    expect(scenario("validation-error").status).toBe(200);
    const engine = memory();
    send(engine, "POST", "/v1/users", "_mock.scenario=validation-error", [], newUser);
    expect(total(send(engine, "GET", "/v1/users"))).toBe(users);
  });

  it("fails twice and then succeeds for retry-then-ok", () => {
    for (const step of [1, 2]) {
      const response = scenario("retry-then-ok", "GET", "/v1/users", `&_mock.step=${step}`);
      expect(response.status).toBe(503);
      expect(response.headers["retry-after"]).toBe("1");
    }
    const done = scenario("retry-then-ok", "GET", "/v1/users", "&_mock.step=3");
    expect(done.status).toBe(200);
    expect(done.headers["x-mock-applied"]).toBe("scenario=retry-then-ok, step=3");
    expect(codes(scenario("retry-then-ok"))).toEqual(["_mock.scenario:incompatible_controls"]);
    expect(codes(scenario("slow", "GET", "/v1/users", "&_mock.step=1"))).toEqual([
      "_mock.step:incompatible_controls",
    ]);
  });

  it("delays 200 to 800 ms and fails 30 % of the time for flaky", () => {
    const at = (draw: number) =>
      send(stateless({ random: () => draw }), "GET", "/v1/users", "_mock.scenario=flaky");
    expect(at(0)).toMatchObject({ status: 500, delayMs: 200 });
    expect(at(0.29)).toMatchObject({ status: 500, delayMs: 374 });
    expect(at(0.3)).toMatchObject({ status: 200, delayMs: 380 });
    expect(at(0.999)).toMatchObject({ status: 200, delayMs: 800 });
  });

  it("lets explicit controls override a recipe", () => {
    const response = scenario("maintenance", "GET", "/v1/users", "&_mock.status=500");
    expect(response.status).toBe(500);
    expect(response.headers["retry-after"]).toBeUndefined();
    expect(scenario("flaky", "GET", "/v1/users", "&_mock.failRate=0").status).toBe(200);
  });
});

describe("random failures", () => {
  const draw = (value: number, query: string) =>
    send(stateless({ random: () => value }), "GET", "/v1/users", query);

  it("fails with the given probability", () => {
    expect(draw(0.29, "_mock.failRate=0.3").status).toBe(500);
    expect(draw(0.3, "_mock.failRate=0.3").status).toBe(200);
    expect(draw(0, "_mock.failRate=0").status).toBe(200);
    expect(draw(0.999, "_mock.failRate=1").status).toBe(500);
    expect(draw(0.5, "_mock.failRate=.5").status).toBe(200);
  });

  it("gives the same outcome for the same seed and request", () => {
    const outcomes = (seed: number) =>
      [0, 0.999].map(
        (value) => draw(value, `_mock.failRate=0.5&_mock.seed=${seed}&limit=5`).status,
      );
    for (let seed = 0; seed < 20; seed++) {
      const [first, second] = outcomes(seed);
      expect(first).toBe(second);
    }
    const spread = new Set(Array.from({ length: 40 }, (_, seed) => outcomes(seed)[0]));
    expect(spread).toEqual(new Set([200, 500]));
  });

  it("ties a seeded draw to the request", () => {
    const statuses = Array.from(
      { length: 40 },
      (_, offset) => draw(0, `_mock.failRate=0.5&_mock.seed=7&offset=${offset}`).status,
    );
    expect(new Set(statuses)).toEqual(new Set([200, 500]));
  });

  it("refuses a seed that nothing draws from", () => {
    expect(codes(draw(0, "_mock.seed=7"))).toEqual(["_mock.seed:incompatible_controls"]);
    expect(draw(0, "_mock.seed=7&_mock.scenario=flaky").status).not.toBe(400);
  });
});

describe("body faults", () => {
  const fault = (name: string, query = "") =>
    send(stateless(), "GET", "/v1/users/1", `_mock.body=${name}${query}`);
  const normal = JSON.stringify(corePack.data.users[0]);

  it("cuts the JSON in half for malformed-json", () => {
    const response = fault("malformed-json");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(response.rawBody).toBe(normal.slice(0, Math.floor(normal.length / 2)));
    expect(() => JSON.parse(response.rawBody ?? "")).toThrow();
    expect(serialize(response).body).toBe(response.rawBody);
  });

  it("sends no bytes for empty", () => {
    const response = fault("empty");
    expect(response).toMatchObject({ status: 200, rawBody: "" });
    expect(response.headers["content-type"]).toBe("application/json");
    expect(serialize(response).body).toBe("");
  });

  it("sends an HTML page for html, keeping the status", () => {
    const response = fault("html", "&_mock.status=502");
    expect(response.status).toBe(502);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.rawBody).toMatch(/^<!doctype html><html>.*<h1>502 Error<\/h1>/);
  });

  it("labels the JSON as text for wrong-content-type", () => {
    const response = fault("wrong-content-type");
    expect(response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(JSON.parse(response.rawBody ?? "")).toEqual(corePack.data.users[0]);
  });

  it.each([
    ["HEAD", "/v1/users", "_mock.body=empty"],
    ["DELETE", "/v1/todos/1", "_mock.body=empty"],
    ["GET", "/v1/users", "_mock.body=html&_mock.status=204"],
  ])("refuses a body fault on %s %s %s", (method, path, query) => {
    const response = send(stateless(), method, path, query);
    expect(response.status).toBe(400);
    if (method !== "HEAD") {
      expect(codes(response)).toEqual(["_mock.body:incompatible_controls"]);
    }
  });
});

describe("fixture packs", () => {
  it("picks a pack per request on a stateless engine", () => {
    const engine = stateless();
    expect(total(send(engine, "GET", "/v1/users", "_mock.fixture=edge@1"))).toBe(9);
    expect(total(send(engine, "GET", "/v1/users", "", [["X-Mock-Fixture", "edge@1"]]))).toBe(9);
    expect(total(send(engine, "GET", "/v1/users", "_mock.fixture=core@1"))).toBe(users);
    expect(total(send(engine, "GET", "/v1/users"))).toBe(users);
    const record = send(engine, "GET", "/v1/users/2", "_mock.fixture=edge@1");
    expect(record.body).toEqual(edgePack.data.users[1]);
  });

  it("runs a memory engine on one pack and refuses another", () => {
    const engine = memory({ fixture: "edge@1" });
    expect(total(send(engine, "GET", "/v1/users"))).toBe(9);
    expect(send(engine, "POST", "/v1/users", "", [], newUser).headers.location).toBe(
      "/v1/users/10",
    );
    expect(total(send(engine, "GET", "/v1/users", "_mock.fixture=edge@1"))).toBe(10);
    const refused = send(engine, "GET", "/v1/users", "_mock.fixture=core@1");
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({
      code: "fixture_locked",
      detail: "This run uses edge@1. Create a new engine to use core@1.",
    });
    engine.reset();
    expect(total(send(engine, "GET", "/v1/users"))).toBe(9);
    expect(send(memory(), "GET", "/v1/users", "_mock.fixture=edge@1").status).toBe(409);
  });

  it("refuses an unknown pack at creation", () => {
    expect(() => createEngine({ state: "memory", fixture: "core@9" })).toThrow(
      'Unknown fixture pack "core@9". Use one of: core@1, edge@1.',
    );
  });

  it("binds cursors to the pack", () => {
    const engine = stateless();
    const first = send(engine, "GET", "/v1/users", "pagination=cursor&limit=2");
    const cursor = (first.body as { meta: { nextCursor: string } }).meta.nextCursor;
    const elsewhere = send(
      engine,
      "GET",
      "/v1/users",
      `limit=2&cursor=${cursor}&_mock.fixture=edge@1`,
    );
    expect(codes(elsewhere)).toEqual(["cursor:cursor_mismatch"]);
  });
});

describe("debug headers", () => {
  it("lists the resolved controls and forbids caching", () => {
    const response = send(
      stateless(),
      "GET",
      "/v1/users",
      "_mock.scenario=ratelimited&_mock.delay=50",
    );
    expect(response.headers).toMatchObject({
      "x-mock-applied": "scenario=ratelimited, status=429, delay=50",
      "cache-control": "no-store",
      "x-mock-state": "stateless",
    });
  });

  it("orders every applied control the same way", () => {
    const response = send(
      stateless(),
      "GET",
      "/v1/users",
      "_mock.seed=3&_mock.failRate=0&_mock.body=empty&_mock.delay=5&_mock.fixture=edge@1",
    );
    expect(response.headers["x-mock-applied"]).toBe(
      "fixture=edge@1, delay=5, body=empty, failRate=0, seed=3",
    );
  });

  it("adds nothing to a response without controls", () => {
    const response = send(stateless(), "GET", "/v1/users");
    expect(response.headers["x-mock-applied"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBeUndefined();
  });

  it("keeps the headers and drops the body on HEAD", () => {
    const response = send(stateless(), "HEAD", "/v1/users", "_mock.status=503");
    expect(response).toEqual({
      status: 503,
      headers: expect.objectContaining({ "retry-after": "60", "cache-control": "no-store" }),
    });
    expect(response.body).toBeUndefined();
  });
});

describe("links and locations keep the request's pack", () => {
  const links = (response: EngineResponse) =>
    Object.fromEntries(
      (response.headers.link ?? "").split(", ").map((part) => {
        const [, url, rel] = /^<([^>]*)>; rel="(\w+)"$/.exec(part) ?? [];
        return [rel, url ?? ""];
      }),
    );
  const follow = (engine: Engine, url: string) => {
    const [path = "", query = ""] = url.split("?");
    return send(engine, "GET", path, query);
  };

  it("keeps query controls in pagination links", () => {
    const engine = stateless();
    const cursor = send(
      engine,
      "GET",
      "/v1/users",
      "_mock.fixture=edge@1&pagination=cursor&limit=2",
    );
    const next = follow(engine, links(cursor).next ?? "");
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ data: edgePack.data.users.slice(2, 4) });

    const offset = send(engine, "GET", "/v1/users", "_mock.fixture=edge@1&limit=2");
    expect(links(offset).next).toBe("/v1/users?_mock.fixture=edge%401&limit=2&offset=2");
    expect(follow(engine, links(offset).last ?? "").body).toMatchObject({
      data: edgePack.data.users.slice(8),
    });
  });

  it("points a stateless create on another pack at that pack", () => {
    const engine = stateless();
    const created = send(engine, "POST", "/v1/users", "_mock.fixture=edge@1", [], newUser);
    expect(created.headers.location).toBe("/v1/users/10?_mock.fixture=edge@1");
    expect(follow(engine, created.headers.location ?? "").status).toBe(404);
    expect(send(engine, "POST", "/v1/users", "", [], newUser).headers.location).toBe(
      `/v1/users/${users + 1}`,
    );
  });
});
