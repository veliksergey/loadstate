import { defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // resolve workspace packages to their TypeScript sources
  ssr: { resolve: { conditions: ["@loadstate/source", ...defaultServerConditions] } },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
});
