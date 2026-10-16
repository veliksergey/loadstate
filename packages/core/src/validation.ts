import { z } from "zod";
import type { FieldIssue } from "./response.js";

export type InputResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; issues: FieldIssue[] };

// regex fields get a message that says what the pattern allows
const formatHints: Record<string, string> = {
  username:
    'may only contain lowercase letters, digits, ".", "_" and "-", starting with a letter or digit',
  currency: "must be three uppercase letters, such as USD",
  "address.country": "must be a two-letter uppercase country code, such as US",
};

const typeNames: Record<string, string> = {
  int: "an integer",
  number: "a number",
  string: "a string",
  boolean: "true or false",
  object: "an object",
  array: "an array",
};

export function parseInput(
  schema: z.ZodObject,
  input: unknown,
  readOnly: ReadonlySet<string>,
): InputResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        { field: "", code: "invalid_type", message: "The request body must be a JSON object." },
      ],
    };
  }
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data as Record<string, unknown> };
  return {
    ok: false,
    issues: result.error.issues.flatMap((issue) => describe(issue, schema, input, readOnly)),
  };
}

// own wording, so API messages do not change with a Zod upgrade
function describe(
  issue: z.core.$ZodIssue,
  schema: z.ZodObject,
  input: object,
  readOnly: ReadonlySet<string>,
) {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key): FieldIssue => {
      const field = [...issue.path.map(String), key].join(".");
      return issue.path.length === 0 && readOnly.has(key)
        ? { field, code: "read_only", message: `"${field}" is set by the server.` }
        : { field, code: "unknown_field", message: `Unknown field "${field}".` };
    });
  }

  const field = issue.path.map(String).join(".");
  const say = (code: string, text: string): FieldIssue[] => [
    { field, code, message: `"${field}" ${text}.` },
  ];

  switch (issue.code) {
    case "invalid_type": {
      if (!isPresent(input, issue.path)) return say("required", "is required");
      // Zod says "number" when a non-number reaches an integer field
      const expected =
        issue.expected === "number" && isInteger(fieldSchema(schema, issue.path))
          ? "int"
          : issue.expected;
      return say("invalid_type", `must be ${typeNames[expected] ?? expected}`);
    }
    case "too_small":
      return say(
        issue.origin === "string" ? "too_short" : "too_small",
        lowerBound(issue.origin, Number(issue.minimum), issue.inclusive),
      );
    case "too_big":
      return say(
        issue.origin === "string" ? "too_long" : "too_big",
        upperBound(issue.origin, Number(issue.maximum), issue.inclusive),
      );
    case "invalid_format":
      if (issue.format === "email") return say("invalid_format", "must be a valid email address");
      if (issue.format === "date")
        return say("invalid_format", "must be a date in YYYY-MM-DD form");
      return say("invalid_format", formatHints[field] ?? "has an invalid format");
    case "invalid_value":
      return say("invalid_value", `must be one of: ${issue.values.map(String).join(", ")}`);
    default:
      return say("invalid", "is not valid");
  }
}

function lowerBound(origin: string, minimum: number, inclusive = true): string {
  if (origin === "string") {
    return minimum <= 1 ? "must not be empty" : `must be at least ${minimum} characters`;
  }
  if (origin === "array") return `must have at least ${minimum} items`;
  return inclusive ? `must be at least ${minimum}` : `must be greater than ${minimum}`;
}

function upperBound(origin: string, maximum: number, inclusive = true): string {
  if (origin === "string") return `must be at most ${maximum} characters`;
  if (origin === "array") return `must have at most ${maximum} items`;
  return inclusive ? `must be at most ${maximum}` : `must be less than ${maximum}`;
}

function isPresent(input: object, path: readonly PropertyKey[]): boolean {
  let node: unknown = input;
  for (const key of path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, key)) return false;
    node = (node as Record<PropertyKey, unknown>)[key];
  }
  return true;
}

// the schema an issue's path points at, without optional or nullable wrappers
function fieldSchema(schema: z.ZodType, path: readonly PropertyKey[]): z.ZodType | undefined {
  let node: z.ZodType | undefined = unwrap(schema);
  for (const key of path) {
    if (node instanceof z.ZodObject) node = node.shape[String(key)];
    else if (node instanceof z.ZodArray) node = node.element as z.ZodType;
    else return undefined;
    if (node === undefined) return undefined;
    node = unwrap(node);
  }
  return node;
}

function unwrap(node: z.ZodType): z.ZodType {
  let current = node;
  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}

function isInteger(node: z.ZodType | undefined): boolean {
  return node instanceof z.ZodNumber && node.isInt;
}
