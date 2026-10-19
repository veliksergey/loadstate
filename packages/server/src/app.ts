import {
  type CorsPolicy,
  checkCorsPolicy,
  createEngine,
  defaultCorsPolicy,
  type Engine,
  type EngineResponse,
  isPreflight,
  maxBodyBytes,
  preflight,
  problem,
  serialize,
  withCors,
} from "@loadstate/core";
import { type Context, Hono } from "hono";

export { maxBodyBytes };

export interface AppOptions {
  engine?: Engine | undefined;
  // trusted base for image URLs and links; without it, each request's origin, which only
  // a platform that routes by hostname (Workers) vouches for; startServer always passes one
  publicUrl?: string | undefined;
  // any origin without credentials by default; a list answers only those origins
  cors?: CorsPolicy | undefined;
}

export function createApp({
  engine = createEngine({ state: "stateless" }),
  publicUrl,
  cors = defaultCorsPolicy,
}: AppOptions = {}): Hono {
  const policy = checkCorsPolicy(cors);
  const app = new Hono();

  // preflights end here, before the engine; every other response gets the CORS headers
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (isPreflight(c.req.method, origin, c.req.header("access-control-request-method"))) {
      return toResponse(preflight(origin, policy));
    }
    await next();
    // set in place: assigning c.res would copy the old headers back over these
    const headers = withCors(Object.fromEntries(c.res.headers), origin, policy);
    for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
  });

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/readyz", (c) => c.json({ status: "ready" }));

  const forward = async (c: Context) => {
    const body = await readBody(c.req.raw, maxBodyBytes);
    if (!body) {
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
      body: body.text,
      bodyBytes: body.bytes,
      baseUrl: publicUrl ?? url.origin,
    });
    // the engine plans a simulated delay; the adapter waits before sending headers
    if (response.delayMs) await wait(response.delayMs);
    return toResponse(response);
  };
  // the engine answers the data routes, the image fixtures and the discovery reads alike
  for (const path of [
    "/v1",
    "/v1/*",
    "/img/*",
    "/capabilities",
    "/openapi.json",
    "/openapi-3.2.json",
    "/docs",
  ]) {
    app.all(path, forward);
  }

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
async function readBody(
  request: Request,
  limit: number,
): Promise<{ text: string; bytes: number } | undefined> {
  if (Number(request.headers.get("content-length") ?? 0) > limit) return undefined;
  if (!request.body) return { text: "", bytes: 0 };

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
  return { text: text + decoder.decode(), bytes: size };
}
