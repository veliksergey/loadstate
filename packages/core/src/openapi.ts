import { z } from "zod";
import { addressSchema, imageSchema } from "./contracts.js";
import {
  bodyFaults,
  type ControlName,
  controlHeaders,
  controlNames,
  defaultMaxDelayMs,
  retrySteps,
  scenarioNames,
  simulatedStatuses,
} from "./controls.js";
import { maxCursorLength } from "./cursor.js";
import type { FieldKind } from "./fields.js";
import { fixturePacks } from "./fixtures/index.js";
import {
  avatarStyles,
  defaultAvatarSize,
  maxImageSide,
  maxImageText,
  minImageSide,
  placeholderStyles,
} from "./images.js";
import {
  cursorMetaSchema,
  offsetMetaSchema,
  pageNumberMetaSchema,
  pageSchema,
} from "./paginate.js";
import {
  defaultLimit,
  kindOf,
  listParameterNames,
  maxFilterLength,
  maxLimit,
  maxSearchLength,
  maxSortFields,
  paginationModes,
  readParameterNames,
  selectableFields,
} from "./query.js";
import { type Resource, resourceNamed, resources } from "./resources.js";
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
// every engine response may carry these when a simulation control shaped it
const controlled = {
  "X-Mock-Applied": { $ref: "#/components/headers/MockApplied" },
  "Cache-Control": { $ref: "#/components/headers/NoStore" },
};

const controlSchemas: Record<ControlName, Record<string, unknown>> = {
  delay: { type: "integer", minimum: 0, maximum: defaultMaxDelayMs },
  status: { type: "integer", enum: [...simulatedStatuses] },
  scenario: { type: "string", enum: [...scenarioNames] },
  body: { type: "string", enum: [...bodyFaults] },
  step: { type: "integer", minimum: 1, maximum: retrySteps },
  failRate: { type: "number", minimum: 0, maximum: 1 },
  fixture: { type: "string", enum: Object.keys(fixturePacks) },
  seed: { type: "integer", minimum: 0, maximum: 0xffffffff },
};

const controlText: Record<ControlName, string> = {
  delay:
    "Milliseconds to wait before the response headers; at most the host limit, 10 000 by default",
  status:
    "Answer with this status before the route runs, so a write changes nothing; 204 has no body",
  scenario: "A named recipe; see the API spec for what each one does",
  body: "Replace the response body with a fault; not with HEAD, DELETE or a simulated 204",
  step: "The step of the retry-then-ok scenario: 1 and 2 answer 503, 3 the normal response",
  failRate: "Exploratory: the probability of a simulated 500",
  fixture: "The fixture pack to read; a memory engine answers 409 to any pack but its own",
  seed: "Makes failRate and flaky draws reproducible for the same request",
};

const componentKey = (name: ControlName, place: "Query" | "Header") =>
  `Mock${name.charAt(0).toUpperCase()}${name.slice(1)}${place}`;

// the control parameters live once in components and every /v1 operation refers to them
const controlParameters = controlNames.flatMap((name) => [
  { $ref: `#/components/parameters/${componentKey(name, "Query")}` },
  { $ref: `#/components/parameters/${componentKey(name, "Header")}` },
]);

function controlComponents() {
  return Object.fromEntries(
    controlNames.flatMap((name) => [
      [
        componentKey(name, "Query"),
        {
          name: `_mock.${name}`,
          in: "query",
          description: `${controlText[name]}. Wins over ${controlHeaders[name]}.`,
          schema: controlSchemas[name],
        },
      ],
      [
        componentKey(name, "Header"),
        {
          name: controlHeaders[name],
          in: "header",
          description: `${controlText[name]}. Ignored when _mock.${name} is given.`,
          schema: controlSchemas[name],
        },
      ],
    ]),
  );
}

const simulatedNoContent = {
  description: "Only with _mock.status=204 or X-Mock-Status: 204; no body",
  headers: { "X-Mock-State": mockState, ...controlled },
};
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const query = (name: string, description: string, schema: Record<string, unknown>) => ({
  name,
  in: "query",
  description,
  schema,
});

// query values arrive as text, so a nullable filter also accepts the word null
function filterSchema(kind: FieldKind, allowNull: boolean): Record<string, unknown> {
  const byType: Record<string, Record<string, unknown>> = {
    integer: { type: "integer" },
    number: { type: "number" },
    boolean: { type: "boolean" },
    enum: { type: "string", enum: kind.values },
    date: { type: "string", format: "date" },
    datetime: {
      anyOf: [
        { type: "string", format: "date" },
        { type: "string", format: "date-time" },
      ],
    },
  };
  const schema = byType[kind.type] ?? { type: "string", minLength: 1, maxLength: maxFilterLength };
  return allowNull && kind.nullable
    ? { anyOf: [schema, { type: "string", enum: ["null"] }] }
    : schema;
}

const operatorText: Record<string, string> = {
  ne: "differs from",
  gt: "is greater than",
  gte: "is at least",
  lt: "is less than",
  lte: "is at most",
};

function parameterFor(resource: Resource, name: string) {
  const list = (items: readonly string[]) => items.join(", ");
  const expansions = Object.keys(resource.expansions);
  switch (name) {
    case "pagination":
      return query(name, "Pagination mode; inferred from page, perPage or cursor when omitted", {
        type: "string",
        enum: [...paginationModes],
      });
    case "limit":
      return query(name, "Page size in offset and cursor modes", {
        type: "integer",
        minimum: 1,
        maximum: maxLimit,
        default: defaultLimit,
      });
    case "offset":
      return query(name, "Rows to skip in offset mode", {
        type: "integer",
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
        default: 0,
      });
    case "page":
      return query(name, "Page number in page mode", {
        type: "integer",
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
        default: 1,
      });
    case "perPage":
      return query(name, "Page size in page mode", {
        type: "integer",
        minimum: 1,
        maximum: maxLimit,
        default: defaultLimit,
      });
    case "cursor":
      return query(
        name,
        "nextCursor or prevCursor from an earlier cursor page; valid only with the same search, filters and sort",
        { type: "string", minLength: 1, maxLength: maxCursorLength },
      );
    case "withTotal":
      return query(name, "Adds meta.total in cursor mode; counting reads the whole list", {
        type: "boolean",
        default: false,
      });
    case "q":
      return query(
        name,
        `Every term must appear in: ${list(resource.search)}; case and accents are ignored`,
        { type: "string", minLength: 1, maxLength: maxSearchLength },
      );
    case "sort":
      return query(
        name,
        `Comma list of up to ${maxSortFields} of: ${list(resource.sortable)}; a leading - sorts descending, id breaks ties, nulls come last`,
        { type: "string", minLength: 1 },
      );
    case "fields":
      return query(
        name,
        `Comma list of the fields to return: ${list(selectableFields(resource))}`,
        {
          type: "string",
          minLength: 1,
        },
      );
    case "expand":
      return query(name, `Comma list of related records to add: ${list(expansions)}`, {
        type: "string",
        minLength: 1,
      });
    default: {
      const [field = name, operator = "eq"] = name.split("_");
      const kind = kindOf(resource, field);
      const what =
        operator === "eq"
          ? kind.type === "tags"
            ? `Only records whose ${field} include this value`
            : `Only records whose ${field} equals this value`
          : kind.type === "tags"
            ? `Only records whose ${field} do not include this value`
            : `Only records whose ${field} ${operatorText[operator]} this value`;
      return query(
        name,
        kind.type === "datetime" ? `${what}; a bare date means its first instant in UTC` : what,
        filterSchema(kind, operator === "eq" || operator === "ne"),
      );
    }
  }
}

const listParameters = (resource: Resource) =>
  listParameterNames(resource).map((name) => parameterFor(resource, name));
const readParameters = (resource: Resource) =>
  readParameterNames(resource).map((name) => parameterFor(resource, name));

const linkHeader = {
  Link: {
    description: "RFC 8288 links: first, prev, next and, outside cursor mode, last",
    required: true,
    schema: { type: "string" },
  },
};

const view = (resource: Resource) => ({
  anyOf: [ref(resource.singular), ref(`${resource.singular}Projection`)],
});

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "integer", minimum: 1 },
};

function jsonResponse(
  description: string,
  schema: string | Record<string, unknown>,
  headers: Record<string, unknown> = {},
) {
  return {
    description,
    headers: { "X-Mock-State": mockState, ...controlled, ...headers },
    content: { "application/json": { schema: typeof schema === "string" ? ref(schema) : schema } },
  };
}

function problemResponse(description: string, fromEngine = true) {
  return {
    description,
    ...(fromEngine ? { headers: { "X-Mock-State": mockState, ...controlled } } : {}),
    content: { "application/problem+json": { schema: ref("Problem") } },
  };
}

const unexpectedBase = problemResponse(
  "Any other status: 405 with Allow for an unsupported method, 409 fixture_locked, a status simulated by _mock.status or a scenario, or a failure from a configured sequence",
);
const unexpected = {
  ...unexpectedBase,
  headers: {
    ...unexpectedBase.headers,
    "Retry-After": { $ref: "#/components/headers/RetryAfter" },
  },
};
const badQuery = problemResponse(
  "An invalid, repeated or unknown query parameter, or an invalid simulation control",
);

// a fresh registry turns nested contracts into $refs without shared global state
function componentSchemas() {
  const registry = z.registry<{ id: string }>();
  registry.add(imageSchema, { id: "Image" });
  registry.add(addressSchema, { id: "Address" });
  registry.add(offsetMetaSchema, { id: "OffsetMeta" });
  registry.add(pageNumberMetaSchema, { id: "PageNumberMeta" });
  registry.add(cursorMetaSchema, { id: "CursorMeta" });
  for (const resource of resources) registry.add(resource.schema, { id: resource.singular });
  for (const resource of resources) {
    const projection = projectionSchema(resource);
    registry.add(projection, { id: `${resource.singular}Projection` });
    registry.add(pageSchema(z.union([resource.schema, projection])), {
      id: `${resource.singular}Page`,
    });
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
        summary: `List ${resource.name} with search, filters, sort and offset, page or cursor pagination`,
        parameters: listParameters(resource),
        responses: {
          "200": jsonResponse(
            `One page of ${resource.name}`,
            `${resource.singular}Page`,
            linkHeader,
          ),
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
        parameters: [idParameter, ...readParameters(resource)],
        responses: {
          "200": jsonResponse(`The ${noun}, projected or expanded when asked`, view(resource)),
          "400": problemResponse(
            "Any query parameter but fields or expand, or an invalid simulation control",
          ),
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
          "204": {
            description: "Deleted; no body",
            headers: { "X-Mock-State": mockState, ...controlled },
          },
          "400": problemResponse("Any query parameter, or an invalid simulation control"),
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
          summary: `List the ${name} of one ${noun} with the same query rules as ${child.name}`,
          parameters: [idParameter, ...listParameters(child)],
          responses: {
            "200": jsonResponse(`One page of ${name}`, `${child.singular}Page`, linkHeader),
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

// fields= keeps a subset and expand= adds related records, so every field is optional here
function projectionSchema(resource: Resource) {
  const expansions = Object.fromEntries(
    Object.entries(resource.expansions).map(([name, reference]) => [
      name,
      resourceNamed(reference.resource).schema.nullable().optional(),
    ]),
  );
  return resource.schema.partial().extend(expansions);
}

function body(schema: string) {
  return { required: true, content: { "application/json": { schema: ref(schema) } } };
}

// statuses every create, replace and update can answer besides success and 404
function writeResponses(singular: string, unique: readonly string[]) {
  return {
    "400": problemResponse(
      "An empty or malformed JSON body, any query parameter, or an invalid simulation control",
    ),
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

const color = (name: string, what: string) => ({
  name,
  in: "query",
  description: `${what} color as 3 or 6 hex digits without "#"`,
  schema: { type: "string", pattern: "^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" },
});

const svgResponse = {
  description: "An SVG image; text is escaped and nothing in it loads or runs",
  headers: {
    "X-Mock-State": mockState,
    "X-Mock-Applied": { $ref: "#/components/headers/MockApplied" },
    "Cache-Control": {
      description: "Cached for a week, or no-store when a simulation control shaped the response",
      required: true,
      schema: { type: "string", enum: ["public, max-age=604800", "no-store"] },
    },
    "X-Content-Type-Options": { required: true, schema: { type: "string", const: "nosniff" } },
    Vary: {
      description:
        "Every X-Mock-* control header, so a cache never reuses an image for a request that asks for another",
      required: true,
      schema: { type: "string" },
    },
    "Content-Security-Policy": {
      required: true,
      schema: { type: "string", const: "default-src 'none'; style-src 'unsafe-inline'" },
    },
  },
  content: { "image/svg+xml": { schema: { type: "string" } } },
};

function imagePaths(): Record<string, Record<string, Operation>> {
  const side = `${minImageSide} to ${maxImageSide} pixels`;
  return {
    "/img/{size}": {
      get: {
        operationId: "getPlaceholderImage",
        summary: "A placeholder SVG of the given size",
        parameters: [
          {
            name: "size",
            in: "path",
            required: true,
            description: `WIDTHxHEIGHT or one side for a square, each ${side}`,
            schema: { type: "string", pattern: "^(0|[1-9][0-9]*)(x(0|[1-9][0-9]*))?$" },
          },
          query("text", "Text to show instead of the size; one line, escaped", {
            type: "string",
            minLength: 1,
            maxLength: maxImageText,
          }),
          color("bg", "Background"),
          color("fg", "Text and pattern"),
          query(
            "seed",
            "Picks the background color and the pattern; the same seed draws the same image",
            {
              type: "string",
              pattern: "^[A-Za-z0-9._-]{1,64}$",
            },
          ),
          query("style", "Background style", {
            type: "string",
            enum: [...placeholderStyles],
            default: "plain",
          }),
        ],
        responses: {
          "200": svgResponse,
          "400": problemResponse(
            `A side outside ${side}, an invalid, repeated or unknown query parameter, or an invalid simulation control`,
          ),
          "404": problemResponse("A size that is not WIDTHxHEIGHT or SIDE in digits"),
          default: unexpected,
        },
      },
    },
    "/img/avatar/{name}": {
      get: {
        operationId: "getAvatarImage",
        summary: "A square avatar SVG with the name's initials or an identicon",
        parameters: [
          {
            name: "name",
            in: "path",
            required: true,
            description:
              "1 to 64 letters, digits, dots, underscores or hyphens, starting with a letter or digit",
            schema: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$" },
          },
          query("size", `Side in pixels, ${side}`, {
            type: "integer",
            minimum: minImageSide,
            maximum: maxImageSide,
            default: defaultAvatarSize,
          }),
          query("style", "Initials or a mirrored identicon", {
            type: "string",
            enum: [...avatarStyles],
            default: "initials",
          }),
          color("bg", "Background"),
          color("fg", "Initials or identicon"),
        ],
        responses: {
          "200": svgResponse,
          "400": problemResponse(
            "A size outside the range, an invalid, repeated or unknown query parameter, or an invalid simulation control",
          ),
          "404": problemResponse("A name with other characters"),
          default: unexpected,
        },
      },
    },
  };
}

// every /v1 operation takes the controls and can answer a simulated 204
function withControls(paths: Record<string, Record<string, Operation>>) {
  for (const operations of Object.values(paths)) {
    for (const operation of Object.values(operations)) {
      operation.parameters = [...((operation.parameters as unknown[]) ?? []), ...controlParameters];
      const responses = operation.responses as Record<string, unknown>;
      if (!("204" in responses)) responses["204"] = simulatedNoContent;
    }
  }
  return paths;
}

export function createOpenApiDocument(version: OpenApiVersion): OpenApiDocument {
  const paths = withControls({ ...resourcePaths(), ...imagePaths() });

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
      parameters: controlComponents(),
      headers: {
        MockState: {
          description: "Whether the engine stores writes (memory) or only answers them (stateless)",
          required: true,
          schema: { type: "string", enum: ["memory", "stateless"] },
        },
        MockApplied: {
          description:
            "The simulation controls that shaped this response, resolved: for example scenario=maintenance, status=503",
          schema: { type: "string" },
        },
        NoStore: {
          description: "no-store whenever a simulation control shaped the response",
          schema: { type: "string", const: "no-store" },
        },
        RetryAfter: {
          description: "Seconds to wait before retrying, with a simulated 429 or 503",
          schema: { type: "integer", minimum: 0 },
        },
      },
    },
  };
}
