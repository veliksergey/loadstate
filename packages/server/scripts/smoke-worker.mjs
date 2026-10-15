// Starts the Workers entry under local Wrangler and checks it end to end.
// Wrangler bundles @loadstate/core from dist, so run `pnpm build` first.
import assert from "node:assert/strict";
import { maxBodyBytes } from "@loadstate/server";
import { unstable_dev } from "wrangler";

const json = { "content-type": "application/json" };
const user = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };

function chunked(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const worker = await unstable_dev("src/worker.ts", {
  config: "wrangler.toml",
  ip: "127.0.0.1",
  experimental: { disableExperimentalWarning: true },
});
const base = `http://${worker.address}:${worker.port}`;

try {
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const list = await fetch(`${base}/v1/users?limit=2`);
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).meta, { limit: 2, offset: 0, total: 25, hasMore: true });

  const created = await fetch(`${base}/v1/users`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(user),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("x-mock-state"), "stateless");
  assert.equal(created.headers.get("location"), "/v1/users/26");
  assert.equal((await fetch(`${base}/v1/users/26`)).status, 404);

  const removed = await fetch(`${base}/v1/users/1`, { method: "DELETE" });
  assert.equal(removed.status, 405);
  assert.equal(removed.headers.get("allow"), "GET, HEAD");

  const oversized = await fetch(`${base}/v1/users`, {
    method: "POST",
    headers: json,
    body: chunked(" ".repeat(maxBodyBytes + 1)),
    duplex: "half",
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "body_too_large");

  console.log(`Worker smoke check passed against ${base}`);
} finally {
  await worker.stop();
}
