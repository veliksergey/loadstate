import { z } from "zod";
import { pageSchema } from "./paginate.js";
import { defaultLimit, maxLimit } from "./query.js";
import { maxBodyBytes, problemSchema } from "./response.js";
import { userCreateSchema, userSchema } from "./users.js";

export type OpenApiVersion = "3.1.2" | "3.2.1";

export interface OpenApiDocument {
  openapi: OpenApiVersion;
  [key: string]: unknown;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const mockState = { $ref: "#/components/headers/MockState" };

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

// a fresh registry turns nested contracts into $refs without shared global state
function componentSchemas() {
  const registry = z.registry<{ id: string }>();
  registry.add(userSchema, { id: "User" });
  registry.add(userCreateSchema, { id: "UserCreate" });
  registry.add(pageSchema(userSchema), { id: "UserPage" });
  registry.add(problemSchema, { id: "Problem" });

  const { schemas } = z.toJSONSchema(registry, { uri: (id) => `#/components/schemas/${id}` });
  // the document's dialect applies; component schemas carry no $schema or $id
  return Object.fromEntries(
    Object.entries(schemas).map(([id, { $schema: _dialect, $id: _id, ...schema }]) => [id, schema]),
  );
}

export function createOpenApiDocument(version: OpenApiVersion): OpenApiDocument {
  return {
    openapi: version,
    info: {
      title: "Loadstate API",
      version: "0.0.0",
      summary: "Fake REST API for front-end loading, error and data states.",
      license: { name: "MIT", identifier: "MIT" },
    },
    paths: {
      "/v1/users": {
        get: {
          operationId: "listUsers",
          summary: "List users, offset pagination",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", minimum: 1, maximum: maxLimit, default: defaultLimit },
            },
            {
              name: "offset",
              in: "query",
              schema: {
                type: "integer",
                minimum: 0,
                maximum: Number.MAX_SAFE_INTEGER,
                default: 0,
              },
            },
          ],
          responses: {
            "200": jsonResponse("One page of users", "UserPage"),
            "400": problemResponse("An invalid, repeated or unknown query parameter"),
            default: unexpected,
          },
        },
        post: {
          operationId: "createUser",
          summary: "Create a user; only a memory engine stores it",
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref("UserCreate") } },
          },
          responses: {
            "201": jsonResponse("The user as created", "User", {
              Location: {
                description: "Path of the created user",
                required: true,
                schema: { type: "string" },
              },
            }),
            "400": problemResponse("An empty or malformed JSON body, or any query parameter"),
            "413": problemResponse(
              `A request body over ${maxBodyBytes} bytes, rejected by the HTTP server`,
              false,
            ),
            "415": problemResponse("A body that is not application/json"),
            "422": problemResponse("A body with missing, invalid or read-only fields"),
            default: unexpected,
          },
        },
      },
      "/v1/users/{id}": {
        get: {
          operationId: "getUser",
          summary: "Read one user",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer", minimum: 1 } },
          ],
          responses: {
            "200": jsonResponse("The user", "User"),
            "400": problemResponse("Any query parameter"),
            "404": problemResponse("No user has this id, or the id is not a positive integer"),
            default: unexpected,
          },
        },
      },
    },
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
