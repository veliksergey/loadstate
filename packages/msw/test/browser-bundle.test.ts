import { fileURLToPath } from "node:url";
import { build, createLogger, defaultClientConditions, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function chunksOf(output: Awaited<ReturnType<typeof build>>): Rolldown.OutputChunk[] {
  const outputs = Array.isArray(output) ? output : [output];
  return outputs.flatMap((result) =>
    "output" in result ? result.output.filter((item) => item.type === "chunk") : [],
  );
}

describe("browser bundle", () => {
  it("bundles the adapter and core from source without Node built-ins", async () => {
    const warnings: string[] = [];
    const logger = createLogger("warn");
    logger.warn = (message) => warnings.push(message);
    logger.warnOnce = (message) => warnings.push(message);

    const output = await build({
      configFile: false,
      root: packageRoot,
      customLogger: logger,
      logLevel: "warn",
      resolve: { conditions: ["@loadstate/source", ...defaultClientConditions] },
      build: {
        write: false,
        minify: false,
        lib: { entry: "src/index.ts", formats: ["es"], fileName: "bundle" },
        rolldownOptions: { external: ["msw"] },
      },
    });

    const chunks = chunksOf(output);
    expect(chunks).toHaveLength(1);
    const [chunk] = chunks;
    expect(chunk?.imports).toEqual(["msw"]);
    expect(chunk?.code).not.toMatch(/["']node:|__vite-browser-external/);
    const modules = (chunk?.moduleIds ?? []).map((id) => id.replaceAll("\\", "/"));
    expect(modules.some((id) => id.endsWith("packages/core/src/engine.ts"))).toBe(true);
    expect(warnings).toEqual([]);
  });
});
