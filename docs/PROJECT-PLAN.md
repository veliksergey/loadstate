# Loadstate project plan

Planning date: **2026-10-15**, revised the same day after review. “Loadstate” is a working name; the workspace folder is currently `mockstate`, and domain, npm package, repository, and trademark availability have not been verified. Folder, package and product-prefixed header names follow the final name. This document proposes the project; the routes, packages, commands, tests, and deployments described below do not exist yet.

## 1. Recommended direction

Build an open-source **API and scenario toolkit for developing and testing front-end behavior**. Give developers an immediately usable public API, then let them run the same data and supported scenarios locally, in component tests, and in end-to-end tests. Make repeatable stateful workflows the distinguishing feature: create a record, refetch it, trigger a validation error, retry a failed save, and restore the original state without affecting another test.

Keep the draft's REST, GraphQL, pagination, images, delays, and approachable documentation. Move isolated local state, deterministic scenarios, and test adapters into the foundation. Release in two visible steps: a deployed stateless REST demo first (M1a), then the local stateful testing core that proves the differentiator (M1b). Deliver GraphQL, authentication flows, files, and streaming before declaring the broader product stable at v1.0.

Existing products already supply rich datasets, generated CRUD, latency, stateful mocks, and transport faults. The opportunity is to make common UI workflows easy to reproduce with useful fixtures, explanations, assertions, and portable test setup. The [research comparison](RESEARCH.md) explains where existing tools remain a better fit.

### Reading map

| Document | Purpose |
|---|---|
| **This plan** | Product scope, priorities, milestones, acceptance criteria, cursor and query rules, and open decisions |
| [API spec](API-SPEC.md) | Concrete M1 surface: resources and fields, example responses, scenario and control tables, image URLs, utility endpoints, CLI flags |
| [Research](RESEARCH.md) | Comparison of public APIs, configurable mocking tools, protocol utilities, and testing integrations; corrections to the original draft |
| [Front-end test scenarios](FRONTEND-TEST-SCENARIOS.md) | 134 practical scenarios, the M1-core gate, the reproducibility contract tests may rely on, required execution layer, and release priority |
| [Technical decisions](TECHNICAL-DECISIONS.md) | Architecture, researched library candidates, compatibility checks, security boundaries and credential rules, state/time/reset semantics, hosting and cost |
| [Original prompt](old/prompt.txt) and [original plan](old/API-tool-for-front-end-developers-PLAN.md) | Preserved input drafts; the new plan supersedes conflicting proposals |

Each rule lives in one document and the others link to it: security and credentials in Technical decisions section 6; storage, generations and time in Technical decisions section 4; the test-facing reproducibility contract in the scenario catalog; cursor and query rules in section 6 of this plan.

### Planning assumptions

- This is first a GitHub portfolio project and second a dependable local testing toolkit; sequencing favors a visible public release before the full testing surface. A public sample API alone would not satisfy the testing goal.
- Use TypeScript throughout the implementation. HTTP remains language-independent, so developers using other languages can use the server and control API.
- Plan for one primary maintainer working evenings and weekends, and a minimal hosting budget: the target is the **Cloudflare Workers free tier plus a domain of roughly $10–12 per year**. The paid Workers plan at $5/month is the fallback if free limits are exceeded. These are comparison assumptions, not approved purchases or cost estimates.
- Keep the anonymous public demo free and bounded. Local and self-hosted core features should work without a vendor account, hosted license check, or mandatory telemetry.
- Use React for the first playground and representative examples unless a different preference is chosen. The API and engine remain framework-independent.
- The workspace currently contains drafts and IDE metadata, with no application manifest, lockfile, source tree, test configuration, or Git repository detected. All implementation setup is future work.

## 2. Users and outcomes

| User | Job to support | Success looks like |
|---|---|---|
| Front-end learner or prototype author | Fetch believable records without building a backend | First useful response in a few minutes; clear loading, empty, and error examples |
| Application developer | Build forms, lists, auth, uploads, dashboards, and streams before backend completion | Change one scenario and see the relevant UI state; use their own fixtures later |
| Component/Storybook author | Reproduce a visual state in isolation | Offline fixture, stable images and clock, reusable scenario, no shared mutable global state |
| E2E/QA engineer | Exercise complete workflows and failure recovery | Fresh state per test/worker, deterministic retries, request assertions, clear failure artifacts |
| Backend/SDK/integration developer | Simulate a dependency and inspect outgoing requests | Plain HTTP, typed contracts, matching diagnostics, echo, sequences, and later schema import |
| Self-hosting maintainer | Run on a laptop, CI runner, or inexpensive server | Documented Node and Docker paths, bounded resources, health/readiness, predictable upgrades |

The service supplies conditions and evidence. Each application still defines its own correctness, accessibility, performance, and security assertions. Successful tests against a mock do not prove that a production backend honors the same contract; see the Pact and contract-testing discussion in [Research](RESEARCH.md).

## 3. What changes from the draft

| Keep | Change or add | Reason |
|---|---|---|
| Instant public API | Explicit public stateless mode and private/local stateful mode | Simulated successful writes cannot test create → refetch → edit |
| Fixed generated data | Version fixtures, generator, seed, locale, clock, and assets | A seed alone does not freeze generated dates or future library output |
| Failure controls | Named recipes, deterministic sequences, isolated counters, request assertions | Percentage failures make small test suites unpredictable |
| Shared REST/GraphQL logic | Framework-independent engine with separate HTTP and MSW adapters | Browser tests should not bundle the server, administrative routes, or Node dependencies |
| Local/self-hosted operation | Node/Docker reference runtime; Workers as the default host for the stateless public demo, measured in M0 | Portability and accurate transport behavior need explicit verification |
| Broad resources | A few relational domains first, then versioned packs | Deep workflows give more value than many shallow lists |
| Pagination | Explicit first-page cursor mode, query-bound cursors, mutation consistency rules | Stable sorting alone does not prevent cursor drift or incompatible reuse |
| Query/header controls | Reserved `_mock.*` query namespace | `status=active` must remain a domain filter rather than a forced HTTP status |
| Useful error bodies | REST Problem Details, GraphQL-native errors, explicit malformed fixtures | One error envelope cannot represent every protocol or deliberately broken payload |
| Image placeholders | Bundled offline assets, failure/cache rules, raster samples | External image dependencies undermine reproducible visual tests |
| Auth examples | Stateful refresh/logout/expiry and separate management authorization | Demo credentials must never control other runs or server administration |
| Low-cost hosting | Measured limits, concurrency caps, documented costs and fallback | The draft's quota and annual-cost assumptions are not reliable current guarantees |

The research corrects several competitor claims, including ReqRes's anonymous demo versus persistent collections, generated CRUD in Mockoon, MSW capabilities, Postman's current mock modes, and unverified claims about httpstat.us availability.

## 4. Product modes and boundaries

| Mode | State and intended use | Access and limits |
|---|---|---|
| Public demo | Versioned built-in datasets; writes are validated and simulated, with no read-after-write persistence | Anonymous bounded requests; no administrative endpoints or global reset; visible limits |
| Local server / CLI | In-memory mutable runs, real CRUD, sequences, logical clock, journal, reset and teardown | Loopback by default; test runner owns the run lifecycle |
| In-process / MSW | A fresh engine instance per test or story; supported response scenarios without a remote service | Strict unhandled-request mode; no server secrets or filesystem dependencies |
| Self-hosted server | Same Node/Docker distribution; operator-configured limits and private runs | Real authorization required when management is exposed; optional durability later |
| Hosted ephemeral runs, optional M3 | Private temporary state, isolated sessions, TTL and quotas | Requires an abuse and ownership design; not a first-release promise |

Return a mode indicator such as `X-Mock-State: stateless` or `memory`, and expose it in the playground. Stateless POST results must not imply that a subsequent GET can retrieve the returned record. Document this on every mutation example.

A run identifier selects state; it is not a credential. Simulated application authentication, real run admission for remote private runs, and management authorization are three separate authorities, and a synthetic login or role change can never substitute for the other two. The rules and reserved header names live in [Technical decisions, section 6](TECHNICAL-DECISIONS.md#6-security-boundaries); M1 needs only the loopback-bound local control surface described there.

## 5. Feature priorities

Release labels used throughout all documents:

- **M0:** settle contracts, validate the risky technical choices, and put a health endpoint on a public URL.
- **M1a:** first public release: a deployed stateless REST demo with data, controls, images, documentation and a local `npx` server.
- **M1b:** local stateful testing core: isolated in-memory runs, real CRUD, reset, deterministic sequences and the MSW adapter. Together M1a and M1b are "M1"; the scenario catalog's M1 column means supported by the end of M1b.
- **M2:** stable v1 target: test infrastructure (clock, journal, control API), GraphQL, authentication flows, files, streaming, and broader workflow coverage.
- **M3:** extensions driven by actual usage; each can ship independently.

| Capability | M1a public demo | M1b stateful core | M2 | M3 |
|---|---|---|---|---|
| REST | Reads, nested reads, filtering/search/sort/projection, offset/page/cursor pagination, validated stateless writes | Real CRUD against run state, restrictive relation deletes | Conditional writes, async jobs, richer bulk/workflow operations | Custom resource contracts and advanced query packs |
| Data | Users, posts/comments, products/categories, todos; valid edge packs | Fault packs; larger local-only fixture pack | Customers/orders/carts, books/authors, notifications/messages, locale and country/currency/timezone lookup packs | Calendar, finance, real estate, travel, files, and contributed domain packs |
| Scenarios | Delay, HTTP status, empty, malformed body, named recipes, stateless step selector | Deterministic sequences with exhaustion rules, locked controls, stale-response race, retry, rollback, validation | Commit-with-lost-response, idempotency, eventual consistency, token refresh, resumable streams | Complex state machines, configurable scenario editor |
| Testing | Toolkit's own tests only | Engine instance per test, scoped reset, MSW factory, strict unhandled-request mode, local E2E harness | Business clock, journal/assertions, HTTP control API, checkpoints, diagnostic bundles, concurrency recipes | Contract import, replay/import tools, optional property-based scenario generation |
| Auth | Fixed unauthorized/forbidden fixture responses | Same | Login, me, refresh, logout, expiry/revocation, roles/ownership/tenant exercises | OAuth/OIDC-provider integration recipes and MFA challenge simulations |
| GraphQL | Architecture and contract preparation | None | Queries/mutations, connections, errors/partial data, parity | Subscriptions and verified incremental delivery profiles |
| Media | SVG sizes/text/colors, avatars, broken/slow image | Small licensed raster fixtures | Downloads, CSV, multipart validation, progress and range recipes | Dynamic PNG/WebP rendering, audio/video and resumable uploads |
| Realtime | None | None | SSE and NDJSON; fake token stream, job progress, reconnect | WebSockets, presence, duplicate/out-of-order/gap scenarios |
| Custom APIs | None | User fixture overrides within supported built-in schemas | Declarative custom responses and request matching | OpenAPI/JSON Schema imports, HAR sanitization/replay, private proxy recording |
| Developer tools | Landing page with a copyable request, minimal URL builder, fetch/curl snippets, OpenAPI UI, resource types | Scenario gallery, MSW and E2E quick starts, one React query-client example | GraphiQL, applied-rule inspector, generated collections, scenario export/import | Visual custom-schema editor and integrations as justified |
| Operations | `npx` CLI, Workers public deployment, public limits, health/readiness, no-account local use | Docker image, Windows/macOS/Linux smoke tests, graceful shutdown | Upgrade/rollback docs and expanded observability | Durable storage, optional hosted private runs, additional validated runtimes |

Do not build a general identity provider, payment processor, email/SMS delivery service, or packet-level network emulator. Simulate their application-visible workflows and integrate dedicated tools where fidelity requires them. Email verification, password-reset, payment approval/decline, and webhook delivery can use local outboxes and scripted state without sending real messages or moving money.

## 6. Proposed API contract

This is a design baseline for M0 review, not an existing compatibility promise. Freeze the documented subset for each release; version breaking changes rather than silently changing fixtures or query behavior.

### REST resources and queries

Use `/v1` for the public resource contract. Local runs expose the same relative routes beneath a run-specific base URL. Reserve utility and control paths so a resource name cannot shadow them.

| Operation | Proposed behavior |
|---|---|
| `GET /v1/:resource` | `{ data, meta }` list envelope; deterministic default ordering |
| `GET /v1/:resource/:id` | Bare record; 404 when absent |
| `GET /v1/:resource/:id/:relation` | Bounded nested list using the same query/pagination rules |
| `POST /v1/:resource` | Validate create input; 201 and created representation; stored only in stateful mode |
| `PUT /v1/:resource/:id` | Replace writable fields of an existing record; required fields enforced; 404 for missing target |
| `PATCH /v1/:resource/:id` | Merge documented writable fields; omitted fields unchanged, explicit null only where nullable; arrays replaced atomically |
| `DELETE /v1/:resource/:id` | 204 without body; repeated deletion returns 404 by the chosen resource contract |
| `HEAD`, `OPTIONS` | Correct metadata/preflight behavior; HEAD has no response body |

Do not use the draft's “PULL”; the intended replacement method is PUT. Unsupported methods return 405 with `Allow`. No generic public CONNECT or TRACE endpoint.

Create, replacement, partial-update, read, and projected-response schemas are distinct. Reject attempts to set server-owned IDs/timestamps. Validate foreign keys and publish relation deletion policies; do not silently create orphaned records. M1 relational mutations can use restrictive deletion, returning a conflict when dependent records exist.

| Query area | Proposed contract |
|---|---|
| Offset | Default mode: `limit=20&offset=0` |
| Page | `pagination=page&page=2&perPage=20` |
| Cursor | First page: `pagination=cursor&limit=20`; next page adds opaque `cursor` |
| Search | `q` over an explicit resource-specific field list; documented case/Unicode normalization |
| Filters | Typed allowlisted fields such as `status=active`; numeric/date range suffixes such as `priceMinor_gte` |
| Sort | Allowlisted multi-field sort; explicit null order; unique `id` as final tie-breaker |
| Projection | `fields` on top-level scalar fields in M1; reject unknown fields |
| Relations | `expand` on an allowlist with depth, fan-out, and response-byte limits; no unbounded recursive expansion |
| Totals | Offset/page return totals; cursor totals opt in and describe cost |

Use one pagination mode per request. Reject conflicting mode-specific parameters, invalid numeric values, unknown controls, and ambiguous duplicate scalar parameters with 400. Keep a single list envelope in M1; an optional bare-array profile can follow only if demand justifies another contract.

An M1 cursor is opaque, size-bounded and validated, and binds four things: the resource, the fixture-pack version, a hash of the normalized filter/search/sort/direction, and the last row's complete sort tuple including `id`. Invalid or mismatched cursors receive an actionable 400. Immutable public fixtures therefore give stable traversal. M1b stateful runs add a simple data revision counter and reject a cursor after a relevant write, with a documented conflict and restart instruction. Binding to run namespace, generation and snapshot identity, and an explicit stable-snapshot or live-list profile, are M2 rules. Do not promise omission/duplication-free traversal through arbitrary mutations.

Return pagination metadata and appropriate `Link` headers. Generate links from a configured trusted public origin; do not reflect an arbitrary Host/forwarded header into links. Publish ETag semantics for the selected representation, not just the underlying unprojected record.

### Simulation controls

Reserve `_mock.*` query parameters and documented `X-Mock-*` equivalents. Example request designs:

```text
GET /v1/products?pagination=cursor&limit=12&_mock.scenario=slow
GET /v1/posts?q=cache&_mock.delay=1500
GET /v1/users/7?_mock.status=503
GET /img/600x400?_mock.status=404
```

| Control | Intended semantics |
|---|---|
| `_mock.scenario` | Named, versioned recipe such as `slow`, `empty`, `maintenance`, `validation-error` |
| `_mock.delay` | Bounded delay before response headers; deterministic ranges only with declared seed/operation identity |
| `_mock.status` | Allowlisted final HTTP status; respects bodyless statuses and redirect rules |
| `_mock.failRate` | Explicit exploratory probability from 0 to 1; not the default automated-testing mechanism |
| `_mock.fixture` | Select a published fixture-pack version; omitted value uses the documented API-release default |
| `_mock.seed` | Select reproducible fixture/variation input; does not identify or authorize a run |
| `_mock.step` | Select an explicit step of a named public recipe; stateless endpoints do not track progress between calls |
| `_mock.body` | Named fault profile, for example malformed JSON or wrong content type |
| Cache recipes | M1 named ETag/304, fresh-cache and no-store fixtures; richer configurable policies in M2 |
| Stream controls | Separate documented parameters introduced with M2; no overloaded “drip means every kind of slowness” |

Precedence: immutable server safety/access limits first; then explicit request controls over run configuration over named-recipe defaults over engine defaults. A query control wins over its header equivalent. Test runs can lock controls so application requests cannot override the prepared scenario. Reject incompatible combinations, such as malformed body with 204, or a stateful sequence on a stateless endpoint.

Provide an explanation of the resolved scenario in safe debug metadata. CORS preflight, health probes, and diagnostic reads must not advance a scenario sequence. Forced failures normally occur before mutation; “commit succeeds but acknowledgement is lost” is a separate explicit workflow.

A mutable run fixes its fixture version and data seed at creation. Reject per-request controls that would replace that run's data identity; use a new run or an authorized lifecycle operation instead. Stateless public fixture/seed variations are allowed, but their fingerprint must match throughout a cursor traversal.

REST and management errors use RFC 9457 Problem Details, with stable machine-readable codes and a documented field-error extension. GraphQL retains its `data`/`errors` envelope. Protocol-correct HEAD, 204, 205 and 304 responses carry no body; 1xx and protocol upgrades are not ordinary final-status fixtures. Redirect destinations are predefined or validated local paths. [Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html), [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html).

### Browser and cache behavior

Anonymous public reads may allow any origin without credentials. Cookie/credential scenarios require explicit origins and a real browser. Expose the documented pagination, retry, ETag, mode and debug response headers. Query controls avoid adding custom headers, but authorization, JSON bodies, and non-simple methods can still cause preflights. [CORS documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).

Default mutable runs, authentication, errors, delayed responses, and sequence simulations to `no-store`, bypassing shared caches. Explicit cache recipes can opt into ETag/304, expiry and revalidation. Cacheable variants must include every response-changing input in their key or appropriate `Vary` policy. Do not cache authenticated/run-specific data as anonymous content. Browser HTTP caching, framework server caching, and TanStack Query/SWR application caches require separate examples.

### GraphQL in M2

Expose a version-associated GraphQL endpoint, SDL download, and GraphiQL. Use explicit query/mutation input types, typed filters/order, Relay-style connections, and a clearly named page-query alternative. Resolve through the same domain/query engine as REST, with bounded relations and batched lookups.

Support operation names and variables, validation errors, field errors with paths, partial data, nullable/non-null propagation, and named mutation scenarios. Preserve GraphQL transport semantics; an HTTP failure and a successful HTTP response containing GraphQL errors are different recipes. Apply depth, complexity, alias and response-size limits. Introspection is useful for this public demo; limiting query cost matters independently.

REST/GraphQL parity means equivalent records, ordering, state transitions and domain errors where contracts overlap, not identical response envelopes. Keep incremental `@defer`/`@stream` and subscriptions in M3 until the selected server/client protocol versions are verified. [GraphQL specification](https://spec.graphql.org/September2025/).

### Authentication workflows in M2

Provide synthetic login, current-user, refresh and logout operations under `/v1/auth`, with documented fictional credentials. Stateful runs track refresh-token rotation, revocation and logout; access tokens have explicit issuer/audience/expiry semantics and use the run's business clock. Use a maintained token library rather than custom cryptography, with its version selected during the M2 compatibility check.

Include owner/non-owner, role, tenant and entitlement scenarios as distinct concepts. The simulated resource service enforces the configured fixture policy server-side; UI visibility alone does not determine access. Public examples can demonstrate fixed outcomes, but realistic revocation/refresh races require stateful runs. Credentials and signing material used for these examples are separate from real service management. Password-reset and MFA extensions use synthetic challenges or a local outbox, without sending real email/SMS.

### Utility and discovery endpoints

Reserve `/v1/_utils` for utilities, `/__control` for separately protected management, and `/img` for image fixtures. Proposed public utilities and their first release:

| Surface | Purpose | Release |
|---|---|---|
| `/v1` and `/capabilities` | Resource catalog, fixture/API versions, supported scenarios and adapter limits | M1 |
| `/v1/_utils/echo` | Inspect method, normalized query, allowlisted headers and bounded parsed payload; redact credentials/cookies | M1; multipart metadata in M2 |
| `/v1/_utils/status/:code` | Supported HTTP status fixtures with protocol-correct headers/body behavior | M1 |
| `/healthz`, `/readyz` | Liveness/readiness outside the simulation engine; no secret or internal configuration output | M1 |
| `/openapi.json`, `/docs` | Generated contract and interactive reference | M1 |
| `/v1/_utils/downloads`, `/v1/_utils/upload` | Known/unknown-length downloads, CSV/text/binary samples, bounded upload validation | M2 |
| `/v1/_utils/streams` | SSE/NDJSON recipes with documented framing, cancellation and resume behavior | M2 |
| `/v1/_utils/http` | Controlled redirects, cookies, cache and header exercises across configured origins | M2; basic cache/CORS recipes in M1 |

The control API manages runs, scenario registration, journal assertions and reset; checkpoints arrive in M2. Simulation knobs never affect control authorization, health checks or host admission limits. A dedicated status fixture does not imply arbitrary response-header injection or unrestricted redirects.

## 7. Data and media design

Ship a small realistic dataset and named boundary-condition packs. Define counts as fixture-version metadata rather than permanently promising the draft's arbitrary record totals. Initial sizing targets are tens of users/categories and hundreds of related posts/comments/products/todos, with a larger local-only fixture pack for tables and virtualization.

Maintain relationships and invariants: valid author/product references, consistent order totals, bounded ratings, known stock semantics, and deterministic sorting. Use integer IDs for the built-in v1 resources; custom string/UUID identifier contracts can be added without changing those built-ins. Model money in minor units with an explicit currency; decimal-string examples belong in a documented alternate fixture contract. Date-only values and UTC timestamps are different field types.

Generate normal fixtures during development/build, commit or package the resulting versioned data, and include a manifest with generator version, seed, fixed reference time, locale, counts and checksum. Dependency upgrades must not silently regenerate a released fixture pack. Faker documents that versions can change seeded output and that relative dates also require a fixed reference time. [Faker reproducibility](https://fakerjs.dev/guide/usage.html#reproducible-results).

Include valid edge packs for null/absent values, long text, Unicode/RTL, duplicate labels, date boundaries, zero values and missing optional relations. Deliberately invalid types, unknown enum values, missing required fields and malformed JSON belong to separately labeled fault packs; do not weaken the normal contract to make faults validate.

Images should expose URL, width, height, alt text and a placeholder color; provide optional compact blur metadata where useful. Generate trusted SVG shapes with escaped text, no script, no foreign objects and no external references. Enforce dimension, text-length and output-size limits. Keep a small licensed local raster set so screenshot tests and browser image decoding work offline. Delay/failure variants bypass normal long-lived image caching.

Use JSON for records; add SVG/raster images, Problem Details, text/binary downloads, CSV, SSE and NDJSON where the use case requires them. XML and arbitrary binary response fixtures can be a later generic response profile for SDK/legacy integration testing. Do not implement a full serialization stack for every resource without demonstrated demand.

## 8. Test lifecycle and state

The central unit is a **run**, which owns fixtures, mutable records, generated IDs, scenario registrations and sequence positions, and from M2 also logical time, sessions, rate counters and request history. Per-test engine instances are the simplest default; HTTP E2E workers receive distinct run-specific base URLs.

The test harness must support this workflow:

1. Create a run from a versioned fixture/scenario manifest.
2. Configure the application or MSW instance to use that run.
3. Drive UI or HTTP actions and, from M2, advance business time explicitly when needed.
4. Assert application behavior and, from M2, expected outgoing requests.
5. From M2, export a redacted diagnostic bundle on failure.
6. Dispose the run and cancel its timers, streams and handlers.

M1b delivers run creation, configuration and disposal, scoped atomic reset, and deterministic step sequences with declared exhaustion behavior. The business clock, journal and assertions, HTTP control API and checkpoints arrive in M2. The rules a test may rely on for isolation, matching, randomness, sequences, reset and journals are the reproducibility contract in [Front-end test scenarios](FRONTEND-TEST-SCENARIOS.md#reproducibility-contract-required-before-claiming-ci-support); storage modes, generations and time injection are in [Technical decisions, section 4](TECHNICAL-DECISIONS.md#4-deterministic-state-and-time). This plan does not restate them.

## 9. Architecture and stack

Use a small pnpm workspace with clear boundaries: contracts/data and engine; server/CLI; test adapters; playground/docs; examples. Do not create a separately published package for every internal module. Public package names and exact scripts are chosen during implementation.

Proposed layout, to be confirmed in M0:

```text
loadstate/
  packages/
    core/        contracts, fixtures, query engine, scenario engine; no Node-only imports
    server/      Hono app, Node entry, CLI, Workers entry
    msw/         MSW handler factory over core (M1b)
  apps/
    site/        landing page, URL builder, docs (React + Vite, static)
  examples/      React + query client, plain fetch, later SSR
  scripts/       fixture generation and manifest checks
  docs/          planning and decisions
```

The engine owns domain behavior and scenario evaluation. Inject clock, randomness, state store and scheduling dependencies. HTTP and MSW translate requests into the engine's contract and translate supported outcomes back; GraphQL invokes the same domain operations. Node-only storage, sockets and management stay outside browser bundles.

Recommended choices are Node 24 LTS, the current compatible stable TypeScript, stable Hono, Zod, GraphQL Yoga, Vitest, MSW, Playwright, Faker at fixture-generation time, and React/Vite for the site. The [technical decisions](TECHNICAL-DECISIONS.md) record current researched releases, prereleases to avoid, and compatibility issues such as TypeScript 7's compiler API transition. Nothing is installed or pinned in this planning task.

Use one authored source for built-in contracts and generate types/schema documentation where supported. Separate business rules from structural validation. JSON Schema import later can use Ajv with an explicitly supported dialect; do not pretend arbitrary refinements or transforms automatically survive schema conversion.

OpenAPI 3.2.1 is the current published specification checked for this plan. During M0, test the selected generator, UI, validators and client code generation against it. If the needed tools require 3.1.x, explicitly publish the compatible 3.1 dialect and a migration decision rather than silently claiming latest support. Pin package manager, dependencies and toolchain in the future manifest/lockfile. [OpenAPI 3.2.1](https://spec.openapis.org/oas/v3.2.1.html), [JSON Schema dialect](https://json-schema.org/specification).

### Is a database required?

**No external database is required for M1.** Bundled fixtures and a scoped in-memory store support public demos, local CRUD and isolated tests. Document that memory state disappears on process restart. A future persistence option should mean actual durable storage, not simply enabling mutation.

Add SQLite only when restart persistence is a real requirement, with migrations, backup/restore and one clear supported topology. Multi-instance hosted runs require coordinated storage and atomic operations; Cloudflare Durable Objects or a conventional database can be evaluated then. Do not add Redis, PostgreSQL, queues and Kubernetes merely to appear production-ready. Do not use eventually consistent KV for exact sequence counters or transactional read-after-write state.

## 10. Developer experience

The homepage should start with a copyable request and three paths: try the hosted demo, run locally, use in tests. Show the current mode, persistence semantics and limits next to the example.

Milestone split: M1a ships the landing page, the minimal URL builder, the hosted and `npx` quick starts, OpenAPI and resource types. M1b adds the MSW and E2E quick starts, the scenario gallery and the first React example. The rest follows in M2 and M3.

The playground should let a developer select a resource, query, fixture pack and named scenario, then inspect the response, elapsed time and safe applied-rule explanation. Include cancellation and retry controls. Share URLs containing only public configuration. A request inspector should redact sensitive values before display and export.

Provide these first-party guides and artifacts:

- A short hosted quick start, a local Node quick start, and Docker instructions tested on Windows, macOS and Linux.
- A TypeScript test quick start using an isolated engine/MSW factory, and a browser E2E example using a local server.
- Generated OpenAPI, resource types, request examples, and later GraphQL SDL and collections.
- A scenario gallery with expected UI behavior and the relevant catalog IDs, including loading, empty, validation, retry, race, rollback and broken image.
- One maintained React/query-client example first, a plain fetch example, and an SSR example sharing run state between server and browser.
- Storybook recipes; Vue, Angular, Svelte, SWR and additional GraphQL clients as focused later examples rather than an initial maintenance matrix of every combination.
- A compatibility page: supported Node versions, browsers, adapters, protocols, package formats, offline behavior and known limitations.
- Troubleshooting for preflight, unexpected public requests, service-worker scope, proxy buffering, frozen clocks, expired runs and confusing fake-write behavior.

Use a thin typed test-control client where it simplifies lifecycle; developers should still be able to use ordinary fetch for data. An optional `llms.txt` can supplement authoritative human and machine-readable contracts, not replace them.

## 11. Testing and quality strategy

All checks below are future implementation requirements. There are no application tests to run in the current workspace. M1a needs the engine unit, contract, packaging and deployment rows; M1b adds the state/concurrency, invariant, adapter parity, HTTP integration and security rows; real-browser coverage grows with the scenario gallery.

| Layer | Required evidence |
|---|---|
| Engine unit tests | Typed query parsing, filtering/sorting/projection, all pagination boundaries, scenario precedence, sequence exhaustion, business-clock behavior |
| State and concurrency | Parallel run isolation, CRUD read-after-write, atomic conflict behavior, cancelled writes, reset with in-flight work, bounded cleanup |
| Invariant tests | Stable pagination without gaps in immutable data, cursor/query binding, referential integrity, fixture reproducibility, no cross-run mutation |
| Contract tests | Generated schemas/specifications validated; ordinary responses conform; fault fixtures intentionally fail only their declared contracts |
| Adapter parity | Equivalent scenario input produces equivalent supported domain results across in-process, Node HTTP and MSW; GraphQL parity added in M2 |
| Actual HTTP integration | Headers, status/body rules, multipart limits, disconnect cleanup, stream flushing, backpressure and proxy behavior |
| Real-browser tests | Loading/error UI, CORS/preflight, cookies, browser cache, images, abort behavior, SSR/hydration and service-worker boundaries |
| Security tests | Cross-run access denial, management separation, redaction, unsafe SVG/import rejection, rate/size limits, malicious control inputs |
| Packaging and usability | Packed CLI/package smoke tests, type imports, Docker startup/shutdown, clean-machine quick starts, graceful exit and port conflicts |
| Deployment validation | Hosted adapter's measured latency/CPU/memory/concurrency, enforced limits, stream behavior, health, rollback and observability |

Every bug fix requires a regression test that fails before the fix. Use fake time for engine logic and bounded real-time checks for transport; avoid arbitrary sleeps as the main synchronization technique. Preserve normal schema and security validation even when the product intentionally generates fault fixtures.

CI should eventually run formatting/lint, type checking, relevant tests, contract generation/drift checks, packaging and dependency/security checks. Use a documented minimum/current supported Node matrix, Windows/Linux smoke coverage, and browser coverage for actual supported browser behavior. Make failed and skipped suites visible; a skipped capability suite is not evidence of parity.

Application CI must use pinned local fixtures and never require the shared public service. External availability probes are a separate operational check. Browser MSW and Playwright routing need a declared interception owner; run actual browser cache/cookie/CORS suites against HTTP without interception that changes the behavior under test. [Playwright network guidance](https://playwright.dev/docs/network).

Publishing npm packages/images, deploying hosted builds, changing DNS and enabling automatic production releases are later operational actions requiring explicit authorization. The plan does not authorize them now.

## 12. Hosting, safety and operations

Default split: Cloudflare Workers hosts the stateless public demo and the static site; Node/Docker is the reference runtime for everything stateful, local or self-hosted. M0 measures the Workers adapter with representative queries, errors, SVG generation and delays; if it cannot meet the limits reliably, the fallback is a small Node host such as a $5–7 per month VM. AWS Lambda behind CloudFront is a cost-comparable alternative if AWS experience becomes a portfolio goal; see [Technical decisions, section 7](TECHNICAL-DECISIONS.md#7-hosting-limits-and-cost).

Use the current official provider terms and benchmark results before estimating costs. The [technical decisions](TECHNICAL-DECISIONS.md) compare deployment choices and correct the draft's outdated bundle/rate limits and blanket cache-cost assumptions. Do not promise free hosting indefinitely, or assume billing alerts enforce a hard spending cap.

### Proposed public limits to validate

These are product starting points, not claims about a provider's limits:

| Dimension | Initial target |
|---|---|
| List results | Default 20, maximum 100 records per page |
| Delay | Up to 10 seconds before headers; bounded total request lifetime |
| Streams | Up to 60 seconds in M2, with separate byte/event/concurrency caps |
| Normal request body | 256 KiB; upload endpoints get a separately measured limit |
| Uploads | Metadata-only public processing; initial M2 candidate cap 5 MiB, without retention |
| Response size | 1 MiB normal JSON ceiling; dedicated bounded download routes |
| SVG size | 10–2000 logical pixels per dimension, short escaped labels, bounded output bytes |
| Expansions | Depth one for M1; bounded related rows and total output |
| Local runs | Explicit configurable count/record/journal caps and idle expiry; no unbounded defaults |

Configure request-rate and concurrent-work limits separately. A ten-second delay consumes little CPU but can hold a connection and memory. Bound timers, open streams, upload bytes, graph complexity and queued work. Use provider-aware admission control rather than trusting an arbitrary forwarded IP header. Keep genuine host throttling distinguishable from simulated 429 scenarios.

The public instance must not run arbitrary user JavaScript, fetch arbitrary proxy/image/import URLs, send arbitrary webhooks, or render user-supplied executable SVG/HTML. These are feature-specific abuse boundaries. Local imports and future private forwarding require explicit paths/targets, validation and redaction. Webhook testing should start with an inspectable local outbox or allowlisted destination.

Management is separate from mock data routes; the binding, credential and ownership rules are in [Technical decisions, section 6](TECHNICAL-DECISIONS.md#6-security-boundaries). Mock roles and tokens cannot bypass those checks or server limits.

Use structured logs with body logging off by default, redacted errors, version/build identifiers, and bounded retention. Measure genuine server faults separately from deliberately simulated failures. Track CPU/memory, active runs, delayed requests, open streams, dropped requests and cleanup failures without high-cardinality labels containing secrets or full user URLs. Add readiness/liveness, graceful shutdown, and documented backup/restore only where durable storage exists.

## 13. Delivery roadmap and acceptance gates

The catalog intentionally exceeds the first release. Stage work by completed developer journeys; do not implement all 134 scenarios before making the core useful. Estimates below are broad planning ranges in focused engineering weeks for one experienced maintainer, exclude waiting/rework, and must be revised after M0. At an assumed evenings-and-weekends pace of 10–15 hours a week, calendar time is roughly three times longer.

| Stage | Work packages | Exit evidence | Indicative effort |
|---|---|---|---|
| **M0: decisions and spikes** | Initialize the repository and CI; finalize mode/query/scenario contracts and the two parked control-syntax decisions in section 15; check name/license; resolve the compatible stack including the TypeScript line; spike the shared engine on Node + MSW, Workers adapter limits, schema generation | Recorded decisions; measured adapter limits; a health endpoint and one resource list live on a public workers.dev URL; risk list updated | 1 week |
| **M1a: public demo** | Fixture manifest and four data packs, shared validation, query/pagination, stateless validated writes, delay/status/scenario/body controls, SVG images, Problem Details, OpenAPI and `/capabilities`, `npx` server, landing page with URL builder, public limits, Workers deployment | A new developer completes the hosted and local quick starts from the README; fixtures stable; cursor rules covered; public limits enforced | 3–5 weeks |
| **M1b: local stateful core** | In-memory run per engine instance, real CRUD, scoped reset, deterministic step sequences, MSW factory, strict unhandled-request mode, local E2E harness, Docker image, M1-core scenario examples | The component, E2E and race acceptance examples below pass; the same scenario runs offline in a component test and a local HTTP E2E test; no cross-run effects | 2–4 weeks |
| **M2a: test infrastructure** | Business clock, journal and assertions, HTTP control API, reset generations and in-flight semantics, checkpoints, cursor revision binding, diagnostic bundles, applied-rule inspector | Reset during in-flight work proven; journal redaction tested; checkpoint restore round-trips | 2–4 weeks |
| **M2b: application workflows** | Stateful auth, refresh/logout, concurrency/idempotency, conditional requests, async jobs, additional domain packs | Expiry/refresh race, conflict, lost acknowledgement and reconciliation examples pass deterministically | 3–5 weeks |
| **M2c: protocols and stable v1** | GraphQL/SDL/GraphiQL, files/downloads, SSE/NDJSON, cache/cookie recipes, parity and upgrade docs | REST/GraphQL contract parity; actual browser/stream validation; complete supported-feature matrix; v1 contracts reviewed | 4–7 weeks |
| **M3: targeted expansion** | Custom schema imports, durable storage, WebSockets, advanced media, private hosted runs, integrations | A separate proposal, demand signal and acceptance suite for each extension | Estimate per selected feature |

Under these assumptions the first public release (M0–M1a) is roughly 4–6 focused weeks, the testing core (M0–M1b) 6–10, and stable v1 (M0–M2) 15–26. A portfolio-first stop after M1a is a complete, honest product: a public stateless demo with local `npx` use, with the stateful testing features documented as roadmap rather than promised.

### Release acceptance examples

- **M0 public:** open the workers.dev URL, read `/healthz` and one resource list, and see the CI badge green on the repository.
- **M1a public:** copy a products URL, select cursor pagination and a slow/error/empty scenario, inspect a coherent response and clear limits.
- **M1b component:** create fresh MSW-backed state, show a skeleton, fail two selected requests, recover, and confirm no unexpected request escaped strict mode.
- **M1b E2E:** create/edit/delete a post, refetch the actual state, run two tests concurrently, and reset one without affecting the other.
- **M1b race:** issue two searches, release their responses in reverse order, verify that the app retains the newest results, and reproduce the same outcome offline.
- **M2 session:** expire a synthetic session, trigger concurrent requests, exercise refresh success/failure/logout, and verify client behavior without real credentials.
- **M2 protocol:** serve partial GraphQL data and an interrupted/resumed SSE stream; verify both domain state and actual client behavior.

A feature is done when implementation, tests, documentation, capability labels, limits and an example agree. If an adapter cannot support a scenario, return a clear unsupported-capability diagnostic and document the alternative.

## 14. Maintenance, code style, portfolio and extensions

Recommend **MIT** for straightforward reuse, subject to the owner's decision; Apache-2.0 is an alternative if an explicit patent grant is preferred. Verify licenses for dependencies, datasets, photos, fonts and avatar styles independently. Open-source distribution must include everything required for local core operation.

Before a stable release, add contribution/setup guidance, security reporting instructions, a code of conduct if community participation grows, changelog and release/versioning policies. Version the API, dataset packs and scenario format explicitly. Treat a fixture change that breaks consumer snapshots as a compatibility decision, even if TypeScript types remain unchanged.

Keep maintenance proportional: small coherent changes, concise explanatory comments, strict types, one lint/format setup, automated dependency proposals with human review, and regression tests for bugs. Do not maintain multiple runtimes or framework examples without a runnable compatibility check.

### Code style

The code should read as if one careful person wrote it. This was an explicit requirement in the original brief.

- Comments only where the reason is not obvious from the code, one short line, for example `// stable order: id breaks ties`. No JSDoc on every function, no banner comments, no comments that repeat the code.
- Small files, plain names, early returns. No classes, factories or abstraction layers until a second use needs one.
- One formatter and one lint configuration, chosen in M0, so style never reaches review.
- No dead code. A TODO only with an issue number.
- Small commits that each do one thing, written as the work happens.
- README and design notes in the maintainer's own words.

### Portfolio and launch

The fake-API category is crowded, so the README leads with what is different: loading, error and stateful workflow scenarios that run identically against the hosted demo, a local server and MSW; REST and GraphQL on one engine; honest mode and limit labels.

README checklist: a short GIF of the URL builder; a 30-second quick start for hosted, `npx` and test use; a fair comparison table drawn from [Research](RESEARCH.md); the design decisions from [Technical decisions](TECHNICAL-DECISIONS.md); limits and self-hosting; how it was built.

Launch after M1a: a dev.to article on testing loading and error states without a backend, Show HN, r/reactjs and r/webdev, and a pull request to the public-apis list. Interview talking points: cursor design and stable ordering, the stateless/stateful split, deterministic sequences versus failure rates, the CORS preflight trade-off, working inside the Workers CPU budget, and why the testing core was sequenced after the public demo.

### Useful extensions

High-value M3 additions, selected from demand:

| Extension | Useful developer outcome | Prerequisite |
|---|---|---|
| OpenAPI/JSON Schema import | Mock a team's actual API and validation contract | Explicit supported dialect/features; local refs first; no arbitrary remote fetching |
| Declarative scenario editor | Share custom request matching and response/state sequences | Versioned safe configuration and export/import migration rules |
| HAR/cassette import | Reproduce a captured integration failure | Remove credentials/PII; deterministic normalization; no accidental live replay |
| Webhook inbox/outbox | Test signatures, duplicates, delivery retries and ordering | Isolated state, secret redaction, safe destination policy |
| Advanced job orchestration | Extend M2's basic jobs/visibility delays with multi-stage dependencies, retry queues and compensating actions | Proven M2 clock/scheduler and a concrete consumer workflow |
| WebSockets and subscriptions | Presence, reconnect, message gaps, duplicates, optimistic chat | Adapter-specific backpressure, cleanup and replay tests |
| Specialist packs | Dashboards, calendar/DST, real estate, finance, bookings | Realistic relationships and boundary cases, clearly synthetic data |
| Network-fault recipes | Bandwidth, socket failure, DNS/TLS behavior | Existing proxy/network tools and controlled local infrastructure |
| Contract verification recipes | Check consumers and real providers against shared expectations | A real provider/specification; mocks alone cannot supply this evidence |

## 15. Decisions for the owner

These are optional clarifications for refining the plan, not blockers to documenting the full roadmap.

| Decision | Suggested default | What changes with another choice |
|---|---|---|
| First-release emphasis | Portfolio-first: the M1a public demo ships before the M1b testing core | Balanced or testing-first merges M1a and M1b into one longer first release |
| Hosting budget | Workers free tier plus a domain of roughly $10–12/year; paid Workers at $5/month as fallback | A VM at $5–7/month simplifies stateful self-hosting; AWS Lambda is cost-comparable but has no hard spending cap |
| Pagination mode selection (M0) | Infer the mode from `page` or `cursor` presence, with `pagination=` as an explicit override | Explicit-only is stricter but makes the first cursor request longer to type |
| Control prefix (M0) | `_mock.*` as drafted | A plain `_delay`-style prefix avoids dotted keys that some client libraries nest; decide before the first public URL |
| Public writes | Stateless anonymous demo; stateful local runs immediately | Hosted private CRUD adds credentials, cleanup, storage and abuse-management work |
| GraphQL timing | M2, before stable v1.0 | Requiring GraphQL in the initial preview expands first-release validation and documentation |
| Playground framework | React with a static site build | Angular/Vue are viable; choose the stack you want to maintain and demonstrate |
| License | MIT | Apache-2.0 is a reasonable alternative; choose before distribution |
| Domain focus | General users/content/products first | A specialist pack can make the portfolio more distinctive after the core is reliable |
| Project name | Keep Loadstate provisional; the workspace folder is `mockstate` | Align folder, package, domain and the run-admission header once chosen; verify availability first |

The recommended first implementation task is M0: initialize the repository and CI, put a health endpoint on a public URL, and run the compatibility and lifecycle spike that proves one deterministic stateful scenario across a local HTTP server and an isolated test adapter before committing to the larger feature surface.
