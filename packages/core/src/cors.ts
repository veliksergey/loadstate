import { controlHeaders } from "./controls.js";
import type { EngineResponse } from "./response.js";

// "*" answers any origin without credentials; a list answers only those exact origins
export interface CorsPolicy {
  origins: "*" | readonly string[];
}

export const defaultCorsPolicy: CorsPolicy = { origins: "*" };

export const corsExposedHeaders = [
  "Link",
  "Location",
  "Retry-After",
  "Allow",
  "X-Mock-State",
  "X-Mock-Applied",
] as const;

export const corsAllowedHeaders = [
  "Accept",
  "Accept-Language",
  "Authorization",
  "Content-Type",
  "If-Match",
  "If-None-Match",
  "X-Request-Id",
  ...Object.values(controlHeaders),
] as const;

export const corsMethods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
export const corsMaxAgeSeconds = 600;

// an Origin header: scheme, host as browsers keep it or bracketed IPv6, optional port
const originParts =
  /^(https?):[/][/]([a-z0-9_-]+(?:[.][a-z0-9_-]+)*[.]?|\[[0-9a-f:]+\])(?::([0-9]+))?$/;
const defaultPorts: Record<string, string> = { http: "80", https: "443" };

function isOrigin(origin: string): boolean {
  const [, scheme = "", host = "", port] = originParts.exec(origin) ?? [];
  if (host === "") return false;
  // browsers omit the scheme's default port and write others without leading zeros
  const portOk =
    port === undefined ||
    (String(Number(port)) === port && Number(port) <= 65_535 && port !== defaultPorts[scheme]);
  const address = host.startsWith("[") ? host.slice(1, -1) : undefined;
  return portOk && (address === undefined || serializedIpv6(address) === address);
}

// IPv6 as browsers write it: lowercase, no leading zeros, first longest zero run as "::"
function serializedIpv6(text: string): string | undefined {
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const [head = [], tail = []] = halves.map((half) => (half === "" ? [] : half.split(":")));
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return undefined;
  const pieces = groups.map((group) => Number.parseInt(group, 16).toString(16));
  let start = -1;
  let length = 1;
  for (let index = 0; index < pieces.length; index++) {
    let end = index;
    while (pieces[end] === "0") end++;
    if (end - index > length) {
      start = index;
      length = end - index;
    }
  }
  if (start < 0) return pieces.join(":");
  return `${pieces.slice(0, start).join(":")}::${pieces.slice(start + length).join(":")}`;
}

// fails at startup on an entry that is not a bare origin such as https://app.test
export function checkCorsPolicy(policy: CorsPolicy): CorsPolicy {
  if (policy.origins === "*") return policy;
  for (const origin of policy.origins) {
    if (!isOrigin(origin)) {
      throw new Error(
        `CORS origin "${origin}" must be a bare origin as browsers send it, such as https://app.test or http://[::1]:3000.`,
      );
    }
  }
  return { origins: [...policy.origins] };
}

// the headers a response to this Origin carries
export function corsHeaders(
  origin: string | undefined,
  policy: CorsPolicy,
): Record<string, string> {
  const exposed = { "access-control-expose-headers": corsExposedHeaders.join(", ") };
  if (policy.origins === "*") return { "access-control-allow-origin": "*", ...exposed };
  // the answer depends on Origin, so a cache must keep one copy per origin
  const allowed = origin !== undefined && policy.origins.includes(origin);
  return allowed
    ? { "access-control-allow-origin": origin, vary: "Origin", ...exposed }
    : { vary: "Origin" };
}

export function isPreflight(
  method: string,
  origin: string | undefined,
  requestMethod: string | undefined,
): boolean {
  return method === "OPTIONS" && origin !== undefined && requestMethod !== undefined;
}

// answered before the engine, so a preflight never runs a control or advances a sequence
export function preflight(origin: string | undefined, policy: CorsPolicy): EngineResponse {
  return {
    status: 204,
    headers: {
      ...corsHeaders(origin, policy),
      "access-control-allow-methods": corsMethods.join(", "),
      "access-control-allow-headers": corsAllowedHeaders.join(", "),
      "access-control-max-age": String(corsMaxAgeSeconds),
    },
  };
}

// adds the CORS headers to a response's headers, appending to an existing Vary
export function withCors(
  headers: Record<string, string>,
  origin: string | undefined,
  policy: CorsPolicy,
): Record<string, string> {
  const merged = { ...headers };
  for (const [name, value] of Object.entries(corsHeaders(origin, policy))) {
    merged[name] = name === "vary" && merged.vary ? `${merged.vary}, ${value}` : value;
  }
  return merged;
}
