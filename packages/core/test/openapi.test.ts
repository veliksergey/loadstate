import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import "@hyperjump/json-schema/formats";
import {
  setShouldValidateFormat,
  validate as validateJson,
} from "@hyperjump/json-schema/openapi-3-1";
import "@hyperjump/json-schema/openapi-3-2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  createEngine,
  createOpenApiDocument,
  defaultLimit,
  type EngineRequest,
  maxLimit,
  type OpenApiVersion,
  pageSchema,
  problemSchema,
  userSchema,
  users,
} from "../src/index.js";

// one typed view of the overloaded validator: (uri, value, format?) => { valid }
const validate = validateJson as unknown as (
  uri: string,
  value: unknown,
  outputFormat?: "FLAG" | "BASIC",
) => Promise<{ valid: boolean }>;

interface Doc {
  info?: unknown;
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Record<string, unknown>> };
}
interface Operation {
  parameters?: { name: string; schema: object }[];
  responses: Record<string, unknown>;
}
const load = (version: OpenApiVersion) => createOpenApiDocument(version) as unknown as Doc;

const versions = ["3.1.2", "3.2.1"] as const satisfies readonly OpenApiVersion[];
const dir = mkdtempSync(join(tmpdir(), "loadstate-openapi-"));
const urls = new Map<OpenApiVersion, string>();

// JSON Pointer escaping for a key inside a document URI fragment
const pointer = (...keys: string[]) =>
  keys.map((key) => encodeURIComponent(key.replaceAll("~", "~0").replaceAll("/", "~1"))).join("/");

async function isValid(uri: string, value: unknown) {
  return (await validate(uri, value)).valid;
}

beforeAll(() => {
  setShouldValidateFormat(true);
  for (const version of versions) {
    // the validator reads files named *.openapi.json as OpenAPI documents
    const file = join(dir, `loadstate-${version}.openapi.json`);
    writeFileSync(file, JSON.stringify(createOpenApiDocument(version)));
    urls.set(version, pathToFileURL(file).href);
  }
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("generated OpenAPI document", () => {
  it.each(versions)("is a valid OpenAPI %s document", async (version) => {
    const document = createOpenApiDocument(version);
    const minor = version.slice(0, 3);
    const result = await validate(
      `https://spec.openapis.org/oas/${minor}/schema-base`,
      document,
      "BASIC",
    );
    expect(result).toEqual({ valid: true });
    expect(document.openapi).toBe(version);
  });

  it.each(versions)("rejects a broken OpenAPI %s document", async (version) => {
    const minor = version.slice(0, 3);
    const metaSchema = `https://spec.openapis.org/oas/${minor}/schema-base`;

    const { info: _info, ...withoutInfo } = load(version);
    expect((await validate(metaSchema, withoutInfo)).valid).toBe(false);

    const badSchema = load(version);
    badSchema.components.schemas.User = { ...badSchema.components.schemas.User, type: 7 };
    expect((await validate(metaSchema, badSchema)).valid).toBe(false);
  });

  it("differs between versions only in the version field", () => {
    const { openapi: _a, ...older } = createOpenApiDocument("3.1.2");
    const { openapi: _b, ...newer } = createOpenApiDocument("3.2.1");
    expect(newer).toEqual(older);
  });

  it("generates component schemas from the Zod contracts", () => {
    const { components } = load("3.1.2");
    expect(Object.keys(components.schemas).sort()).toEqual([
      "Problem",
      "User",
      "UserCreate",
      "UserPage",
    ]);
    expect(components.schemas.UserPage).toMatchObject({
      properties: { data: { type: "array", items: { $ref: "#/components/schemas/User" } } },
    });
    expect(components.schemas.User).toMatchObject({
      additionalProperties: false,
      required: ["id", "name", "username", "email", "createdAt", "updatedAt"],
    });
    for (const schema of Object.values(components.schemas)) {
      expect(schema).not.toHaveProperty("$schema");
      expect(schema).not.toHaveProperty("$id");
    }
  });

  it("documents the query bounds the parser enforces", () => {
    const parameters = load("3.1.2").paths["/v1/users"]?.get?.parameters ?? [];
    expect(parameters.find((p) => p.name === "limit")?.schema).toEqual({
      type: "integer",
      minimum: 1,
      maximum: maxLimit,
      default: defaultLimit,
    });
  });
});

describe("engine responses against the document", () => {
  const user = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };
  const post = (body: string, contentType = "application/json"): EngineRequest => ({
    method: "POST",
    path: "/v1/users",
    contentType,
    body,
  });
  const get = (path: string, query = ""): EngineRequest => ({
    method: "GET",
    path,
    query: new URLSearchParams(query),
  });

  const cases: [string, string, string, EngineRequest, number][] = [
    ["list", "/v1/users", "get", get("/v1/users", "limit=3"), 200],
    ["invalid list query", "/v1/users", "get", get("/v1/users", "limit=0&page=2"), 400],
    ["read", "/v1/users/{id}", "get", get("/v1/users/7"), 200],
    ["unknown id", "/v1/users/{id}", "get", get("/v1/users/26"), 404],
    ["create", "/v1/users", "post", post(JSON.stringify(user)), 201],
    ["malformed JSON", "/v1/users", "post", post("{"), 400],
    ["wrong media type", "/v1/users", "post", post("name=x", "text/plain"), 415],
    ["invalid fields", "/v1/users", "post", post(JSON.stringify({ id: 1, name: "" })), 422],
    ["unsupported method", "/v1/users/{id}", "get", { method: "DELETE", path: "/v1/users/1" }, 405],
  ];

  it.each(cases)("documents the %s response", async (_name, path, method, request, status) => {
    const engine = createEngine({ state: "memory" });
    const response = engine.handle(request);
    expect(response.status).toBe(status);

    const responses = load("3.1.2").paths[path]?.[method]?.responses ?? {};
    const code = String(status) in responses ? String(status) : "default";
    const documented = responses[code] as {
      headers?: Record<string, unknown>;
      content: Record<string, unknown>;
    };
    expect(documented).toBeDefined();

    const mediaType = response.headers["content-type"] ?? "";
    expect(Object.keys(documented.content)).toContain(mediaType);
    for (const header of Object.keys(documented.headers ?? {})) {
      expect(response.headers[header.toLowerCase()]).toBeDefined();
    }

    const schema = `${urls.get("3.1.2")}#/${pointer("paths", path, method, "responses", code, "content", mediaType, "schema")}`;
    expect(await isValid(schema, response.body)).toBe(true);
  });

  it("documents a failure from a configured sequence under default", async () => {
    const engine = createEngine({ state: "memory", sequences: { "GET /v1/users/:id": [503] } });
    const response = engine.handle(get("/v1/users/1"));
    expect(response.status).toBe(503);
    const schema = `${urls.get("3.1.2")}#/${pointer("paths", "/v1/users/{id}", "get", "responses", "default", "content", "application/problem+json", "schema")}`;
    expect(await isValid(schema, response.body)).toBe(true);
  });

  it("parses every engine problem with problemSchema", () => {
    const engine = createEngine({ state: "memory" });
    for (const [, , , request] of cases) {
      const response = engine.handle(request);
      if (response.status >= 400) expect(problemSchema.safeParse(response.body).success).toBe(true);
    }
  });
});

describe("Zod and the generated JSON Schema agree", () => {
  const component = (name: string) =>
    `${urls.get("3.2.1")}#/${pointer("components", "schemas", name)}`;
  const first = users[0] as z.infer<typeof userSchema>;

  const samples: [string, string, z.ZodType, unknown][] = [
    ...users.map((u): [string, string, z.ZodType, unknown] => [
      `fixture ${u.id}`,
      "User",
      userSchema,
      u,
    ]),
    ["created user", "User", userSchema, { ...first, id: 26 }],
    [
      "list page",
      "UserPage",
      pageSchema(userSchema),
      { data: users.slice(0, 2), meta: { limit: 2, offset: 0, total: 25, hasMore: true } },
    ],
    [
      "problem with errors",
      "Problem",
      problemSchema,
      {
        type: "about:blank",
        title: "Unprocessable Content",
        status: 422,
        detail: "x",
        code: "validation_failed",
        errors: [{ field: "", code: "invalid_type", message: "m" }],
      },
    ],
    ["extra field", "User", userSchema, { ...first, role: "admin" }],
    ["missing email", "User", userSchema, { ...first, email: undefined }],
    ["string id", "User", userSchema, { ...first, id: "1" }],
    ["zero id", "User", userSchema, { ...first, id: 0 }],
    ["bad email", "User", userSchema, { ...first, email: "nope" }],
    ["bad timestamp", "User", userSchema, { ...first, createdAt: "yesterday" }],
    ["offset timestamp", "User", userSchema, { ...first, createdAt: "2026-01-05T09:00:00+02:00" }],
    ["empty name", "User", userSchema, { ...first, name: "" }],
    ["long name", "User", userSchema, { ...first, name: "x".repeat(101) }],
    ["page without meta", "UserPage", pageSchema(userSchema), { data: [] }],
    [
      "problem with a 200 status",
      "Problem",
      problemSchema,
      { type: "about:blank", title: "OK", status: 200, detail: "x", code: "c" },
    ],
    [
      "issue without a message",
      "Problem",
      problemSchema,
      {
        type: "t",
        title: "t",
        status: 400,
        detail: "d",
        code: "c",
        errors: [{ field: "a", code: "b" }],
      },
    ],
  ];

  it.each(samples)("gives one verdict for %s", async (_name, name, schema, value) => {
    // JSON has no undefined; drop it the way serialization would
    const json = JSON.parse(JSON.stringify(value));
    expect(await isValid(component(name), json)).toBe(schema.safeParse(json).success);
  });

  it("covers both accepted and rejected samples", () => {
    const verdicts = samples.map(([, , schema, value]) => schema.safeParse(value).success);
    expect(verdicts.filter(Boolean).length).toBeGreaterThan(20);
    expect(verdicts.filter((ok) => !ok).length).toBe(12);
  });
});
