import { EventEmitter } from "node:events";
import { corePack, createEngine, pageSchema, userSchema } from "@loadstate/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maxBodyBytes } from "../src/app.js";
import { parsePort, runServer, startServer } from "../src/node.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startServer", () => {
  it("serves the app over real HTTP on an ephemeral loopback port", async () => {
    const server = await startServer({ port: 0 });
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const health = await fetch(`${server.url}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });

      const list = await fetch(`${server.url}/v1/users?limit=2`);
      expect(list.status).toBe(200);
      expect(pageSchema(userSchema).parse(await list.json()).data).toHaveLength(2);
    } finally {
      await server.close();
    }
  });

  it("rejects when the port is already in use", async () => {
    const first = await startServer({ port: 0 });
    try {
      const port = Number(new URL(first.url).port);
      await expect(startServer({ port })).rejects.toThrow(/EADDRINUSE/);
    } finally {
      await first.close();
    }
  });
});

describe("parsePort", () => {
  it.each([
    [undefined, 4000],
    ["", 4000],
    ["0", 0],
    ["8080", 8080],
    ["65535", 65535],
  ])("reads %j as %i", (raw, port) => {
    expect(parsePort(raw)).toBe(port);
  });

  it.each(["65536", "-1", "80.5", "abc", " 80", "1e3"])("rejects %j", (raw) => {
    expect(() => parsePort(raw)).toThrow(
      `PORT must be a whole number from 0 to 65535, got "${raw}".`,
    );
  });
});

describe("runServer", () => {
  function fakeProcess(env: Record<string, string>) {
    return Object.assign(new EventEmitter(), { env, exit: vi.fn() });
  }

  it.each(["SIGINT", "SIGTERM"])("closes the server and exits 0 on %s", async (signal) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const proc = fakeProcess({ PORT: "0" });

    const server = await runServer(proc);
    expect(server).toBeDefined();
    const url = `${server?.url}/healthz`;
    expect((await fetch(url)).status).toBe(200);

    proc.emit(signal);
    await vi.waitFor(() => expect(proc.exit).toHaveBeenCalledWith(0));
    await expect(fetch(url)).rejects.toThrow();
  });

  it("exits 1 with a clear message when PORT is invalid", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const proc = fakeProcess({ PORT: "http" });

    expect(await runServer(proc)).toBeUndefined();
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(logged).toHaveBeenCalledWith('PORT must be a whole number from 0 to 65535, got "http".');
  });
});

describe("request bodies over real HTTP", () => {
  const newUser = {
    name: "Ines Duarte",
    username: "ines.duarte",
    email: "ines.duarte@example.com",
  };

  // fetch sends a stream body with chunked transfer encoding and no Content-Length
  function chunked(text: string) {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async function withServer(test: (url: string) => Promise<void>) {
    const server = await startServer({ port: 0, engine: createEngine({ state: "memory" }) });
    try {
      await test(server.url);
    } finally {
      await server.close();
    }
  }

  it("answers a bodiless DELETE with 204 and an empty body", async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/v1/todos/1`, { method: "DELETE" });
      expect(response.status).toBe(204);
      expect(response.headers.get("content-type")).toBeNull();
      expect(await response.text()).toBe("");
      expect((await fetch(`${url}/v1/todos/1`)).status).toBe(404);
    });
  });

  it("answers a bodiless OPTIONS with 405, not 500", async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/v1/users/1`, { method: "OPTIONS" });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD, PUT, PATCH, DELETE");
    });
  });

  it("accepts a chunked PATCH body", async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/v1/users/1`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: chunked(JSON.stringify({ name: "Chunked Name" })),
        duplex: "half",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: 1, name: "Chunked Name" });
    });
  });

  it("accepts a chunked JSON body under the limit", async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/v1/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chunked(JSON.stringify(newUser)),
        duplex: "half",
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("location")).toBe(`/v1/users/${corePack.data.users.length + 1}`);
    });
  });

  it("rejects a chunked body over the limit with 413", async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/v1/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: chunked(" ".repeat(maxBodyBytes + 1)),
        duplex: "half",
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "body_too_large" });
    });
  });

  it("rejects a declared Content-Length over the limit with 413", async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/v1/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: " ".repeat(maxBodyBytes + 1),
      });
      expect(response.status).toBe(413);
    });
  });
});
