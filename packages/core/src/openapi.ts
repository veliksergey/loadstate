import { z } from "zod";
import { addressSchema, imageSchema } from "./contracts.js";
import { pageSchema } from "./paginate.js";
import { defaultLimit, maxLimit } from "./query.js";
import { resourceNamed, resources } from "./resources.js";
import { maxBodyBytes, problemSchema } from "./response.js";
import { writeRules } from "./writes.js";

export type OpenApiVersion = "3.1.2" | "3.2.1";

export interface OpenApiDocument {
  openapi: OpenApiVersion;
  [key: string]: unknown;
}

type Operation = Record<string, unknown>;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const mockState = { $ref: "#/components/headers/MockState" };
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const pageParameters = [
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: maxLimit, default: defaultLimit },
  },
  {
    name: "offset",
    in: "query",
    schema: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 0 },
  },
];

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "integer", minimum: 1 },
};

function jsonResponse(description: string, schema: string, headers: Record<string, unknown> = {}) {
  return {
    description,
    headers: { "X-Mock-State": mockState, ...headers },
    content: { "application/json": { schema: ref(schema) } },
  };
}

function problemResponse(description: string, fromEngine = true) {
  return {
    description,
    ...(fromEngine ? { headers: { "X-Mock-State": mockState } } : {}),
    content: { "application/problem+json": { schema: ref("Problem") } },
  };
}

const unexpected = problemResponse(
  "Any other status: 405 with Allow for an unsupported method, or a failure from a configured sequence",
);
const badQuery = problemResponse("An invalid, repeated or unknown query parameter");

// a fresh registry turns nested contracts into $refs without shared global state
function componentSchemas() {
  const registry = z.registry<{ id: string }>();
  registry.add(imageSchema, { id: "Image" });
  registry.add(addressSchema, { id: "Address" });
  for (const resource of resources) {
    registry.add(resource.schema, { id: resource.singular });
    registry.add(pageSchema(resource.schema), { id: `${resource.singular}Page` });
    const input = writeRules[resource.name].input;
    registry.add(input, { id: `${resource.singular}Create` });
    registry.add(input.partial(), { id: `${resource.singular}Patch` });
  }
  registry.add(problemSchema, { id: "Problem" });

  const { schemas } = z.toJSONSchema(registry, { uri: (id) => `#/components/schemas/${id}` });
  // the document's dialect applies; component schemas carry no $schema or $id
  return Object.fromEntries(
    Object.entries(schemas).map(([id, { $schema: _dialect, $id: _id, ...schema }]) => [id, schema]),
  );
}

function resourcePaths(): Record<string, Record<string, Operation>> {
  const paths: Record<string, Record<string, Operation>> = {};
  for (const resource of resources) {
    const noun = resource.singular.toLowerCase();
    const missing = problemResponse(`No ${noun} has this id, or the id is not a positive integer`);

    const writes = writeResponses(resource.singular, writeRules[resource.name].unique);

    paths[`/v1/${resource.name}`] = {
      get: {
        operationId: `list${capitalize(resource.name)}`,
        summary: `List ${resource.name}, offset pagination`,
        parameters: pageParameters,
        responses: {
          "200": jsonResponse(`One page of ${resource.name}`, `${resource.singular}Page`),
          "400": badQuery,
          default: unexpected,
        },
      },
      post: {
        operationId: `create${resource.singular}`,
        summary: `Create a ${noun}; only a memory engine stores it`,
        requestBody: body(`${resource.singular}Create`),
        responses: {
          "201": jsonResponse(`The ${noun} as created, with server defaults`, resource.singular, {
            Location: {
              description: `Path of the created ${noun}`,
              required: true,
              schema: { type: "string" },
            },
          }),
          ...writes,
        },
      },
    };
    paths[`/v1/${resource.name}/{id}`] = {
      get: {
        operationId: `get${resource.singular}`,
        summary: `Read one ${noun}`,
        parameters: [idParameter],
        responses: {
          "200": jsonResponse(`The ${noun}`, resource.singular),
          "400": problemResponse("Any query parameter"),
          "404": missing,
          default: unexpected,
        },
      },
      put: {
        operationId: `replace${resource.singular}`,
        summary: `Replace the writable fields of one ${noun}; omitted optional fields take their defaults`,
        parameters: [idParameter],
        requestBody: body(`${resource.singular}Create`),
        responses: {
          "200": jsonResponse(`The ${noun} as replaced`, resource.singular),
          "404": missing,
          ...writes,
        },
      },
      patch: {
        operationId: `update${resource.singular}`,
        summary: `Change some writable fields of one ${noun}`,
        parameters: [idParameter],
        requestBody: body(`${resource.singular}Patch`),
        responses: {
          "200": jsonResponse(`The ${noun} as updated`, resource.singular),
          "404": missing,
          ...writes,
        },
      },
      delete: {
        operationId: `delete${resource.singular}`,
        summary: `Delete one ${noun}; refused while other records refer to it`,
        parameters: [idParameter],
        responses: {
          "204": { description: "Deleted; no body", headers: { "X-Mock-State": mockState } },
          "400": problemResponse("Any query parameter"),
          "404": missing,
          ...(Object.keys(resource.relations).length > 0
            ? {
                "409": problemResponse(
                  `The ${noun} still has ${Object.keys(resource.relations).join(" or ")}`,
                ),
              }
            : {}),
          default: unexpected,
        },
      },
    };
    for (const [name, relation] of Object.entries(resource.relations)) {
      const child = resourceNamed(relation.resource);
      paths[`/v1/${resource.name}/{id}/${name}`] = {
        get: {
          operationId: `list${resource.singular}${capitalize(name)}`,
          summary: `List the ${name} of one ${noun}, offset pagination`,
          parameters: [idParameter, ...pageParameters],
          responses: {
            "200": jsonResponse(`One page of ${name}`, `${child.singular}Page`),
            "400": badQuery,
            "404": missing,
            default: unexpected,
          },
        },
      };
    }
  }
  return paths;
}

function body(schema: string) {
  return { required: true, content: { "application/json": { schema: ref(schema) } } };
}

// statuses every create, replace and update can answer besides success and 404
function writeResponses(singular: string, unique: readonly string[]) {
  return {
    "400": problemResponse("An empty or malformed JSON body, or any query parameter"),
    ...(unique.length > 0
      ? {
          "409": problemResponse(
            `A ${unique.join(" or ")} already used by another ${singular.toLowerCase()}`,
          ),
        }
      : {}),
    "413": problemResponse(
      `A request body over ${maxBodyBytes} bytes, rejected by the HTTP server`,
      false,
    ),
    "415": problemResponse("A body that is not application/json"),
    "422": problemResponse(
      "A body with missing, invalid, unknown or read-only fields, a reference to a missing record, or a structural rule broken",
    ),
    default: unexpected,
  };
}

export function createOpenApiDocument(version: OpenApiVersion): OpenApiDocument {
  const paths = resourcePaths();

  return {
    openapi: version,
    info: {
      title: "Loadstate API",
      version: "0.0.0",
      summary: "Fake REST API for front-end loading, error and data states.",
      license: { name: "MIT", identifier: "MIT" },
    },
    paths,
    components: {
      schemas: componentSchemas(),
      headers: {
        MockState: {
          description: "Whether the engine stores writes (memory) or only answers them (stateless)",
          required: true,
          schema: { type: "string", enum: ["memory", "stateless"] },
        },
      },
    },
  };
}
