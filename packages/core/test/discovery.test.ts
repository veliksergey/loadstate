import { describe, expect, it } from "vitest";
import {
  capabilitiesSchema,
  catalogSchema,
  checkCorsPolicy,
  controlHeaders,
  corePack,
  corsAllowedHeaders,
  corsHeaders,
  createEngine,
  createOpenApiDocument,
  type Engine,
  type EngineOptions,
  type EngineResponse,
  echoSchema,
  edgePack,
  maxBodyBytes,
  preflight,
  resources,
  scalarVersion,
  statusFixtureSchema,
  statusFixtures,
  withCors,
} from "../src/index.js";
import { openApiJson } from "../src/openapi.generated.js";

const base = "https://api.example.test";
const stateless = (options: Partial<EngineOptions> = {}) =>
  createEngine({ state: "stateless", ...options });
const memory = (options: Partial<EngineOptions> = {}) =>
  createEngine({ state: "memory", ...options });

function send(
  engine: Engine,
  method: string,
  path: string,
  query = "",
  options: { headers?: [string, string][]; contentType?: string; body?: string } = {},
): EngineResponse {
  return engine.handle({
    method,
    path,
    query: new URLSearchParams(query),
    baseUrl: base,
    headers: options.headers,
    contentType: options.contentType,
    body: options.body,
  });
}

type Issue = { field: string; code: string };
const codes = (response: EngineResponse) =>
  ((response.body as { errors?: Issue[] }).errors ?? []).map(
    (issue) => `${issue.field}:${issue.code}`,
  );
const newUser = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };

describe("the catalog at /v1", () => {
  it("lists every resource with its count, query rules and absolute links", () => {
    const response = send(stateless(), "GET", "/v1");
    expect(response.status).toBe(200);
    const catalog = catalogSchema.parse(response.body);
    expect(catalog.fixture).toEqual({
      id: "core@1",
      referenceTime: corePack.manifest.referenceTime,
      checksum: corePack.manifest.checksum,
    });
    expect(catalog.resources.map((resource) => resource.name)).toEqual(
      resources.map((resource) => resource.name),
    );
    for (const entry of catalog.resources) {
      const resource = resources.find((candidate) => candidate.name === entry.name);
      expect(entry).toEqual({
        name: entry.name,
        href: `${base}/v1/${entry.name}`,
        count: corePack.data[entry.name].length,
        relations: Object.keys(resource?.relations ?? {}),
        expansions: Object.keys(resource?.expansions ?? {}),
        search: resource?.search,
        filters: resource?.filters,
        sortable: resource?.sortable,
      });
    }
    expect(catalog.links).toEqual({
      capabilities: `${base}/capabilities`,
      openapi: `${base}/openapi.json`,
      docs: `${base}/docs`,
    });
  });

  it("follows the selected pack and live counts", () => {
    const edge = catalogSchema.parse(send(stateless(), "GET", "/v1", "_mock.fixture=edge@1").body);
    expect(edge.fixture.id).toBe("edge@1");
    expect(edge.resources[0]?.count).toBe(edgePack.data.users.length);
    const engine = memory();
    send(engine, "POST", "/v1/users", "", {
      contentType: "application/json",
      body: JSON.stringify(newUser),
    });
    const live = catalogSchema.parse(send(engine, "GET", "/v1").body);
    expect(live.resources[0]?.count).toBe(corePack.data.users.length + 1);
  });

  it("takes the controls and nothing else", () => {
    expect(send(stateless(), "GET", "/v1", "_mock.status=503").status).toBe(503);
    expect(codes(send(stateless(), "GET", "/v1", "page=2"))).toEqual(["page:unknown_parameter"]);
    expect(send(stateless(), "POST", "/v1").status).toBe(405);
    expect(send(stateless(), "HEAD", "/v1").body).toBeUndefined();
  });
});

describe("/capabilities", () => {
  it("describes the server", () => {
    const response = send(memory({ maxDelayMs: 2_500 }), "GET", "/capabilities");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const described = capabilitiesSchema.parse(response.body);
    expect(described).toMatchObject({
      api: "v1",
      state: "memory",
      openapi: [
        { version: "3.1.2", href: `${base}/openapi.json` },
        { version: "3.2.1", href: `${base}/openapi-3.2.json` },
      ],
      limits: {
        defaultPageSize: 20,
        maxPageSize: 100,
        maxDelayMs: 2_500,
        maxRequestBodyBytes: maxBodyBytes,
        minImageSide: 10,
        maxImageSide: 2_000,
      },
      pagination: ["offset", "page", "cursor"],
      images: { placeholder: "/img/{size}", avatar: "/img/avatar/{name}" },
    });
    expect(described.fixtures.map((pack) => [pack.id, pack.own])).toEqual([
      ["core@1", true],
      ["edge@1", false],
    ]);
    expect(described.controls).toContainEqual({
      name: "failRate",
      query: "_mock.failRate",
      header: "X-Mock-Fail-Rate",
      values: { type: "number", minimum: 0, maximum: 1 },
    });
    expect(described.scenarios).toContain("retry-then-ok");
  });

  it("counts a memory run's own records", () => {
    const engine = memory({ fixture: "edge@1" });
    send(engine, "POST", "/v1/users", "", {
      contentType: "application/json",
      body: JSON.stringify(newUser),
    });
    const described = capabilitiesSchema.parse(send(engine, "GET", "/capabilities").body);
    expect(described.fixtures.find((pack) => pack.own)?.counts.users).toBe(
      edgePack.data.users.length + 1,
    );
  });
});

describe("diagnostic routes", () => {
  const diagnostic = ["/capabilities", "/openapi.json", "/openapi-3.2.json", "/docs"];

  it.each(diagnostic)("never simulates %s", (path) => {
    expect(codes(send(stateless(), "GET", path, "_mock.status=503"))).toEqual([
      "_mock.status:unknown_parameter",
    ]);
    const headers: [string, string][] = Object.values(controlHeaders).map((name) => [name, "nope"]);
    const response = send(stateless(), "GET", path, "", { headers });
    expect(response.status).toBe(200);
    expect(response.headers["x-mock-applied"]).toBeUndefined();
  });

  it.each(diagnostic)("answers HEAD on %s without a body and other methods with 405", (path) => {
    const head = send(stateless(), "HEAD", path);
    expect(head.status).toBe(200);
    expect(head.rawBody ?? head.body).toBeUndefined();
    expect(send(stateless(), "POST", path).status).toBe(405);
  });

  it("refuses a sequence on a diagnostic route", () => {
    expect(() => memory({ sequences: { "GET /capabilities": [503] } })).toThrow(
      'Unknown sequence route "GET /capabilities".',
    );
  });
});

describe("the served OpenAPI documents", () => {
  it("serves the committed 3.1.2 document, which matches a fresh one", () => {
    expect(openApiJson).toBe(JSON.stringify(createOpenApiDocument("3.1.2")));
    const response = send(stateless(), "GET", "/openapi.json");
    expect(response.headers).toMatchObject({
      "content-type": "application/json",
      "cache-control": "public, max-age=300",
    });
    expect(JSON.parse(response.rawBody ?? "")).toEqual(createOpenApiDocument("3.1.2"));
  });

  it("serves the 3.2.1 document", () => {
    const response = send(stateless(), "GET", "/openapi-3.2.json");
    expect(JSON.parse(response.rawBody ?? "")).toEqual(createOpenApiDocument("3.2.1"));
  });

  it("serves a docs page with one integrity-checked script and no inline code", () => {
    const response = send(stateless(), "GET", "/docs");
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    const policy = response.headers["content-security-policy"] ?? "";
    expect(policy).toContain("script-src https://cdn.jsdelivr.net");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("default-src 'none'");
    expect(policy.includes("unsafe-eval")).toBe(false);
    const page = response.rawBody ?? "";
    const scripts = page.split("<script").slice(1);
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain('id="api-reference" data-url="./openapi.json"');
    expect(scripts[0]?.slice(scripts[0].indexOf(">") + 1, scripts[0].indexOf("</script>"))).toBe(
      "",
    );
    expect(scripts[1]).toContain(
      `src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${scalarVersion}/dist/browser/standalone.js"`,
    );
    expect(scripts[1]).toContain('integrity="sha384-');
    expect(scripts[1]).toContain('crossorigin="anonymous"');
    expect(scripts[1]?.slice(scripts[1].indexOf(">") + 1, scripts[1].indexOf("</script>"))).toBe(
      "",
    );
  });
});

describe("/v1/_utils/echo", () => {
  it("echoes the query without controls, allowlisted headers and redacted credentials", () => {
    const response = send(stateless(), "GET", "/v1/_utils/echo", "a=1&a=2&b=x&_mock.delay=0", {
      headers: [
        ["Accept", "application/json"],
        ["Authorization", "Bearer secret-token"],
        ["Cookie", "session=secret"],
        ["X-Secret", "never echoed"],
        ["X-Request-Id", "r".repeat(600)],
      ],
    });
    expect(response.status).toBe(200);
    const echoed = echoSchema.parse(response.body);
    expect(echoed).toMatchObject({
      method: "GET",
      path: "/v1/_utils/echo",
      query: { a: ["1", "2"], b: ["x"] },
      redacted: ["authorization", "cookie"],
      body: null,
      bodyText: null,
      truncated: false,
      bodyBytes: 0,
    });
    expect(echoed.headers).toEqual({ accept: "application/json", "x-request-id": "r".repeat(512) });
    expect(JSON.stringify(response.body).includes("secret")).toBe(false);
  });

  it("parses a JSON body and refuses malformed JSON", () => {
    const parsed = send(stateless(), "POST", "/v1/_utils/echo", "", {
      contentType: "application/json; charset=utf-8",
      body: '{"x":[1,"é"]}',
    });
    expect(parsed.body).toMatchObject({ method: "POST", body: { x: [1, "é"] }, bodyBytes: 14 });
    const broken = send(stateless(), "PATCH", "/v1/_utils/echo", "", {
      contentType: "application/json",
      body: "{",
    });
    expect(broken.status).toBe(400);
    expect(broken.body).toMatchObject({ code: "invalid_json" });
  });

  it("returns other bodies as text, cut at 4096 characters", () => {
    const text = "😀".repeat(5_000);
    const response = send(stateless(), "PUT", "/v1/_utils/echo", "", {
      contentType: "text/plain",
      body: text,
    });
    expect(response.body).toMatchObject({
      bodyText: "😀".repeat(4_096),
      truncated: true,
      bodyBytes: 20_000,
    });
    expect(send(stateless(), "DELETE", "/v1/_utils/echo").status).toBe(200);
    expect(send(stateless(), "OPTIONS", "/v1/_utils/echo").status).toBe(405);
  });
});

describe("/v1/_utils/status/{code}", () => {
  it.each(statusFixtures)("answers %i with its protocol headers", (code) => {
    const response = send(stateless(), "GET", `/v1/_utils/status/${code}`);
    expect(response.status).toBe(code);
    expect(response.headers["cache-control"]).toBe("no-store");
    if (code === 204) {
      expect(response.body).toBeUndefined();
    } else if (code < 300) {
      expect(statusFixtureSchema.parse(response.body)).toEqual({
        status: code,
        title: ({ 200: "OK", 201: "Created", 202: "Accepted" } as Record<number, string>)[code],
      });
    } else {
      expect(response.body).toMatchObject({ status: code, code: "status_fixture" });
    }
    const expected: Record<number, Record<string, string>> = {
      201: { location: "/v1/_utils/status/201" },
      401: { "www-authenticate": 'Bearer realm="loadstate"' },
      405: { allow: "GET, HEAD" },
      429: { "retry-after": "5" },
      503: { "retry-after": "60" },
    };
    expect(response.headers).toMatchObject(expected[code] ?? {});
  });

  it("refuses a status without a fixture and a code that is not one", () => {
    const response = send(stateless(), "GET", "/v1/_utils/status/418");
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "unsupported_status",
      detail: `This status has no fixture. Use one of: ${statusFixtures.join(", ")}.`,
    });
    for (const path of ["/v1/_utils/status/abc", "/v1/_utils/status/2000", "/v1/_utils/status/"]) {
      expect(send(stateless(), "GET", path).status).toBe(404);
    }
  });
});

describe("CORS helpers", () => {
  it("answers any origin without credentials by default", () => {
    expect(corsHeaders("https://app.test", { origins: "*" })).toEqual({
      "access-control-allow-origin": "*",
      "access-control-expose-headers":
        "Link, Location, Retry-After, Allow, X-Mock-State, X-Mock-Applied",
    });
    expect(corsHeaders(undefined, { origins: "*" })["access-control-allow-origin"]).toBe("*");
  });

  it("answers only listed origins and varies by Origin", () => {
    const policy = { origins: ["https://app.test"] };
    expect(corsHeaders("https://app.test", policy)).toMatchObject({
      "access-control-allow-origin": "https://app.test",
      vary: "Origin",
    });
    expect(corsHeaders("https://evil.test", policy)).toEqual({ vary: "Origin" });
    expect(withCors({ vary: "X-Mock-Delay" }, "https://evil.test", policy)).toEqual({
      vary: "X-Mock-Delay, Origin",
    });
  });

  it("allows every control header in a preflight", () => {
    const answer = preflight("https://app.test", { origins: "*" });
    expect(answer.status).toBe(204);
    expect(answer.headers["access-control-allow-headers"]).toBe(corsAllowedHeaders.join(", "));
    for (const header of Object.values(controlHeaders)) {
      expect(answer.headers["access-control-allow-headers"]).toContain(header);
    }
    expect(answer.headers).toMatchObject({
      "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE",
      "access-control-max-age": "600",
    });
    expect(JSON.stringify(answer.headers).toLowerCase().includes("credentials")).toBe(false);
  });

  it.each([
    "https://app.test/",
    "app.test",
    "https://APP.test",
    "https://*.app.test",
    "ftp://app.test",
  ])("refuses %s as an origin", (origin) => {
    expect(() => checkCorsPolicy({ origins: [origin] })).toThrow(/bare origin/);
  });

  it("accepts bare origins with ports", () => {
    expect(checkCorsPolicy({ origins: ["http://localhost:3000"] })).toEqual({
      origins: ["http://localhost:3000"],
    });
  });
});

describe("round 1 review regressions", () => {
  it("allows only the pinned Scalar file as a script source", () => {
    const policy = send(stateless(), "GET", "/docs").headers["content-security-policy"] ?? "";
    const scripts = policy.split("; ").find((part) => part.startsWith("script-src ")) ?? "";
    expect(scripts).toBe(
      `script-src https://cdn.jsdelivr.net/npm/@scalar/api-reference@${scalarVersion}/dist/browser/standalone.js`,
    );
  });

  it("echoes query names that collide with object properties", () => {
    const response = send(
      stateless(),
      "GET",
      "/v1/_utils/echo",
      "constructor=1&__proto__=x&toString=y&a=1",
    );
    expect(response.status).toBe(200);
    const query = JSON.parse(JSON.stringify(response.body)).query;
    expect(Object.entries(query)).toEqual([
      ["constructor", ["1"]],
      ["__proto__", ["x"]],
      ["toString", ["y"]],
      ["a", ["1"]],
    ]);
  });

  it.each(["POST", "PUT", "PATCH"])("answers validation-error on an echo %s with 422", (method) => {
    const response = send(
      stateless(),
      method,
      "/v1/_utils/echo",
      "_mock.scenario=validation-error",
      {
        contentType: "application/json",
        body: "{}",
      },
    );
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: "validation_failed",
      errors: [
        {
          field: "",
          code: "simulated",
          message: "The body was rejected by the validation-error scenario.",
        },
      ],
    });
  });

  it("refuses a body fault on a route that answers 204", () => {
    const response = send(stateless(), "GET", "/v1/_utils/status/204", "_mock.body=html");
    expect(response.status).toBe(400);
    expect(codes(response)).toEqual(["_mock.body:incompatible_controls"]);
    expect(response.rawBody).toBeUndefined();
  });

  it("publishes the accepted values of every control", () => {
    const described = capabilitiesSchema.parse(
      send(stateless({ maxDelayMs: 700 }), "GET", "/capabilities").body,
    );
    const values = Object.fromEntries(
      described.controls.map((control) => [control.name, control.values]),
    );
    expect(values).toEqual({
      delay: { type: "integer", minimum: 0, maximum: 700 },
      status: { type: "integer", enum: [...statusesOf()] },
      scenario: { type: "string", enum: described.scenarios },
      body: { type: "string", enum: described.bodyFaults },
      step: { type: "integer", minimum: 1, maximum: 3 },
      failRate: { type: "number", minimum: 0, maximum: 1 },
      fixture: { type: "string", enum: ["core@1", "edge@1"] },
      seed: { type: "integer", minimum: 0, maximum: 4_294_967_295 },
    });
  });

  it("counts the bytes an adapter received, not the decoded text", () => {
    // one invalid byte decodes to U+FFFD, three bytes when re-encoded
    const response = engineWithBytes("\uFFFDa", 2);
    expect(response.body).toMatchObject({ bodyText: "\uFFFDa", bodyBytes: 2 });
  });

  it("accepts IPv6 origins and still refuses malformed ones", () => {
    expect(checkCorsPolicy({ origins: ["http://[::1]:3000", "https://[2001:db8::1]"] })).toEqual({
      origins: ["http://[::1]:3000", "https://[2001:db8::1]"],
    });
    for (const origin of [
      "http://[::1",
      "http://[zz::1]",
      "http://[::1]/",
      "http://[0:0:0:0:0:0:0:1]",
      "http://[::0001]",
      "http://[1::2::3]",
    ]) {
      expect(() => checkCorsPolicy({ origins: [origin] })).toThrow(/bare origin/);
    }
  });
});

function statusesOf() {
  return capabilitiesSchema.parse(send(stateless(), "GET", "/capabilities").body).statuses;
}

function engineWithBytes(text: string, bytes: number) {
  return stateless().handle({
    method: "POST",
    path: "/v1/_utils/echo",
    contentType: "text/plain",
    body: text,
    bodyBytes: bytes,
  });
}

describe("round 2 review regressions", () => {
  it("echoes headers given as a one-shot iterator", () => {
    const headers = new Map([
      ["x-request-id", "r-1"],
      ["authorization", "Bearer secret"],
    ]).entries();
    const response = stateless().handle({ method: "GET", path: "/v1/_utils/echo", headers });
    expect(response.body).toMatchObject({
      headers: { "x-request-id": "r-1" },
      redacted: ["authorization"],
    });
  });

  it("accepts only ports written as browsers send them", () => {
    for (const origin of ["http://app.test:8080", "https://app.test:80", "http://[::1]:3000"]) {
      expect(checkCorsPolicy({ origins: [origin] })).toEqual({ origins: [origin] });
    }
    for (const origin of [
      "https://app.test:443",
      "http://app.test:80",
      "http://[::1]:80",
      "https://[::1]:443",
      "http://app.test:080",
      "http://app.test:65536",
      "http://app.test:",
    ]) {
      expect(() => checkCorsPolicy({ origins: [origin] })).toThrow(/bare origin/);
    }
  });
});

describe("round 3 review regressions", () => {
  it("refuses a JSON body whose received bytes decode to nothing", () => {
    // a lone byte-order mark: three bytes received, no text after decoding
    const response = stateless().handle({
      method: "POST",
      path: "/v1/_utils/echo",
      contentType: "application/json",
      body: "",
      bodyBytes: 3,
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: "invalid_json" });
    const absent = stateless().handle({
      method: "POST",
      path: "/v1/_utils/echo",
      contentType: "application/json",
    });
    expect(absent.body).toMatchObject({ body: null, bodyBytes: 0 });
  });

  it("accepts hostnames with underscores or a trailing dot", () => {
    for (const origin of ["http://my_app.test:3000", "https://app.test.", "http://web_app:8080"]) {
      expect(checkCorsPolicy({ origins: [origin] })).toEqual({ origins: [origin] });
    }
    for (const origin of ["http://app..test", "http://.app.test", "http://app.test.."]) {
      expect(() => checkCorsPolicy({ origins: [origin] })).toThrow(/bare origin/);
    }
  });
});
