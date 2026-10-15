import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { Engine } from "@loadstate/core";
import { createApp } from "./app.js";

export const defaultPort = 4000;

export interface StartOptions {
  port?: number;
  hostname?: string;
  engine?: Engine;
}

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

export function startServer({
  port = defaultPort,
  hostname = "127.0.0.1",
  engine,
}: StartOptions = {}): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const onListening = (info: AddressInfo) => {
      server.off("error", reject);
      const host = info.address.includes(":") ? `[${info.address}]` : info.address;
      resolve({
        url: `http://${host}:${info.port}`,
        close: () =>
          new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    };
    // keep Node's own Request and Response globals for tests and interceptors
    const server = serve(
      { fetch: createApp({ engine }).fetch, port, hostname, overrideGlobalObjects: false },
      onListening,
    );
    server.once("error", reject);
  });
}

export function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return defaultPort;
  if (!/^\d+$/.test(raw) || Number(raw) > 65535) {
    throw new Error(`PORT must be a whole number from 0 to 65535, got "${raw}".`);
  }
  return Number(raw);
}

export interface ProcessLike {
  env: Record<string, string | undefined>;
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  exit(code: number): void;
}

export async function runServer(proc: ProcessLike = process): Promise<RunningServer | undefined> {
  let server: RunningServer;
  try {
    server = await startServer({ port: parsePort(proc.env.PORT) });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    proc.exit(1);
    return undefined;
  }
  console.log(`Loadstate listening on ${server.url}`);

  const stop = () => {
    server.close().then(
      () => proc.exit(0),
      (error: unknown) => {
        console.error(error);
        proc.exit(1);
      },
    );
  };
  proc.once("SIGINT", stop);
  proc.once("SIGTERM", stop);
  return server;
}
