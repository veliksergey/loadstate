import {
  type CorsPolicy,
  checkCorsPolicy,
  defaultCorsPolicy,
  type Engine,
  isPreflight,
  preflight,
  serialize,
  withCors,
} from "@loadstate/core";
import { http } from "msw";

export interface HandlerOptions {
  baseUrl: string;
  // any origin without credentials by default; a list answers only those origins
  cors?: CorsPolicy | undefined;
}

export function createHandlers(
  engine: Engine,
  { baseUrl, cors = defaultCorsPolicy }: HandlerOptions,
) {
  const policy = checkCorsPolicy(cors);
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, "");

  // compare literally: a ":" or "*" in the base URL is not MSW pattern syntax
  const inScope = (url: URL) =>
    url.origin === base.origin &&
    (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));

  return [
    http.all(
      ({ request }) => inScope(new URL(request.url)),
      async ({ request }) => {
        const origin = request.headers.get("origin") ?? undefined;
        const requested = request.headers.get("access-control-request-method") ?? undefined;
        // preflights end here, before the engine, as in the HTTP adapter
        if (isPreflight(request.method, origin, requested)) {
          const answer = serialize(preflight(origin, policy));
          return new Response(answer.body, { status: answer.status, headers: answer.headers });
        }
        const url = new URL(request.url);
        const bytes = await request.arrayBuffer();
        const response = engine.handle({
          method: request.method,
          path: url.pathname.slice(prefix.length),
          query: url.searchParams,
          headers: request.headers,
          contentType: request.headers.get("content-type") ?? undefined,
          body: new TextDecoder().decode(bytes),
          bodyBytes: bytes.byteLength,
          baseUrl: `${base.origin}${prefix}`,
        });
        // the engine plans a simulated delay; the handler waits before answering
        if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs));
        const { status, headers, body } = serialize(response);
        return new Response(body, { status, headers: withCors(headers, origin, policy) });
      },
    ),
  ];
}
