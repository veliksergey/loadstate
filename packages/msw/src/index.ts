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
        const { status, headers, body } = serialize(
          engine.handle({
            method: request.method,
            path: url.pathname.slice(prefix.length),
            query: url.searchParams,
            contentType: request.headers.get("content-type") ?? undefined,
            body: await request.text(),
            baseUrl: `${base.origin}${prefix}`,
          }),
        );
        return new Response(body, { status, headers });
      },
    ),
  ];
}
