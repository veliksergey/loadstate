# Status and handoff

Updated 2026-10-19. Last commit: `966e13c` (M1a step 6), CI green.

**Summary.** M0 is done and M1a, the first public release, is 6 of 10 steps in. The engine, six resources, queries, simulation controls, images, discovery routes, CORS and the served OpenAPI documents work locally, over HTTP, on Workers and through MSW. What remains for M1a: the `npx loadstate` CLI and a single published package (step 7), public rate and concurrency limits (step 8), a landing page with a URL builder (step 9), and the release (step 10). The public demo still runs M0 code.

## How to resume

For a person or an AI agent picking this up:

1. Read `AGENTS.md` (commands, invariants, authorization rules; `CLAUDE.md` only imports it), then this file, then `docs/PROJECT-PLAN.md` section 13 (roadmap and exit evidence) and `docs/API-SPEC.md` (the contract a developer sees).
2. Set up: Node `>=22.13.0` (24 is the reference), pnpm 12.11.2 through `packageManager`, then `pnpm install`.
3. Confirm the baseline: `pnpm check` (lint, typecheck, build, 1912 tests), `pnpm smoke:pack`, `pnpm smoke:worker`. All three passed on `966e13c`.
4. Work one step at a time, as steps 1 to 6 were:
   - write numbered acceptance criteria before coding;
   - implement with a regression test for every bug fixed;
   - run `pnpm check` and both smoke checks;
   - have an independent reviewer (so far Codex, read-only, up to three rounds) check the change against the criteria;
   - record any rejected review finding with its evidence in `docs/reviews/decisions.md` (none so far);
   - the owner reads the diff and authorizes the commit.
5. Never commit, push, publish to npm or deploy without the owner's explicit authorization for that action.

## Where the project stands

| Stage | State |
|---|---|
| M0: decisions and spikes | Done 2026-10-15 |
| M1a: public demo | Steps 1 to 6 of 10 done |
| M1b: local stateful core | Not started |
| M2a, M2b, M2c: test infrastructure, workflows, protocols | Not started |
| M3: targeted expansion | Not started |

### Done

| Step | Commit | Delivered |
|---|---|---|
| M0 | `86a89c5`, `b3a5f33` | pnpm workspace (`packages/core`, `server`, `msw`); CI on Ubuntu (Node 22.13.0 and 24) and Windows (Node 24); shared engine with stateless and memory modes; Node, Workers and MSW adapters proven identical; first Workers deploy |
| M1a 1 and 2 | `d98438b` | `core@1` fixture pack generated with Faker from a fixed seed, frozen and drift-tested; list, read and nested routes for users, posts, comments, categories, products and todos; validated POST, PUT, PATCH and DELETE with conflicts and restrictive deletes; memory engines store writes, stateless engines keep nothing |
| M1a 3 | `40d857b` | Offset, page and cursor pagination; bound base64url cursors; `q` search; typed filters; multi-field sort; `fields`; to-one `expand`; `Link` headers from a trusted base |
| M1a 4 | `68a26bc` | `_mock.*` query controls and `X-Mock-*` headers (delay, status, scenario, body, step, failRate, fixture, seed); twelve named scenarios; hand-written `edge@1` pack |
| M1a 5 | `9619ce8` | `/img` SVG placeholders and avatars from fixed templates, with caching, `nosniff` and a strict CSP |
| M1a 6 | `966e13c` | `GET /v1` catalog, `/capabilities`, `/v1/_utils/echo`, `/v1/_utils/status/{code}`; served `/openapi.json`, `/openapi-3.2.json` and `/docs` (Scalar, pinned with SRI); CORS with an origin allowlist option |

The tests cover every route through the in-process engine, a parity test (same requests in-process, over HTTP and through MSW), OpenAPI meta-schema and contract checks, and both smoke checks.

## What is left in M1a

The plan's exit evidence for M1a (`docs/PROJECT-PLAN.md`, section 13): a new developer completes the hosted and local quick starts from the README; fixtures stay stable; cursor rules are covered; public limits are enforced. Acceptance example: copy a products URL, select cursor pagination and a slow, error or empty scenario, and inspect a coherent response and clear limits.

### Step 7: `npx loadstate` CLI and one published package

- **CLI:** flags as drafted in `docs/API-SPEC.md`, section "CLI": `--port`, `--host`, `--mode memory|stateless`, `--fixture`, `--seed`, `--cors-origin` (repeatable), `--max-delay`. The building blocks exist:
  - `startServer` in `packages/server/src/node.ts` (loopback by default);
  - the `cors` option of `createApp`;
  - the engine's `fixture` and `maxDelayMs` options.
- **Open question:** what `--seed` controls. Seeded draws already come from `_mock.seed` per request; a process-wide default seed has no engine option yet.
- **Package shape:** one published `loadstate` package with subpaths (adopted provisionally, plan section 15). Today the three workspace packages are `private` and named `@loadstate/*`. `scripts/smoke-pack.mjs` checks their tarballs and must follow the new shape.
- **npm names:** `pnpm view` returned 404 for both `loadstate` and `@loadstate/core` on 2026-10-19. That means unpublished at that moment, not reserved.
- **Not part of step 7:** publishing to npm needs the owner's authorization. The license is MIT.

### Step 8: public limits on the Worker

- **Already enforced:**
  - page size 100;
  - request body 256 KiB;
  - delay 10 s by default;
  - SVG sides 10 to 2000;
  - expansion depth one;
  - strict query validation.
- **Still to build:**
  - request-rate and concurrent-work limits (plan section 12, "Proposed public limits to validate");
  - a bounded total request lifetime;
  - the 1 MiB response ceiling.
- **Design rules from the plan:**
  - use provider-aware admission control, never a forwarded IP header;
  - keep a real host 429 distinguishable from a simulated one, for example by a different Problem Details `code`.
- **Measure:** CPU per request on Workers, which has a 10 ms budget on the Free plan. M0 measured a median of 1 ms and a maximum of 9 ms over 14 requests, and asked for more samples before routes grew.

### Step 9: landing page and URL builder

- **Content:** per plan section 10:
  - a copyable request;
  - three paths: hosted demo, run locally, use in tests;
  - the current mode, persistence and limits shown next to the example;
  - a minimal URL builder: resource, query, fixture and scenario in; response and elapsed time out.
- **Hosting:** a static site served from Workers next to the API.
- **Framework:** still an owner decision; the plan suggests React with a static build.

### Step 10: release

- **README:** hosted and `npx` quick starts that a new developer can follow.
- **Deploy:** `pnpm build` then `pnpm --filter @loadstate/server exec wrangler deploy`, with the owner's authorization. Rerun live checks and record the version, bundle size and CPU times in `docs/TECHNICAL-DECISIONS.md` as M0 did.
- **Publish:** optionally the npm package, also with authorization.
- **After release:** launch items (article, Show HN, public-apis pull request) are listed in plan section 14 and are optional.

### Gaps to decide before closing M1a

- **Data packs:** the plan's M1a row lists "four data packs"; two exist (`core@1`, `edge@1`). `docs/API-SPEC.md` schedules fault packs for M1b. The larger local-only pack for tables and virtualization (plan section 7) is not built. Either build it or move it in the plan.
- **Control prefix:** `_mock.*` was adopted provisionally. Settle it before the first public URL is promoted; changing it later breaks shared links.

## After M1a

The plan, section 13, has the full table and acceptance examples:

- **M1b:** run-scoped state, scoped reset, deterministic sequences per run, MSW factory and strict unhandled-request mode, fault packs, Docker image, E2E harness, `--control` loopback API, scenario examples.
- **M2a:** business clock, request journal, HTTP control API, checkpoints, diagnostics.
- **M2b:** stateful auth, refresh and logout, concurrency and idempotency, conditional requests, async jobs.
- **M2c:** GraphQL, files, SSE and NDJSON streams, cache and cookie recipes, stable v1.
- **M3:** extensions chosen by demand: imports, durable storage, WebSockets and others.

## Open items and known issues

1. **Demo is stale:** `https://loadstate.veliksergey.workers.dev` runs M0 code (deployed 2026-10-15). Steps 1 to 6 are not deployed.
2. **Unreviewed fixes:** step 6's round 3 fixes were never re-reviewed by Codex because the loop hit its three-round limit:
   - a JSON echo body that is only a byte-order mark;
   - CORS hostnames with `_` or a trailing dot;
   - the echo DELETE body in OpenAPI.

   Step 5's third review round was not run.
3. **Invisible regex characters:** `slugify` in `packages/core/src/text.ts` holds literal combining characters (U+0300 to U+036F) inside its regex. It behaves correctly but the characters are invisible in editors. Replace them with escapes and confirm `test/fixtures.test.ts` stays green.
4. **Test-order hazard:** in `packages/msw/test/handlers.test.ts`, the "base URLs with pattern characters" tests call `server.resetHandlers(...)` with new handlers. That replaces the initial handlers for every later test in the file, so new tests must sit above that block until it is fixed.
5. **Commit identity:** commits so far use the owner's work email while the repository lives on the personal `veliksergey` account. Decide whether to set a personal `user.email` for this repository.
6. **CI runners:** CI uses the moving `ubuntu-latest` and `windows-latest` labels. Pin a specific image if a runner update breaks CI.
7. **TypeScript 7:** TypeScript 7.0.2 passed the M0 check but was held back until the OpenAPI generator passed the same check (`docs/TECHNICAL-DECISIONS.md`, M0 results). The generator now exists, so rerun that check.
8. **Provisional decisions:** these owner decisions from plan section 15 are still provisional:
   - pagination mode inference;
   - control prefix;
   - package shape;
   - playground framework;
   - project name and domain.
9. **`/docs` dependency:** the page loads Scalar from jsDelivr. Offline use gets the API and both documents, not the interactive page.

## Working notes

- **Package commands:** use pnpm for everything, including registry lookups (`pnpm view`).
- **Generated files:** never edit `src/fixtures/*.generated.ts` or `src/openapi.generated.ts` by hand. Regenerate with:
  - `pnpm --filter @loadstate/core fixtures:generate`
  - `pnpm --filter @loadstate/core openapi:generate`

  Drift tests fail until the committed files match.
- **Adding a route, status or field:** change `packages/core/src/openapi.ts`, regenerate the document, and add a contract case in `packages/core/test/openapi.test.ts`.
- **Windows paths:** paths over 260 characters break pnpm and workerd; the smoke checks use `os.tmpdir()`.
- **Pushing:** the remote is `github.com/veliksergey/loadstate`. On the owner's machine the active gh account may be a work account, so push as `veliksergey`. Earlier pushes used a one-off git credential helper that reads `gh auth token --user veliksergey`, leaving the active account unchanged.
- **Codex reviews on this Windows machine:**
  - run `codex exec review` with `-c 'sandbox_mode="read-only"'` and `-c 'windows.sandbox="mxc"'`;
  - inside that sandbox pnpm, Vitest and loopback servers cannot run;
  - reviews take 5 to 9 minutes, and background runs were sometimes stopped when memory ran low;
  - review logs and per-step task files live outside the repository, in `~/.claude/codex-reviews/mockstate/`.
