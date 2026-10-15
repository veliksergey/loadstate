# AGENTS.md

Instructions for AI coding agents working in this repository. Claude Code reads it to know which checks to run; Codex reads it before every review.

## Roles

Claude Code implements. Codex reviews read-only. The user decides and commits.

## Project

Loadstate is a fake REST API and scenario toolkit for front-end development and testing. The plan and contracts live in `docs/`: start with `docs/PROJECT-PLAN.md`, then `docs/API-SPEC.md` and `docs/TECHNICAL-DECISIONS.md`. Current milestone: M0.

| Path | Contents |
|---|---|
| `packages/core` | Contracts, fixtures, query parsing, pagination, Problem Details, the engine (`createEngine`) that routes and answers every `/v1` request, and the OpenAPI generator (`createOpenApiDocument`). Portable: no Node, DOM or Workers APIs. |
| `packages/server` | Hono adapter (`createApp`): health routes, the request body limit, and a catch-all that hands `/v1/*` to an engine. Node entry (`node.ts`, executable `main.ts`) and Workers entry (`worker.ts`). |
| `packages/msw` | MSW 3 adapter (`createHandlers`) that forwards requests under a base URL to an engine. Portable: builds without Node types. |

Toolchain: Node `>=22.12.0` (24 is the reference), pnpm 12.11.2 through `packageManager`, TypeScript 6.0.3 with `strict`, Biome 2.5.15 for lint and format, Vitest 5. Use pnpm for every package command, including registry lookups.

Workspace packages resolve to their TypeScript sources through the `@loadstate/source` export condition: Vitest sets it in `vitest.config.ts`, typecheck configs set it through `customConditions`, and builds resolve to `dist`.

## Commands

The checks CI runs, in this order. `pnpm check` runs all four; `pnpm format` applies Biome fixes.

| Check | Command |
|---|---|
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Build | `pnpm build` |
| Test | `pnpm test` |

Lint, typecheck and test are read-only. Build writes `dist/` folders, which git ignores.

When `pnpm` cannot start, for example in an offline sandbox where Corepack cannot fetch the pinned pnpm, run the same read-only checks through Node from the repository root:

| Check | Command |
|---|---|
| Lint | `node node_modules/@biomejs/biome/bin/biome check .` |
| Typecheck | `node node_modules/typescript/bin/tsc -p packages/<name>/tsconfig.json` for `core`, `server` and `msw` |
| Test | `node node_modules/vitest/vitest.mjs run` |

Tests that start a server on `127.0.0.1` need loopback networking; report them as not run if the sandbox blocks it.

CI then runs two smoke checks. Both build first, write to a temporary directory or `dist/`, and start local servers, so a read-only reviewer reports them as not run.

| Check | Command | Proves |
|---|---|---|
| Pack | `pnpm smoke:pack` | Each tarball holds exactly `package.json`, `LICENSE` and the compiled `src` files; the packages install into a fresh project and work there with plain Node and TypeScript |
| Worker | `pnpm smoke:worker` | The Workers entry runs under local Wrangler and answers health, list, create, 405 and 413 |

`pnpm --filter @loadstate/server dev:worker` runs the Workers entry locally for manual use.

## Branches

`main` is the default branch of `github.com/sergev-magnetsusa/loadstate`. CI runs on pushes and pull requests to `main`. Agents never commit, push, tag, publish or deploy without the user's explicit authorization for that action.

## Invariants

- `packages/core` stays portable. Its build config has no Node or DOM types, so a Node-only API in core fails `pnpm build`.
- Built-in fixtures are deterministic and immutable: fixed epoch, no runtime randomness, frozen records.
- Routing and behavior for `/v1` live in the core engine, so every adapter answers identically. Adapters translate requests and responses only; `packages/msw/test/parity.test.ts` proves the Node HTTP and MSW adapters match the in-process engine.
- The OpenAPI document is generated from the Zod contracts and never written by hand. `packages/core/test/openapi.test.ts` validates it against the official OpenAPI 3.1 and 3.2 meta-schemas and checks engine responses against it, so a new route, status or field needs a matching change in `packages/core/src/openapi.ts`.
- Each engine is an isolated run: records, the next id and sequence positions never leak between engines, and `reset()` restores all of them.
- REST errors are RFC 9457 Problem Details (`application/problem+json`) with a stable `code`. A 5xx body never contains an exception message or stack.
- Query input is validated strictly. Invalid, out-of-range, repeated and unknown parameters return 400; nothing is coerced or silently ignored.
- The Node server binds to loopback unless a caller explicitly passes another host.
- The public demo is stateless, simulation controls never bypass host limits, and management never shares the data routes (`docs/TECHNICAL-DECISIONS.md`, section 6).
- Package builds start from an empty `dist`, and a packed manifest points only at `dist` (`publishConfig.exports`).
- Dependency install scripts stay disabled unless reviewed: every package with one is listed in `allowBuilds` in `pnpm-workspace.yaml`, and pnpm fails the install for any that is not.
- Code comments are one short line explaining a non-obvious reason.

## Review decisions

Rejected review findings and their evidence: `docs/reviews/decisions.md`.
