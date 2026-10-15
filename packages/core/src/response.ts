import { z } from "zod";

// adapters reject larger request bodies with 413 before the engine runs
export const maxBodyBytes = 256 * 1024;

export interface EngineResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
}

export const fieldIssueSchema = z.strictObject({
  field: z.string(),
  code: z.string().min(1),
  message: z.string().min(1),
});

export type FieldIssue = z.infer<typeof fieldIssueSchema>;

export const problemSchema = z.strictObject({
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.int().min(400).max(599),
  detail: z.string().min(1),
  code: z.string().min(1),
  errors: z.array(fieldIssueSchema).optional(),
});

export type Problem = z.infer<typeof problemSchema>;

// RFC 9110 reason phrases, used as RFC 9457 titles for "about:blank"
const titles = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
} as const;

export type ProblemStatus = keyof typeof titles;

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): EngineResponse {
  return { status, headers: { "content-type": "application/json", ...headers }, body };
}

// "about:blank" until problem type URIs have a real domain
export function problem(
  status: ProblemStatus,
  code: string,
  detail: string,
  errors?: readonly FieldIssue[],
): EngineResponse {
  return {
    status,
    headers: { "content-type": "application/problem+json" },
    body: {
      type: "about:blank",
      title: titles[status],
      status,
      detail,
      code,
      ...(errors ? { errors } : {}),
    },
  };
}

export interface SerializedResponse {
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

export function serialize({ status, headers, body }: EngineResponse): SerializedResponse {
  return { status, headers, body: body === undefined ? null : JSON.stringify(body) };
}
