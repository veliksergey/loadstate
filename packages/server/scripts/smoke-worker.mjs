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

  const cursorPage = await fetch(
    `${base}/v1/products?pagination=cursor&limit=2&sort=-priceMinor&fields=id,priceMinor`,
  );
  assert.equal(cursorPage.status, 200);
  assert.ok(cursorPage.headers.get("link").includes(`<${base}/v1/products?`));
  const firstPage = await cursorPage.json();
  assert.deepEqual(Object.keys(firstPage.data[0]), ["id", "priceMinor"]);
  assert.ok(firstPage.data[0].priceMinor >= firstPage.data[1].priceMinor);
  const secondPage = await fetch(
    `${base}/v1/products?limit=2&sort=-priceMinor&fields=id,priceMinor&cursor=${firstPage.meta.nextCursor}`,
  );
  assert.equal(secondPage.status, 200);
  assert.ok((await secondPage.json()).data[0].priceMinor <= firstPage.data[1].priceMinor);

  const expanded = await (await fetch(`${base}/v1/posts/1?expand=author`)).json();
  assert.equal(expanded.author.id, expanded.userId);
  assert.ok(expanded.author.avatar.url.startsWith(`${base}/img/avatar/`));

  // controls: a header-driven status after a real wait, another pack, a body fault
  const started = Date.now();
  const simulated = await fetch(`${base}/v1/users/1?_mock.delay=50`, {
    headers: { "X-Mock-Status": "503" },
  });
  assert.ok(Date.now() - started >= 45);
  assert.equal(simulated.status, 503);
  assert.equal(simulated.headers.get("retry-after"), "60");
  assert.equal(simulated.headers.get("x-mock-applied"), "status=503, delay=50");
  assert.equal(simulated.headers.get("cache-control"), "no-store");
  const edge = await (await fetch(`${base}/v1/users?_mock.fixture=edge@1`)).json();
  assert.equal(edge.meta.total, 9);
  const html = await fetch(`${base}/v1/users/1?_mock.body=html`);
  assert.equal(html.headers.get("content-type"), "text/html; charset=utf-8");
  assert.ok((await html.text()).startsWith("<!doctype html>"));

  // images: the URLs records carry resolve on the Worker
  const cover = await fetch(data[0].avatar.url);
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get("content-type"), "image/svg+xml");
  assert.equal(cover.headers.get("cache-control"), "public, max-age=604800");
  assert.ok((await cover.text()).startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="96"'));
  const placeholder = await fetch(`${base}/img/600x400?text=Hero&style=gradient`);
  assert.ok((await placeholder.text()).includes(">Hero</text>"));
  assert.equal((await fetch(`${base}/img/600x400?_mock.status=404`)).status, 404);

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
