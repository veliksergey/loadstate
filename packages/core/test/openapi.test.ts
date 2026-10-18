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
  categorySchema,
  commentSchema,
  controlHeaders,
  controlNames,
  corePack,
  createEngine,
  createOpenApiDocument,
  cursorMetaSchema,
  defaultLimit,
  type EngineRequest,
  edgePack,
  listParameterNames,
  maxLimit,
  type OpenApiVersion,
  offsetMetaSchema,
  pageNumberMetaSchema,
  pageSchema,
  postSchema,
  problemSchema,
  productSchema,
  type ResourceName,
  readParameterNames,
  resourceNamed,
  resources,
  todoSchema,
  userSchema,
  writeRules,
} from "../src/index.js";
import { createBodies, fullBodies, nextIdOf } from "./samples.js";

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
  operationId: string;
  parameters?: { name: string; schema: object }[];
  requestBody?: { required: boolean; content: Record<string, { schema: unknown }> };
  responses: Record<string, unknown>;
}
const load = (version: OpenApiVersion) => createOpenApiDocument(version) as unknown as Doc;

// a header object, following a $ref into components.headers
function resolveHeader(spec: unknown): { required?: boolean } {
  const ref = (spec as { $ref?: string }).$ref;
  if (ref === undefined) return spec as { required?: boolean };
  const document = createOpenApiDocument("3.1.2") as unknown as {
    components: { headers: Record<string, { required?: boolean }> };
  };
  return document.components.headers[ref.replace("#/components/headers/", "")] ?? {};
}

type Row = { id: number } & Record<string, unknown>;
const rows = (name: ResourceName) => corePack.data[name] as readonly Row[];

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
    const expected = [
      "Address",
      "Image",
      "Problem",
      "OffsetMeta",
      "PageNumberMeta",
      "CursorMeta",
      ...resources.flatMap((resource) => [
        resource.singular,
        `${resource.singular}Page`,
        `${resource.singular}Projection`,
        `${resource.singular}Create`,
        `${resource.singular}Patch`,
      ]),
    ];
    expect(Object.keys(components.schemas).sort()).toEqual(expected.sort());
    for (const resource of resources) {
      expect(components.schemas[`${resource.singular}Page`]).toMatchObject({
        properties: {
          data: {
            type: "array",
            items: {
              anyOf: [
                { $ref: `#/components/schemas/${resource.singular}` },
                { $ref: `#/components/schemas/${resource.singular}Projection` },
              ],
            },
          },
          meta: {
            anyOf: [
              { $ref: "#/components/schemas/OffsetMeta" },
              { $ref: "#/components/schemas/PageNumberMeta" },
              { $ref: "#/components/schemas/CursorMeta" },
            ],
          },
        },
      });
      const projection = components.schemas[`${resource.singular}Projection`];
      expect(projection).toMatchObject({ additionalProperties: false });
      expect(projection?.required ?? []).toEqual([]);
      expect(Object.keys((projection?.properties as object) ?? {})).toEqual([
        ...Object.keys(resource.schema.shape),
        ...Object.keys(resource.expansions),
      ]);
      expect(components.schemas[resource.singular]).toMatchObject({
        additionalProperties: false,
        required: Object.keys(resource.schema.shape),
      });
      const input = writeRules[resource.name].input;
      expect(components.schemas[`${resource.singular}Create`]).toMatchObject({
        additionalProperties: false,
        properties: Object.fromEntries(Object.keys(input.shape).map((key) => [key, {}])),
        required: Object.keys(input.shape).filter((key) => !input.shape[key]?.isOptional()),
      });
      expect(components.schemas[`${resource.singular}Patch`]).toMatchObject({
        additionalProperties: false,
      });
      expect(components.schemas[`${resource.singular}Patch`]?.required ?? []).toEqual([]);
    }
    expect(components.schemas.User).toMatchObject({
      properties: { avatar: { $ref: "#/components/schemas/Image" } },
    });
    for (const schema of Object.values(components.schemas)) {
      expect(schema).not.toHaveProperty("$schema");
      expect(schema).not.toHaveProperty("$id");
    }
  });

  it("documents exactly the engine's operations", () => {
    const documented = Object.entries(load("3.1.2").paths).flatMap(([path, operations]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
    );
    const expected = [
      ...resources.flatMap((resource) => [
        `GET /v1/${resource.name}`,
        `POST /v1/${resource.name}`,
        `GET /v1/${resource.name}/{id}`,
        `PUT /v1/${resource.name}/{id}`,
        `PATCH /v1/${resource.name}/{id}`,
        `DELETE /v1/${resource.name}/{id}`,
        ...Object.keys(resource.relations).map(
          (relation) => `GET /v1/${resource.name}/{id}/${relation}`,
        ),
      ]),
      "GET /img/{size}",
      "GET /img/avatar/{name}",
    ];
    expect(documented.sort()).toEqual(expected.sort());
  });

  it.each(resources)("documents the $name write bodies and statuses", (resource) => {
    const { name, singular, relations } = resource;
    const paths = load("3.1.2").paths;
    const collection = paths[`/v1/${name}`] ?? {};
    const item = paths[`/v1/${name}/{id}`] ?? {};
    const body = (operation: Operation | undefined) =>
      operation?.requestBody?.content["application/json"]?.schema;
    expect(body(collection.post)).toEqual({ $ref: `#/components/schemas/${singular}Create` });
    expect(body(item.put)).toEqual({ $ref: `#/components/schemas/${singular}Create` });
    expect(body(item.patch)).toEqual({ $ref: `#/components/schemas/${singular}Patch` });
    for (const operation of [collection.post, item.put, item.patch]) {
      expect(operation?.requestBody?.required).toBe(true);
    }

    const statuses = (operation: Operation | undefined) =>
      Object.keys(operation?.responses ?? {}).sort();
    const conflict = writeRules[name].unique.length > 0 ? ["409"] : [];
    const writes = ["400", ...conflict, "413", "415", "422", "default"];
    // 204 is the simulated no-content answer every operation documents
    expect(statuses(collection.post)).toEqual(["201", "204", ...writes].sort());
    expect(statuses(item.put)).toEqual(["200", "204", "404", ...writes].sort());
    expect(statuses(item.patch)).toEqual(["200", "204", "404", ...writes].sort());
    const blocked = Object.keys(relations).length > 0 ? ["409"] : [];
    expect(statuses(item.delete)).toEqual(["204", "400", "404", ...blocked, "default"].sort());
    expect(item.delete?.responses["204"]).toEqual({
      description: "Deleted; no body",
      headers: {
        "X-Mock-State": expect.any(Object),
        "X-Mock-Applied": expect.any(Object),
        "Cache-Control": expect.any(Object),
      },
    });
  });

  it.each(resources)("documents exactly the query parameters $name accepts", (resource) => {
    const paths = load("3.1.2").paths;
    // the controls are shared $refs, checked on their own below
    const names = (operation: Operation | undefined) =>
      (operation?.parameters ?? [])
        .filter((p) => "name" in p && p.name !== "id")
        .map((p) => p.name);
    expect(names(paths[`/v1/${resource.name}`]?.get)).toEqual(listParameterNames(resource));
    expect(names(paths[`/v1/${resource.name}/{id}`]?.get)).toEqual(readParameterNames(resource));
    for (const [relation, { resource: child }] of Object.entries(resource.relations)) {
      expect(names(paths[`/v1/${resource.name}/{id}/${relation}`]?.get)).toEqual(
        listParameterNames(resourceNamed(child)),
      );
    }
    for (const write of ["put", "patch", "delete"]) {
      expect(names(paths[`/v1/${resource.name}/{id}`]?.[write])).toEqual([]);
    }
  });

  it("documents filter types from the record schema", () => {
    const parameters = load("3.1.2").paths["/v1/comments"]?.get?.parameters ?? [];
    const schema = (name: string) => parameters.find((p) => p.name === name)?.schema;
    expect(schema("parentId")).toEqual({
      anyOf: [{ type: "integer" }, { type: "string", enum: ["null"] }],
    });
    expect(schema("parentId_gt")).toEqual({ type: "integer" });
    expect(schema("createdAt_gte")).toEqual({
      anyOf: [
        { type: "string", format: "date" },
        { type: "string", format: "date-time" },
      ],
    });
    const products = load("3.1.2").paths["/v1/products"]?.get?.parameters ?? [];
    expect(products.find((p) => p.name === "status")?.schema).toEqual({
      type: "string",
      enum: ["active", "draft", "discontinued"],
    });
  });

  it("documents every control once and refers to it from every operation", () => {
    const document = load("3.1.2") as unknown as {
      paths: Record<string, Record<string, Operation>>;
      components: { parameters: Record<string, { name: string; in: string }> };
    };
    const shared = Object.values(document.components.parameters);
    expect(shared.filter((p) => p.in === "query").map((p) => p.name)).toEqual(
      controlNames.map((name) => `_mock.${name}`),
    );
    expect(shared.filter((p) => p.in === "header").map((p) => p.name)).toEqual(
      controlNames.map((name) => controlHeaders[name]),
    );
    const refs = Object.keys(document.components.parameters).map(
      (key) => `#/components/parameters/${key}`,
    );
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const used = (operation.parameters ?? []).flatMap((p) =>
          "$ref" in p ? [(p as { $ref: string }).$ref] : [],
        );
        expect([path, method, used.sort()]).toEqual([path, method, [...refs].sort()]);
        expect(operation.responses["204"], `${method} ${path}`).toBeDefined();
      }
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
  const base = "https://api.example.test";
  const user = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };
  const post = (body: string, contentType = "application/json"): EngineRequest => ({
    method: "POST",
    path: "/v1/users",
    contentType,
    body,
    baseUrl: base,
  });
  const get = (path: string, query = ""): EngineRequest => ({
    method: "GET",
    path,
    query: new URLSearchParams(query),
    baseUrl: base,
  });

  const send = (
    method: string,
    path: string,
    json: unknown,
    contentType = "application/json",
  ): EngineRequest => ({
    method,
    path,
    contentType,
    body: typeof json === "string" ? json : JSON.stringify(json),
    baseUrl: base,
  });
  const remove = (path: string): EngineRequest => ({ method: "DELETE", path, baseUrl: base });
  const [firstUser] = corePack.data.users;

  // name, documented path, documented method, request, status, requests to run first
  type Case = [string, string, string, EngineRequest, number, EngineRequest[]?];
  const cases: Case[] = [
    ...resources.flatMap((resource): Case[] => {
      const { name } = resource;
      const created = `/v1/${name}/${nextIdOf(name)}`;
      const create = send("POST", `/v1/${name}`, createBodies[name]);
      return [
        [`create one of ${name}`, `/v1/${name}`, "post", create, 201],
        [
          `replace one of ${name}`,
          `/v1/${name}/{id}`,
          "put",
          send("PUT", created, fullBodies[name]),
          200,
          [create],
        ],
        [
          `update one of ${name}`,
          `/v1/${name}/{id}`,
          "patch",
          send("PATCH", created, {}),
          200,
          [create],
        ],
        [`delete one of ${name}`, `/v1/${name}/{id}`, "delete", remove(created), 204, [create]],
        [
          `update a missing one of ${name}`,
          `/v1/${name}/{id}`,
          "patch",
          send("PATCH", created, {}),
          404,
        ],
        [`invalid ${name} fields`, `/v1/${name}`, "post", send("POST", `/v1/${name}`, {}), 422],
      ];
    }),
    ...resources.flatMap((resource): Case[] => [
      [`list ${resource.name}`, `/v1/${resource.name}`, "get", get(`/v1/${resource.name}`), 200],
      [
        `read one of ${resource.name}`,
        `/v1/${resource.name}/{id}`,
        "get",
        get(`/v1/${resource.name}/1`),
        200,
      ],
      [
        `missing one of ${resource.name}`,
        `/v1/${resource.name}/{id}`,
        "get",
        get(`/v1/${resource.name}/${rows(resource.name).length + 1}`),
        404,
      ],
      ...Object.keys(resource.relations).map(
        (relation): [string, string, string, EngineRequest, number] => [
          `${resource.name} ${relation}`,
          `/v1/${resource.name}/{id}/${relation}`,
          "get",
          get(`/v1/${resource.name}/1/${relation}`, "limit=100"),
          200,
        ],
      ),
    ]),
    ["invalid list query", "/v1/users", "get", get("/v1/users", "limit=0&page=2"), 400],
    ["page mode", "/v1/products", "get", get("/v1/products", "page=2&perPage=5"), 200],
    [
      "cursor mode with a total",
      "/v1/posts",
      "get",
      get("/v1/posts", "pagination=cursor&limit=5&withTotal=true&sort=-publishedAt"),
      200,
    ],
    [
      "search, filters and sort",
      "/v1/products",
      "get",
      get("/v1/products", "q=a&status=active&priceMinor_gte=1000&sort=-rating,title"),
      200,
    ],
    ["a projection", "/v1/users", "get", get("/v1/users", "fields=id,name&limit=3"), 200],
    [
      "expansions",
      "/v1/comments",
      "get",
      get("/v1/comments", "expand=author,post,parent&limit=5"),
      200,
    ],
    [
      "a projected and expanded read",
      "/v1/posts/{id}",
      "get",
      get("/v1/posts/1", "fields=id,title&expand=author"),
      200,
    ],
    [
      "a projected nested list",
      "/v1/users/{id}/todos",
      "get",
      get("/v1/users/1/todos", "fields=id,completed&completed=false&page=1"),
      200,
    ],
    ["a malformed cursor", "/v1/posts", "get", get("/v1/posts", "cursor=nope"), 400],
    ["mixed pagination modes", "/v1/posts", "get", get("/v1/posts", "page=2&offset=1"), 400],
    ["list parameter on a read", "/v1/posts/{id}", "get", get("/v1/posts/1", "limit=2"), 400],
    [
      "nested list of a missing parent",
      "/v1/users/{id}/posts",
      "get",
      get("/v1/users/999/posts"),
      404,
    ],
    ["create", "/v1/users", "post", post(JSON.stringify(user)), 201],
    ["malformed JSON", "/v1/users", "post", post("{"), 400],
    ["malformed JSON on a replace", "/v1/todos/{id}", "put", send("PUT", "/v1/todos/1", "{"), 400],
    ["wrong media type", "/v1/users", "post", post("name=x", "text/plain"), 415],
    [
      "wrong media type on an update",
      "/v1/posts/{id}",
      "patch",
      send("PATCH", "/v1/posts/1", "x", "text/plain"),
      415,
    ],
    ["invalid fields", "/v1/users", "post", post(JSON.stringify({ id: 1, name: "" })), 422],
    [
      "missing reference",
      "/v1/todos",
      "post",
      send("POST", "/v1/todos", { ...createBodies.todos, userId: nextIdOf("users") }),
      422,
    ],
    [
      "taken username",
      "/v1/users",
      "post",
      send("POST", "/v1/users", { ...user, username: firstUser?.username }),
      409,
    ],
    ["delete with dependents", "/v1/users/{id}", "delete", remove("/v1/users/1"), 409],
    [
      "query on a delete",
      "/v1/todos/{id}",
      "delete",
      { ...remove("/v1/todos/1"), query: new URLSearchParams("force=1") },
      400,
    ],
    ["unsupported method", "/v1/users", "get", { method: "PUT", path: "/v1/users" }, 405],
    ["a simulated 503", "/v1/users", "get", get("/v1/users", "_mock.status=503"), 503],
    ["a simulated 204", "/v1/users/{id}", "get", get("/v1/users/1", "_mock.status=204"), 204],
    [
      "a simulated 204 on a write",
      "/v1/posts",
      "post",
      { ...send("POST", "/v1/posts", {}), query: new URLSearchParams("_mock.status=204") },
      204,
    ],
    [
      "a scenario failure",
      "/v1/products",
      "get",
      get("/v1/products", "_mock.scenario=ratelimited"),
      429,
    ],
    ["an empty scenario", "/v1/products", "get", get("/v1/products", "_mock.scenario=empty"), 200],
    [
      "a simulated validation error",
      "/v1/users",
      "post",
      {
        ...send("POST", "/v1/users", {}),
        query: new URLSearchParams("_mock.scenario=validation-error"),
      },
      422,
    ],
    ["a delayed read", "/v1/posts/{id}", "get", get("/v1/posts/1", "_mock.delay=5"), 200],
    [
      "another pack on a memory run",
      "/v1/users",
      "get",
      get("/v1/users", "_mock.fixture=edge@1"),
      409,
    ],
    [
      "a control in a header",
      "/v1/users/{id}/posts",
      "get",
      { ...get("/v1/users/1/posts"), headers: [["X-Mock-Scenario", "maintenance"]] },
      503,
    ],
    ["an invalid control", "/v1/todos", "get", get("/v1/todos", "_mock.status=418"), 400],
    ["a placeholder image", "/img/{size}", "get", get("/img/600x400", "seed=a&style=pattern"), 200],
    ["a square image", "/img/{size}", "get", get("/img/64"), 200],
    ["an image side out of range", "/img/{size}", "get", get("/img/5x400"), 400],
    ["a zero side", "/img/{size}", "get", get("/img/0"), 400],
    ["a size that is not one", "/img/{size}", "get", get("/img/abc"), 404],
    ["a broken image", "/img/{size}", "get", get("/img/600x400", "_mock.status=404"), 404],
    ["a delayed image", "/img/{size}", "get", get("/img/600x400", "_mock.delay=5"), 200],
    ["an avatar", "/img/avatar/{name}", "get", get("/img/avatar/jane-doe", "size=40"), 200],
    [
      "an identicon",
      "/img/avatar/{name}",
      "get",
      get("/img/avatar/jane-doe", "style=identicon"),
      200,
    ],
    [
      "an invalid avatar size",
      "/img/avatar/{name}",
      "get",
      get("/img/avatar/jane-doe", "size=1"),
      400,
    ],
    ["an avatar name that is not one", "/img/avatar/{name}", "get", get("/img/avatar/-x"), 404],
  ];

  it.each(cases)(
    "documents the %s response",
    async (_name, path, method, request, status, setup) => {
      const engine = createEngine({ state: "memory" });
      for (const step of setup ?? []) expect(engine.handle(step).status).toBeLessThan(300);
      const response = engine.handle(request);
      expect(response.status).toBe(status);

      const responses = load("3.1.2").paths[path]?.[method]?.responses ?? {};
      const code = String(status) in responses ? String(status) : "default";
      const documented = responses[code] as {
        headers?: Record<string, unknown>;
        content?: Record<string, unknown>;
      };
      expect(documented).toBeDefined();
      for (const [header, spec] of Object.entries(documented.headers ?? {})) {
        // optional headers such as X-Mock-Applied appear only when a control is used
        const resolved = resolveHeader(spec);
        if (!resolved.required) continue;
        expect(response.headers[header.toLowerCase()]).toBeDefined();
      }
      if (documented.content === undefined) {
        expect(response.body).toBeUndefined();
        expect(response.headers["content-type"]).toBeUndefined();
        return;
      }

      const mediaType = response.headers["content-type"] ?? "";
      expect(Object.keys(documented.content)).toContain(mediaType);

      const schema = `${urls.get("3.1.2")}#/${pointer("paths", path, method, "responses", code, "content", mediaType, "schema")}`;
      // an image's body is its SVG text, which the document describes as a string
      expect(await isValid(schema, response.rawBody ?? response.body)).toBe(true);
    },
  );

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

// the same projection the generator registers: every field optional, expansions added
function projectionOf(name: ResourceName): z.ZodType {
  const resource = resourceNamed(name);
  return resource.schema
    .partial()
    .extend(
      Object.fromEntries(
        Object.entries(resource.expansions).map(([key, reference]) => [
          key,
          resourceNamed(reference.resource).schema.nullable().optional(),
        ]),
      ),
    );
}

describe("Zod and the generated JSON Schema give the expected verdict", () => {
  const component = (name: string) =>
    `${urls.get("3.2.1")}#/${pointer("components", "schemas", name)}`;
  const { users, posts, comments, categories, products, todos } = corePack.data;
  const [user, post, comment, category, product, todo] = [
    users[0],
    posts[0],
    comments[0],
    categories[0],
    products[0],
    todos[0],
  ];

  type Sample = [string, string, z.ZodType, unknown, boolean];
  const fixtureSamples: Sample[] = [corePack, edgePack].flatMap((pack) =>
    resources.flatMap((resource) =>
      (pack.data[resource.name] as readonly Row[]).map(
        (row): Sample => [
          `${pack.manifest.id} ${resource.name} ${row.id}`,
          resource.singular,
          resource.schema,
          row,
          true,
        ],
      ),
    ),
  );

  const inputSamples: Sample[] = resources.flatMap((resource): Sample[] => {
    const input = writeRules[resource.name].input;
    const patch = input.partial();
    const { singular, name } = resource;
    return [
      [`a minimal ${singular} create`, `${singular}Create`, input, createBodies[name], true],
      [`a full ${singular} create`, `${singular}Create`, input, fullBodies[name], true],
      [`an empty ${singular} create`, `${singular}Create`, input, {}, false],
      [
        `a ${singular} create with an id`,
        `${singular}Create`,
        input,
        { ...createBodies[name], id: 1 },
        false,
      ],
      [`an empty ${singular} patch`, `${singular}Patch`, patch, {}, true],
      [`a full ${singular} patch`, `${singular}Patch`, patch, fullBodies[name], true],
      [`a ${singular} patch with an unknown field`, `${singular}Patch`, patch, { x: 1 }, false],
    ];
  });

  const samples: Sample[] = [
    ...fixtureSamples,
    ...inputSamples,
    [
      "a post patch with a null title",
      "PostPatch",
      writeRules.posts.input.partial(),
      { title: null },
      false,
    ],
    [
      "a comment patch with a null parent",
      "CommentPatch",
      writeRules.comments.input.partial(),
      { parentId: null },
      true,
    ],
    [
      "a user create with a lowercase country",
      "UserCreate",
      writeRules.users.input,
      {
        ...createBodies.users,
        address: { street: "s", city: "c", postalCode: "p", country: "us" },
      },
      false,
    ],
    [
      "a list page",
      "UserPage",
      pageSchema(userSchema),
      {
        data: users.slice(0, 2),
        meta: { limit: 2, offset: 0, total: users.length, hasMore: true },
      },
      true,
    ],
    [
      "a numbered page",
      "PageNumberMeta",
      pageNumberMetaSchema,
      { page: 2, perPage: 5, total: 30, totalPages: 6, hasMore: true },
      true,
    ],
    [
      "a cursor page without a total",
      "CursorMeta",
      cursorMetaSchema,
      { limit: 5, nextCursor: "abc", prevCursor: null, hasMore: true },
      true,
    ],
    [
      "a cursor page with an empty cursor",
      "CursorMeta",
      cursorMetaSchema,
      { limit: 5, nextCursor: "", prevCursor: null, hasMore: true },
      false,
    ],
    [
      "meta mixing offset and page fields",
      "OffsetMeta",
      offsetMetaSchema,
      { limit: 2, offset: 0, total: 1, hasMore: false, page: 1 },
      false,
    ],
    [
      "a projected user",
      "UserProjection",
      projectionOf("users"),
      { id: 1, email: "a@example.com" },
      true,
    ],
    ["an empty projection", "UserProjection", projectionOf("users"), {}, true],
    [
      "a projection with an unknown field",
      "UserProjection",
      projectionOf("users"),
      { id: 1, nickname: "x" },
      false,
    ],
    [
      "an expanded comment",
      "CommentProjection",
      projectionOf("comments"),
      { ...comment, author: user, post, parent: null },
      true,
    ],
    [
      "an expansion that is not a record",
      "PostProjection",
      projectionOf("posts"),
      { id: 1, author: { id: 1 } },
      false,
    ],
    [
      "a problem with errors",
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
      true,
    ],
    ["a user with an extra field", "User", userSchema, { ...user, nickname: "x" }, false],
    ["a user without email", "User", userSchema, { ...user, email: undefined }, false],
    ["a user with a string id", "User", userSchema, { ...user, id: "1" }, false],
    ["a user with id 0", "User", userSchema, { ...user, id: 0 }, false],
    ["a user with a bad email", "User", userSchema, { ...user, email: "nope" }, false],
    ["a user with a bad timestamp", "User", userSchema, { ...user, createdAt: "yesterday" }, false],
    [
      "a user with an offset timestamp",
      "User",
      userSchema,
      { ...user, createdAt: "2026-01-05T09:00:00+02:00" },
      false,
    ],
    ["a user with an empty name", "User", userSchema, { ...user, name: "" }, false],
    ["a user with a long name", "User", userSchema, { ...user, name: "x".repeat(101) }, false],
    ["a user with a spaced username", "User", userSchema, { ...user, username: "Ines D" }, false],
    ["a user with an unknown role", "User", userSchema, { ...user, role: "owner" }, false],
    [
      "a user with a lowercase country",
      "User",
      userSchema,
      { ...user, address: { street: "s", city: "c", postalCode: "p", country: "us" } },
      false,
    ],
    [
      "a user with a named avatar color",
      "User",
      userSchema,
      { ...user, avatar: { url: "/img/a", width: 1, height: 1, alt: "", color: "red" } },
      false,
    ],
    ["a post with a spaced slug", "Post", postSchema, { ...post, slug: "Has Spaces" }, false],
    ["a post with an unknown status", "Post", postSchema, { ...post, status: "deleted" }, false],
    ["a post read in 0 minutes", "Post", postSchema, { ...post, readingTimeMinutes: 0 }, false],
    ["a comment with negative likes", "Comment", commentSchema, { ...comment, likes: -1 }, false],
    ["a comment with parent 0", "Comment", commentSchema, { ...comment, parentId: 0 }, false],
    [
      "a category with an underscore slug",
      "Category",
      categorySchema,
      { ...category, slug: "a_b" },
      false,
    ],
    [
      "a product with a fractional price",
      "Product",
      productSchema,
      { ...product, priceMinor: 1.5 },
      false,
    ],
    [
      "a product in lowercase currency",
      "Product",
      productSchema,
      { ...product, currency: "usd" },
      false,
    ],
    ["a product rated 5.5", "Product", productSchema, { ...product, rating: 5.5 }, false],
    ["a product without images", "Product", productSchema, { ...product, images: [] }, false],
    ["a todo due on month 13", "Todo", todoSchema, { ...todo, dueDate: "2026-13-01" }, false],
    ["a todo with urgent priority", "Todo", todoSchema, { ...todo, priority: "urgent" }, false],
    ["a page without meta", "UserPage", pageSchema(userSchema), { data: [] }, false],
    [
      "a problem with status 200",
      "Problem",
      problemSchema,
      { type: "about:blank", title: "OK", status: 200, detail: "x", code: "c" },
      false,
    ],
    [
      "an issue without a message",
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
      false,
    ],
  ];

  it.each(samples)("judges %s", async (_name, name, schema, value, expected) => {
    // JSON has no undefined; drop it the way serialization would
    const json = JSON.parse(JSON.stringify(value));
    expect(schema.safeParse(json).success).toBe(expected);
    expect(await isValid(component(name), json)).toBe(expected);
  });
});
