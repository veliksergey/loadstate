import { z } from "zod";

export type FieldType =
  | "integer"
  | "number"
  | "string"
  | "enum"
  | "boolean"
  | "date"
  | "datetime"
  | "tags"
  | "object"
  | "array";

export interface FieldKind {
  type: FieldType;
  nullable: boolean;
  // enum values in declared order; empty for other types
  values: readonly string[];
}

// the query rules read a field's type from its record schema, so they cannot drift
export function fieldKind(schema: z.ZodType): FieldKind {
  let node = schema;
  let nullable = false;
  while (node instanceof z.ZodNullable || node instanceof z.ZodOptional) {
    if (node instanceof z.ZodNullable) nullable = true;
    node = node.unwrap() as z.ZodType;
  }
  const kind = (type: FieldType, values: readonly string[] = []): FieldKind => ({
    type,
    nullable,
    values,
  });

  if (node instanceof z.ZodNumber) return kind(node.isInt ? "integer" : "number");
  if (node instanceof z.ZodBoolean) return kind("boolean");
  if (node instanceof z.ZodEnum) return kind("enum", node.options.map(String));
  if (node instanceof z.ZodArray)
    return kind(node.element instanceof z.ZodString ? "tags" : "array");
  if (node instanceof z.ZodObject) return kind("object");
  // string formats such as z.iso.datetime() are not ZodString instances
  const format = (node as { format?: unknown }).format;
  if (format === "datetime") return kind("datetime");
  if (format === "date") return kind("date");
  if (node instanceof z.ZodString || typeof format === "string") return kind("string");
  throw new Error("This field schema has no query type.");
}

export const isScalar = (kind: FieldKind) =>
  kind.type !== "object" && kind.type !== "array" && kind.type !== "tags";
export const isRanged = (kind: FieldKind) =>
  kind.type === "integer" ||
  kind.type === "number" ||
  kind.type === "date" ||
  kind.type === "datetime";
