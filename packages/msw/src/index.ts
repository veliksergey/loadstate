import { type Engine, serialize } from "@loadstate/core";
import { http } from "msw";

export interface HandlerOptions {
  baseUrl: string;
}

export function createHandlers(engine: Engine, { baseUrl }: HandlerOptions) {
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
        const url = new URL(request.url);
        const response = engine.handle({
          method: request.method,
          path: url.pathname.slice(prefix.length),
          query: url.searchParams,
          headers: request.headers,
          contentType: request.headers.get("content-type") ?? undefined,
          body: await request.text(),
          baseUrl: `${base.origin}${prefix}`,
        });
        // the engine plans a simulated delay; the handler waits before answering
        if (response.delayMs) await new Promise((done) => setTimeout(done, response.delayMs));
        const { status, headers, body } = serialize(response);
        return new Response(body, { status, headers });
      },
    ),
  ];
}
