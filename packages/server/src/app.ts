import {
  createEngine,
  type Engine,
  type EngineResponse,
  maxBodyBytes,
  problem,
  serialize,
} from "@loadstate/core";
import { Hono } from "hono";

export { maxBodyBytes };

export interface AppOptions {
  engine?: Engine | undefined;
  // trusted base for image URLs and links; without it, each request's origin, which only
  // a platform that routes by hostname (Workers) vouches for; startServer always passes one
  publicUrl?: string | undefined;
}

export function createApp({
  engine = createEngine({ state: "stateless" }),
  publicUrl,
}: AppOptions = {}): Hono {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", (c) => c.json({ status: "ready" }));

  app.all("/v1/*", async (c) => {
    const body = await readBody(c.req.raw, maxBodyBytes);
    if (body === undefined) {
      return toResponse(
        problem(413, "body_too_large", `The request body must be at most ${maxBodyBytes} bytes.`),
      );
    }
    const url = new URL(c.req.url);
    const response = engine.handle({
      method: c.req.method,
      path: url.pathname,
      query: url.searchParams,
      headers: c.req.raw.headers,
      contentType: c.req.header("content-type"),
      body,
      baseUrl: publicUrl ?? url.origin,
    });
    // the engine plans a simulated delay; the adapter waits before sending headers
    if (response.delayMs) await wait(response.delayMs);
    return toResponse(response);
  });

  app.notFound(() => toResponse(problem(404, "not_found", "No route matches this path.")));

  app.onError((error) => {
    console.error(error);
    return toResponse(
      problem(500, "internal_error", "The server could not complete this request."),
    );
  });

  return app;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function toResponse(response: EngineResponse): Response {
  const { status, headers, body } = serialize(response);
  return new Response(body, { status, headers });
}

// reads at most `limit` bytes without re-wrapping the request; undefined means too large
async function readBody(request: Request, limit: number): Promise<string | undefined> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return undefined;
  if (!request.body) return "";

  const decoder = new TextDecoder();
  const reader = request.body.getReader();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
