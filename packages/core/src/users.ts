import { z } from "zod";
import type { FieldIssue } from "./response.js";

export const userCreateSchema = z.strictObject({
  name: z.string().min(1).max(100),
  username: z.string().min(1).max(50),
  email: z.email().max(254),
});

export const userSchema = z.strictObject({
  id: z.int().positive(),
  ...userCreateSchema.shape,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UserCreate = z.infer<typeof userCreateSchema>;
export type User = z.infer<typeof userSchema>;

// fictional people
const people = [
  ["Mira Okafor", "mira.okafor"],
  ["Tomas Lindqvist", "tomas.lindqvist"],
  ["Priya Raman", "priya.raman"],
  ["Jonah Whitfield", "jonah.whitfield"],
  ["Lucía Ferreira", "lucia.ferreira"],
  ["Kenji Arakawa", "kenji.arakawa"],
  ["Amara Nwosu", "amara.nwosu"],
  ["Elias Brandt", "elias.brandt"],
  ["Sofia Marchetti", "sofia.marchetti"],
  ["Dmitri Volkov", "dmitri.volkov"],
  ["Hana Sato", "hana.sato"],
  ["Owen Gallagher", "owen.gallagher"],
  ["Leila Haddad", "leila.haddad"],
  ["Mateo Ruiz", "mateo.ruiz"],
  ["Ingrid Solberg", "ingrid.solberg"],
  ["Kwame Mensah", "kwame.mensah"],
  ["Yuki Tanabe", "yuki.tanabe"],
  ["Noor Rahimi", "noor.rahimi"],
  ["Felix Hartmann", "felix.hartmann"],
  ["Zoë Laurent", "zoe.laurent"],
  ["Arjun Mehta", "arjun.mehta"],
  ["Clara Novak", "clara.novak"],
  ["Tariq Bello", "tariq.bello"],
  ["Astrid Kowalczyk", "astrid.kowalczyk"],
  ["Rafael Moreno", "rafael.moreno"],
] as const;

// fixed epoch keeps timestamps reproducible
const epoch = Date.UTC(2026, 0, 5, 9);
const hour = 3_600_000;

export const users: readonly User[] = Object.freeze(
  people.map(([name, username], i) => {
    const created = epoch + i * 37 * hour;
    return Object.freeze({
      id: i + 1,
      name,
      username,
      email: `${username}@example.com`,
      createdAt: new Date(created).toISOString(),
      updatedAt: new Date(created + (i % 4) * 6 * hour).toISOString(),
    });
  }),
);

const serverOwned = new Set(["id", "createdAt", "updatedAt"]);

export type CreateResult = { ok: true; value: UserCreate } | { ok: false; issues: FieldIssue[] };

export function parseUserCreate(input: unknown): CreateResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      issues: [
        { field: "", code: "invalid_type", message: "The request body must be a JSON object." },
      ],
    };
  }
  const result = userCreateSchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, issues: result.error.issues.flatMap((issue) => describe(issue, input)) };
}

// own wording, so API messages do not change with a Zod upgrade
function describe(issue: z.core.$ZodIssue, input: object): FieldIssue[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) =>
      serverOwned.has(key)
        ? { field: key, code: "read_only", message: `"${key}" is set by the server.` }
        : { field: key, code: "unknown_field", message: `Unknown field "${key}".` },
    );
  }

  const field = issue.path.map(String).join(".");
  switch (issue.code) {
    case "invalid_type":
      return Object.hasOwn(input, field)
        ? [{ field, code: "invalid_type", message: `"${field}" must be a ${issue.expected}.` }]
        : [{ field, code: "required", message: `"${field}" is required.` }];
    case "too_small":
      return [
        {
          field,
          code: "too_short",
          message:
            Number(issue.minimum) === 1
              ? `"${field}" must not be empty.`
              : `"${field}" must be at least ${issue.minimum} characters.`,
        },
      ];
    case "too_big":
      return [
        {
          field,
          code: "too_long",
          message: `"${field}" must be at most ${issue.maximum} characters.`,
        },
      ];
    case "invalid_format": {
      const format = issue.format === "email" ? "email address" : issue.format;
      return [{ field, code: "invalid_format", message: `"${field}" must be a valid ${format}.` }];
    }
    default:
      return [{ field, code: "invalid", message: `"${field}" is not valid.` }];
  }
}
