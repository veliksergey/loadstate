// Packs the workspace packages and uses them from a fresh project outside the workspace.
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const names = ["core", "server", "msw"];
const work = mkdtempSync(join(tmpdir(), "loadstate-smoke-"));

function run(command, cwd) {
  console.log(`$ ${command}`);
  execSync(command, { cwd, stdio: "inherit" });
}

// regular files of a .tgz, by path; enough tar for npm tarballs
function readTarball(file) {
  const data = gunzipSync(readFileSync(file));
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= data.length && data[offset] !== 0) {
    const field = (start, length) =>
      data.toString("utf8", offset + start, offset + start + length).replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join("/");
    if (["0", ""].includes(field(156, 1))) {
      files.set(name, data.toString("utf8", offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function checkTarball(name) {
  const file = join(work, `loadstate-${name}-0.0.0.tgz`);
  const files = readTarball(file);
  const compiled = readdirSync(join(root, "packages", name, "src"))
    .filter((source) => source.endsWith(".ts"))
    .flatMap((source) => {
      const base = source.slice(0, -".ts".length);
      return [`package/dist/${base}.js`, `package/dist/${base}.d.ts`];
    });
  const expected = ["package/LICENSE", "package/package.json", ...compiled].sort();
  const actual = [...files.keys()].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${name} tarball files differ.\nexpected: ${expected}\nactual:   ${actual}`);
  }

  const manifest = files.get("package/package.json") ?? "";
  for (const forbidden of ["@loadstate/source", "workspace:"]) {
    if (manifest.includes(forbidden)) throw new Error(`${name} manifest contains ${forbidden}`);
  }
  console.log(`${name}: ${actual.length} files, manifest points at dist`);
  return file.replaceAll("\\", "/");
}

const runtimeCheck = `import assert from "node:assert/strict";
import { createEngine } from "@loadstate/core";
import { createHandlers } from "@loadstate/msw";
import { startServer } from "@loadstate/server";
import { setupServer } from "msw/node";

const user = { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" };
const post = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(user) };

const server = await startServer({ port: 0, engine: createEngine({ state: "memory" }) });
try {
  assert.equal((await fetch(server.url + "/v1/users", post)).status, 201);
  const read = await fetch(server.url + "/v1/users/26");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).username, user.username);
} finally {
  await server.close();
}

const baseUrl = "http://api.smoke.test";
const mock = setupServer(...createHandlers(createEngine({ state: "memory" }), { baseUrl }));
mock.listen({ onUnhandledFrame: "error" });
try {
  assert.equal((await fetch(baseUrl + "/v1/users", post)).status, 201);
  assert.equal((await fetch(baseUrl + "/v1/users/26")).status, 200);
} finally {
  mock.close();
}
console.log("consumer runtime check passed");
`;

const typeCheck = `import { createEngine, type Engine, type User } from "@loadstate/core";
import { createHandlers } from "@loadstate/msw";
import { type RunningServer, startServer } from "@loadstate/server";

const engine: Engine = createEngine({ state: "memory", sequences: { "GET /v1/users/:id": [503] } });
export const handlers = createHandlers(engine, { baseUrl: "http://api.smoke.test" });
export const running: Promise<RunningServer> = startServer({ port: 0, engine });
export const nobody: User | undefined = undefined;

// fails to compile if the shipped declarations resolved to any
// @ts-expect-error a state is required
createEngine({});
`;

try {
  run("pnpm build", root);
  for (const name of names)
    run(`pnpm --filter @loadstate/${name} pack --pack-destination "${work}"`, root);
  const tarballs = Object.fromEntries(names.map((name) => [name, checkTarball(name)]));

  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  const deps = Object.fromEntries(
    names.map((name) => [`@loadstate/${name}`, `file:${tarballs[name]}`]),
  );
  const manifest = {
    name: "loadstate-consumer",
    private: true,
    type: "module",
    packageManager: "pnpm@12.11.2",
    dependencies: { ...deps, msw: "3.0.3", typescript: "6.0.3", "@types/node": "22.20.5" },
  };
  writeFileSync(join(consumer, "package.json"), JSON.stringify(manifest, null, 2));
  // server and msw depend on core@0.0.0, which exists only as this tarball
  writeFileSync(
    join(consumer, "pnpm-workspace.yaml"),
    `overrides:\n  "@loadstate/core": "${deps["@loadstate/core"]}"\n`,
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "es2023",
        module: "nodenext",
        moduleResolution: "nodenext",
        types: ["node"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      files: ["check-types.ts"],
    }),
  );
  writeFileSync(join(consumer, "check.mjs"), runtimeCheck);
  writeFileSync(join(consumer, "check-types.ts"), typeCheck);

  run("pnpm install --prefer-offline", consumer);
  run("node check.mjs", consumer);
  run("pnpm exec tsc -p tsconfig.json", consumer);
  console.log("Pack smoke check passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}
