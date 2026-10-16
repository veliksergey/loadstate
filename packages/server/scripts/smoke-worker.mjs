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
  const { meta, data } = await list.json();
  assert.equal(meta.limit, 2);
  assert.ok(meta.total > 2 && meta.hasMore);
  assert.ok(data[0].avatar.url.startsWith(`${base}/img/avatar/`));

  const nested = await fetch(`${base}/v1/categories/2/products?limit=1`);
  assert.equal(nested.status, 200);
  assert.equal((await nested.json()).data[0].categoryId, 2);

  const created = await fetch(`${base}/v1/users`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(user),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("x-mock-state"), "stateless");
  assert.equal(created.headers.get("location"), `/v1/users/${meta.total + 1}`);
  assert.equal((await fetch(`${base}/v1/users/${meta.total + 1}`)).status, 404);

  // the public demo is stateless: writes answer as if saved and keep nothing
  const patched = await fetch(`${base}/v1/users/1`, {
    method: "PATCH",
    headers: json,
    body: JSON.stringify({ name: "Patched Name" }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).name, "Patched Name");
  assert.notEqual((await (await fetch(`${base}/v1/users/1`)).json()).name, "Patched Name");

  const removed = await fetch(`${base}/v1/todos/1`, { method: "DELETE" });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), "");
  assert.equal((await fetch(`${base}/v1/todos/1`)).status, 200);

  const blocked = await fetch(`${base}/v1/users/1`, { method: "DELETE" });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "has_dependents");

  const notAllowed = await fetch(`${base}/v1/users/1`, { method: "POST" });
  assert.equal(notAllowed.status, 405);
  assert.equal(notAllowed.headers.get("allow"), "GET, HEAD, PUT, PATCH, DELETE");

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
