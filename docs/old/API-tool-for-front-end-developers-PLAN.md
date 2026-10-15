# Loadstate: project plan

> **Working name.** A free, open-source fake API for front-end developers. It serves realistic data over REST or GraphQL, and it lets you switch on the states that are hard to reproduce: slow responses, failures, empty lists, rate limits, broken images.

Author: Sergey Velikoretskikh · Status: planning · October 2026

---

## 1. The idea

Much of a front-end's complexity lives in states a working backend rarely shows you: skeletons, spinners, Suspense fallbacks, empty lists, retries, 401 redirects, 429s, broken images, slow uploads. Existing fake APIs are good at returning data and weak at everything else.

Loadstate returns realistic data (users, posts, products, books, orders and more) and lets you control those states from the URL or a header:

```text
?delay=2000   ?status=503   ?scenario=flaky   ?empty=true   ?drip=3000
```

It runs three ways from one codebase:

1. **Public instance:** free, no sign-up, no API key.
2. **Local:** `npx loadstate` starts it on your machine.
3. **Self-hosted:** Docker image, or your own Cloudflare account.

### Quick look

`api.loadstate.example` is a placeholder until the name and domain are chosen.

```text
GET  /v1/users                              list, offset pagination
GET  /v1/users/7                            single record
GET  /v1/users/7/posts                      nested list
GET  /v1/posts?limit=20&cursor=eyJpZCI6MjB9 cursor pagination (infinite scroll)
GET  /v1/products?page=2&perPage=12&sort=-price&q=lamp
GET  /v1/books?delay=1500                   slow response
GET  /v1/orders?scenario=flaky              ~30% of requests fail
POST /v1/posts                              validated, answered, not stored
POST /graphql                               same data over GraphQL
GET  /img/600x400?text=Hero                 SVG placeholder image
GET  /img/avatar/jane-doe?size=96           initials avatar
```

---

## 2. Answers to the two questions

### Is a database required?

**No.**

- **Data you read** is generated once, at build time, by a seed script using Faker with a fixed seed. The output is committed as JSON and loaded into memory. Everyone gets the same data every time, which is what you want for screenshots, Storybook stories and snapshot tests. Faker never ships to the server, which keeps the bundle small and CPU per request low (this matters on Cloudflare's free plan, see section 7).
- **Writes on the public instance** are validated and answered realistically (new `id`, timestamps, merged fields) but not stored. JSONPlaceholder and FakeStoreAPI work the same way. There is no shared state for strangers to vandalize, and Cloudflare's free storage has small write budgets (Workers KV allows 1,000 writes a day).
- **Writes locally:** `npx loadstate --persist` keeps changes in memory until restart. `POST /v1/_reset` restores the seed data.
- **Later, only if people ask:** per-session sandboxes on the public instance (an `X-Session-Id` header, stored in Durable Objects).

### Other outputs besides JSON?

JSON stays the default and the only format for data records. These are worth adding:

| Output | Content-Type | Why |
|---|---|---|
| Images | `image/svg+xml` (v1), PNG and WebP (later) | Placeholders, avatars |
| Error bodies | `application/problem+json` | The standard error format (RFC 9457) |
| Server-Sent Events | `text/event-stream` | Chat-style token streams, live feeds |
| NDJSON | `application/x-ndjson` | Lists streamed row by row |
| CSV (optional) | `text/csv` | Testing "Export" and download buttons |

Skip XML and YAML. Front-end developers rarely need them, and each format doubles the serialization tests.

---

## 3. What already exists (research, October 2026)

| Service | Good at | Gaps Loadstate can fill |
|---|---|---|
| **JSONPlaceholder** | The tutorial default: posts, comments, users, photos, todos; fake writes | No delay or error controls documented; REST only |
| **GraphQLZero** | JSONPlaceholder's data over GraphQL (MIT) | A separate service; same gaps |
| **DummyJSON** | The most complete today: products, carts, recipes, users, posts, comments, todos, quotes; `limit`/`skip`, `select`, sort, search; `delay` from 0 to 5000 ms; login with access and refresh tokens; dynamic images (size, text, colors, formats, fonts, identicons); mock any HTTP status; open source | No GraphQL or cursor pagination in its docs; no failure rate or scenario presets; no streaming |
| **ReqRes** | Long-time tutorial favorite; `delay` (in seconds); login and register fixtures | Its 2025 relaunch put the API behind a free API key; keyless demo use is capped at about 100 requests a day per IP |
| **Platzi Fake Store API** | E-commerce data, REST and GraphQL, pagination, JWT auth, file upload, filters, Postman and Insomnia collections | E-commerce only; no loading or error simulation documented |
| **FakeStoreAPI** | Simple e-commerce REST, fake writes | GraphQL and pagination are still on its own to-do list |
| **json-server v1** | Local REST from your own `db.json`: `_page`/`_per_page`, `_embed`, `_where` | Local only, your own data, still in beta |
| **Mockaroo** | Schema-driven data as CSV, JSON, SQL or Excel | Free tier: 1,000 rows per file, 200 API requests a day |
| **placehold.co** | Images 10 to 4000 px; SVG by default, also PNG, JPEG, GIF, WebP, AVIF; colors, text, fonts, @2x/@3x | Images only |
| **Lorem Picsum** | Real photos; seeded picks; grayscale; blur 1-10 | Photos only; no text or colors |
| **httpstat.us / http-stat.us** | Any status code, sleep, random codes, dribbled bodies | The original was shut down after abuse; the rebuild returns statuses only, no data |
| **MSW, Mockoon, Beeceptor, MockServer** | Mocking your own API (in-browser interception, desktop app, hosted) | You write every response yourself |

### What the original idea was missing

1. **Error and edge-case simulation.** Forced status codes, random failure rate, 401/403/404/429/503 presets, malformed JSON, a CORS failure, a hung request. This is the biggest gap in the market since httpstat.us went down.
2. **An auth flow.** Login, `me`, token refresh, short-lived tokens, protected routes. DummyJSON, Platzi and ReqRes all have one, and login forms and route guards are everyday front-end work.
3. **Query features.** Search (`q`), filters, sort, field selection, relations (`/users/1/posts`) and `expand`.
4. **Validation errors on writes.** `422` with per-field messages, for testing forms.
5. **File upload.** A multipart endpoint that returns file metadata.
6. **Richer images.** Avatars, seeded visual variety, blur placeholders (LQIP), delayed and failing images.
7. **No sign-up, ever.** ReqRes's move to API keys is a gap.
8. **Ready-made docs and collections.** OpenAPI, a GraphQL playground, a Postman or Bruno collection.
9. **The full method set.** GET, POST, PUT, PATCH, DELETE, plus HEAD and OPTIONS. ("Pull" in the idea is read here as PUT.)

### Where Loadstate can beat all of them

- **One place for data, loading, errors and images.** Today a developer combines DummyJSON, placehold.co and a status-code service.
- **Scenario presets:** `?scenario=flaky|slow|ratelimited|unauthorized|maintenance|timeout`.
- **Header equivalents** (`X-Mock-Delay: 2000`), so a whole app can be slowed down from one fetch wrapper, axios interceptor or Apollo link.
- **A slow body** (`?drip=3000`) that sends the response in chunks, for progress bars and streaming parsers.
- **Streaming:** an SSE endpoint that streams a fake AI chat answer token by token, with abort support.
- **Image placeholders that match how apps load images:** every record's image carries `width`, `height`, `color` and `blurDataURL`.
- **The same API offline:** `npx`, Docker, and exported MSW handlers that run the same engine inside tests.
- **Deterministic data** and a versioned API (`/v1`), so tests and screenshots don't change underneath you.
- **`/llms.txt`**, so AI coding assistants can use the API correctly.

---

## 4. v1 specification

### 4.1 Resources

| Resource | Approx. count | Relations | Notable fields |
|---|---|---|---|
| `users` | 100 | posts, todos, comments | avatar, email, address, company, role, status |
| `posts` (alias `articles`) | 500 | author, comments | title, slug, excerpt, body (Markdown), cover, tags, readingTime, publishedAt |
| `comments` | 1,500 | post, user | body, likes |
| `todos` | 300 | user | title, completed, dueDate, priority |
| `products` | 200 | category, reviews | title, price, currency, rating, stock, brand, images[] |
| `reviews` | 800 | product, user | rating (1-5), title, body |
| `customers` | 150 | orders | name, email, company, tier, lifetimeValue |
| `orders` | 600 | customer, items → products | status, total, placedAt |
| `books` | 300 | author | title, isbn, genre, pages, cover, publishedYear |
| `authors` | 80 | books | name, bio, photo |
| `countries` | ~250 | none | code, name, flag, dialCode (for selects and autocomplete) |

Every record has `id` (integer), `createdAt` and `updatedAt` (ISO 8601, UTC). Every image is an object:

```json
{
  "url": "https://api.loadstate.example/img/800x600?seed=p17",
  "width": 800,
  "height": 600,
  "alt": "Walnut desk organizer",
  "color": "#8a5a3c",
  "blurDataURL": "data:image/svg+xml;base64,..."
}
```

Keep the generated JSON under about 1.5 MB so the deployed worker stays far below Cloudflare's 3 MB free limit.

### 4.2 REST

**Routes**

```text
GET     /v1                         resources and counts
GET     /v1/:resource               list
GET     /v1/:resource/:id           single record
GET     /v1/:resource/:id/:related  nested list, e.g. /v1/users/7/posts
POST    /v1/:resource               create (validated, echoed back, not stored)
PUT     /v1/:resource/:id           replace
PATCH   /v1/:resource/:id           partial update
DELETE  /v1/:resource/:id           delete (returns 204)
HEAD, OPTIONS                       handled for every route
```

**List query parameters**

| Param | Example | Notes |
|---|---|---|
| `limit`, `offset` | `limit=10&offset=20` | Default mode; `limit` max 100, default 10 |
| `page`, `perPage` | `page=3&perPage=10` | Page mode |
| `cursor`, `limit` | `cursor=eyJpZCI6MjB9&limit=20` | Cursor mode; start with no cursor |
| `q` | `q=lamp` | Full-text over the resource's text fields |
| field filters | `userId=1&status=active` | Exact match |
| range filters | `price_gte=10&price_lte=50` | `_gte`, `_lte`, `_gt`, `_lt`, `_ne` |
| `sort` | `sort=-createdAt,title` | `-` means descending |
| `fields` | `fields=id,title,price` | Sparse fields |
| `expand` | `expand=author,comments` | Inline related records |
| `envelope` | `envelope=false` | Bare array; totals move to headers |
| `withTotal` | `withTotal=true` | Adds `total` in cursor mode |

**Pagination rules**

- One mode per request. Mixing modes returns `400`.
- Ordering is always stable: `id` breaks ties in any sort.
- A cursor is opaque: base64url of the last row's sort value and `id`. Clients must not build cursors themselves.
- Every mode returns `hasMore`. Offset and page modes also return totals. Cursor mode returns `total` only when asked, as many real cursor APIs do.

```http
GET /v1/products?limit=2&offset=0&sort=-price&fields=id,title,price
```

```json
{
  "data": [
    { "id": 17, "title": "Walnut Desk Organizer", "price": 89.99 },
    { "id": 4, "title": "Linen Throw Pillow", "price": 79.5 }
  ],
  "meta": { "total": 200, "limit": 2, "offset": 0, "hasMore": true }
}
```

```http
GET /v1/posts?limit=20&cursor=eyJpZCI6MjB9
```

```json
{
  "data": ["...20 posts..."],
  "meta": { "limit": 20, "nextCursor": "eyJpZCI6NDB9", "prevCursor": "eyJpZCI6MjF9", "hasMore": true }
}
```

Single records come back bare (`GET /v1/users/7` returns the user object).

**Response headers:** `X-Total-Count` (offset and page modes), `Link` (`next`, `prev`, `first`, `last`), `ETag` (and `304` on `If-None-Match`), `X-Mock-Applied` (which simulations ran on this response).

**Writes:** bodies are validated with the same schemas that describe the data. A valid body returns the record as it would look if saved (`201` for POST with a new `id` and timestamps, `200` for PUT and PATCH). Nothing is stored on the public instance.

**Errors** use `application/problem+json`:

```json
{
  "type": "https://loadstate.example/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "2 fields are invalid",
  "errors": { "email": "Must be a valid email", "name": "Required" }
}
```

### 4.3 Simulation controls

Each control works as a query parameter and as a header. The query parameter wins if both are set. Controls apply to REST, GraphQL and images.

| Param | Header | Example | Effect |
|---|---|---|---|
| `delay` | `X-Mock-Delay` | `1500`, `300-1200`, `random` | Wait before responding; ranges pick a random value; max 10 s |
| `status` | `X-Mock-Status` | `503` | Respond with that status and a problem+json body |
| `fail` | `X-Mock-Fail` | `0.3` | Fail that share of requests (500 by default, or `failStatus`) |
| `scenario` | `X-Mock-Scenario` | `flaky` | A preset (below) |
| `empty` | `X-Mock-Empty` | `true` | Lists come back empty |
| `drip` | `X-Mock-Drip` | `3000` | Stream the body in chunks over that many ms |
| `malformed` | none | `true` | `200` with invalid JSON, to test parse errors |
| `cors` | none | `block` | No CORS headers, so the browser throws a network error |
| `cache` | none | `60` | `Cache-Control: max-age=60`, for testing SWR and TanStack Query |
| `auth` | `X-Mock-Auth` | `required` | Requires a valid bearer token (v1.1) |

**Scenarios**

| Name | Behavior |
|---|---|
| `slow` | 1.5-3 s delay |
| `flaky` | 200-800 ms delay; about 30% fail with 500 or 503 |
| `empty` | Empty lists, 404 for single records |
| `error` | 500 |
| `unauthorized` / `forbidden` / `notfound` | 401 / 403 / 404 |
| `ratelimited` | 429 with `Retry-After: 5` |
| `maintenance` | 503 with `Retry-After: 60` |
| `timeout` | Waits the maximum delay, then 504 |
| `partial` | GraphQL only: some fields `null` plus an `errors` array |

Note for the docs: custom request headers make browsers send a CORS preflight. Query parameters avoid it, headers are easier to set globally. Document both and allow `X-Mock-*` in `Access-Control-Allow-Headers`. Expose `X-Total-Count`, `Link`, `Retry-After`, `ETag` and `X-Mock-Applied` through `Access-Control-Expose-Headers`.

### 4.4 GraphQL

`POST /graphql`, with GraphiQL on `GET /graphql` in a browser and the SDL at `/graphql/schema.graphql` for codegen. Resolvers call the same query engine as REST.

```graphql
type Query {
  user(id: ID!): User
  users(first: Int, after: String, last: Int, before: String,
        filter: UserFilter, orderBy: [UserOrder!]): UserConnection!   # cursor (Relay style)
  usersPage(page: Int = 1, perPage: Int = 10,
            filter: UserFilter, orderBy: [UserOrder!]): UserPage!     # page/offset
  # the same three fields for every resource
}

type UserConnection { edges: [UserEdge!]! pageInfo: PageInfo! totalCount: Int! }
type UserPage { items: [User!]! total: Int! page: Int! perPage: Int! pages: Int! }

type Mutation {
  createPost(input: PostInput!): Post!
  updatePost(id: ID!, input: PostPatch!): Post!
  deletePost(id: ID!): ID!
  # the same for every writable resource
}
```

- Relations resolve as fields (`post { author { name } comments(first: 5) { ... } }`).
- Validation errors go in `errors[].extensions.fields`.
- Simulation uses the same `X-Mock-*` headers. `X-Mock-Status` produces an HTTP error; `scenario=partial` returns data with some fields `null` plus an `errors` array, which is how real GraphQL servers fail.

### 4.5 Images

| URL | Result |
|---|---|
| `/img/600x400` | 600×400 SVG with the size as text |
| `/img/600` | Square |
| `/img/600x400?text=Hero&bg=0f172a&fg=e2e8f0` | Custom text and colors |
| `/img/600x400?style=gradient&seed=42` | Seeded gradient or geometric art (`plain`, `gradient`, `pattern`) so product grids don't look like gray boxes |
| `/img/avatar/jane-doe?size=96` | Initials avatar; `style=identicon` for a pattern |
| `/img/600x400?delay=2000` | Slow image, for lazy loading and `loading="lazy"` tests |
| `/img/600x400?fail=true` | 404, for testing `onError` fallbacks |

Sizes from 10 to 4000 px. Responses carry long-lived cache headers and are cached at the edge. PNG and WebP (and `@2x`) come later through a WASM renderer.

### 4.6 Utility endpoints

| Endpoint | Purpose |
|---|---|
| `ANY /v1/echo` | Returns method, path, query, headers (filtered) and parsed body (JSON, text, form fields, file metadata). For checking what your fetch code really sends |
| `GET /v1/status/:code` | Any status code with a matching body |
| `GET /v1/health` | Health check |
| `GET /openapi.json`, `/docs` | OpenAPI 3.1 and its UI |
| `GET /llms.txt` | Plain-text API description for AI assistants |

### 4.7 Limits on the public instance

- `delay` up to 10 s, `limit`/`perPage` up to 100, images up to 4000 px, streams up to 60 s, uploads up to 10 MB (v1.1).
- Per-IP rate limit through Cloudflare's rate-limiting binding or a WAF rule. A real 429 says "self-host for heavy use" and links to the README.
- The free plan's daily cap is a hard ceiling, so there is no surprise bill. Document it, and point heavy users to `npx` and Docker.

httpstat.us is a warning here: it went offline because of abuse. Caps and rate limits go in from day one.

---

## 5. Developer experience

- **Landing page:** one URL to copy, a "try it" button, and the three ways to run it.
- **Playground (URL builder):** pick a resource, a pagination mode and a scenario; see the URL, a live response with timing, and a code snippet for fetch, axios, TanStack Query, SWR, Apollo, Angular `HttpClient` or Vue.
- **Demo gallery:** small live examples built on the API: skeleton list, infinite scroll, Suspense streaming with three different delays, optimistic update with rollback on `fail=1`, error boundary with retry, images with blur placeholders. This doubles as a front-end showcase.
- **Docs:** OpenAPI UI at `/docs`, GraphiQL at `/graphql`, a Postman or Bruno collection generated from OpenAPI.
- **Types:** the npm package exports TypeScript types for every resource (`import type { Post } from "loadstate"`), and the GraphQL SDL supports codegen.
- **Run it locally:** `npx loadstate` (flags: `--port`, `--persist`, `--delay`, `--cors-origin`).
- **Docker:** `docker run -p 4000:4000 ghcr.io/veliksergey/loadstate`.
- **Self-host on Cloudflare:** clone, `pnpm deploy`.
- **`examples/` folder:** React + TanStack Query (infinite scroll), Next.js (Suspense streaming), Angular (signals + `HttpClient`), Vue.

---

## 6. Architecture and stack

| Piece | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language for server, types package, playground |
| HTTP framework | **Hono** | The same app runs on Cloudflare Workers, Node.js, Bun, Deno and AWS Lambda; built on Web standard `Request`/`Response` |
| GraphQL | **graphql-yoga** | Runs on Workers and edge runtimes; mounts inside Hono |
| Schemas | **Zod** | One definition gives validation, TS types and OpenAPI (`@hono/zod-openapi`) |
| Fake data | **@faker-js/faker** | Build time only, fixed seed |
| Tests | Vitest; Playwright for the playground | |
| Public hosting | Cloudflare Workers + static assets | Free tier, hard cap, global edge |
| Local / self-host | `@hono/node-server`, Docker | Same app |
| Playground and docs site | React + Vite, served as static assets | Your strongest front-end stack |
| Package manager | pnpm | |

```text
loadstate/
  scripts/seed.ts        builds src/data/*.json from Faker (fixed seed)
  src/
    data/                generated JSON, committed
    models/              zod schemas + types, one file per resource
    core/                query engine: filter, sort, paginate, cursor, expand, fields
    sim/                 delay, failures, scenarios, drip (middleware)
    rest/                hono routes
    graphql/             SDL + resolvers (call core/)
    img/                 svg placeholders, avatars, blur placeholders
    app.ts               builds the Hono app
    worker.ts            Cloudflare entry
    node.ts              Node entry + CLI
  site/                  playground and docs (React + Vite)
  examples/
  test/
```

### Design decisions (each becomes a short note in the README)

1. **Data is generated at build time and committed.** Deterministic, fast, no Faker at runtime, fits a 10 ms CPU budget.
2. **REST and GraphQL share one query engine.** Parity tests prove both return the same records for the same query.
3. **Writes are stateless on the public instance.** No vandalism, no storage costs; `--persist` locally.
4. **Simulation through query parameters and headers.** Parameters avoid preflights; headers allow global configuration.
5. **Opaque cursors with a stable tie-break.** Clients can't depend on cursor internals; sorting never skips or repeats rows.
6. **RFC 9457 error bodies** everywhere, including simulated errors.
7. **SVG-first images.** Cheap to render on the edge; raster formats later, behind a cache.
8. **One app, three runtimes.** Workers for the free public instance, Node for `npx`, Docker for everyone else.

---

## 7. Hosting and domain

| Option | Cost | Notes |
|---|---|---|
| `loadstate.<account>.workers.dev` | Free | Fine to start with |
| `loadstate.is-a.dev` | Free | Community subdomain service; you open a pull request yourself (they reject AI-written requests); dev projects only |
| Your own `.com` at Cloudflare Registrar | ≈ $10.44/yr | Sold at cost; renewal is the same price |
| Your own `.dev` at Cloudflare Registrar | ≈ $12.20/yr | Same |

**Cloudflare Workers free plan:** 100,000 requests a day (resets at midnight UTC), a burst limit of 1,000 requests a minute, 10 ms of CPU per request, and a 3 MB worker. Waiting does not count as CPU time, so `delay` is cheap. Static assets (the docs site) are free and unlimited. Cached responses, such as repeated image requests, don't use CPU.

**Total running cost: $0 to about $12 a year.**

Risks to watch:

- **GraphQL CPU.** Parsing and validating queries costs CPU. Measure in Workers logs; if requests approach 10 ms, cache parsed documents or move to the paid Workers plan.
- **Popularity.** If the public instance outgrows 100,000 requests a day, the cap protects the bill; the README points heavy users to self-hosting.
- **AWS (optional).** Hono also runs on Lambda, so a "Deploy to AWS" guide can show AWS skills. Keep the public instance on Workers: Lambda bills for wall time, including every second of a simulated delay. Set a billing alarm on day one.

---

## 8. Testing and CI

- **Unit:** query engine (filters, sort, all three pagination modes, cursor round trips, edge cases like the last page), delay parsing, scenario selection.
- **Integration:** every route through Hono's `app.request()`, no network needed.
- **Parity:** the same query over REST and GraphQL returns the same IDs in the same order.
- **Contract:** every response parses with its Zod schema; the OpenAPI document is validated.
- **Seed check:** fixed counts and a hash of the generated data, so a dependency bump can't silently change it.
- **E2E:** a Playwright smoke test of the playground.
- **GitHub Actions:** lint, typecheck and test on every pull request; deploy `main` to Workers; publish to npm and push the Docker image on a version tag; status badge in the README.

---

## 9. Code style

The code should read like one careful person wrote it.

- Comments only where the reason isn't obvious from the code. One short line, e.g. `// stable order: id breaks ties`. No JSDoc on every function, no banner or section comments, no comments that repeat the code.
- Small files and plain names. Early returns. No classes, factories or abstraction layers until a second use needs one.
- Prettier and ESLint (or Biome) for formatting, so style debates never reach code review.
- No dead code. A TODO only with an issue number.
- Small commits that each do one thing, with clear messages, as the work actually happens.
- README and design notes in your own words.

---

## 10. Milestones

Estimates assume evenings and weekends.

| # | Milestone | Done when | Estimate |
|---|---|---|---|
| 0 | Skeleton | Repo, TS, lint, Vitest, CI; Hono app on Workers and Node; `/v1/health` live on workers.dev | 1 evening |
| 1 | Data | Seed script, 11 resources, relations, image objects; size under budget | 1 weekend |
| 2 | REST reads | Lists, single records, nested routes; 3 pagination modes; `q`, filters, sort, `fields`, `expand`; headers | 1 weekend |
| 3 | REST writes and errors | POST/PUT/PATCH/DELETE with validation; problem+json; `echo`, `status` | 1 weekend |
| 4 | Simulation | `delay`, `status`, `fail`, scenarios, headers, `drip`, `malformed`, `cors`, ETag, 429 | 1 weekend |
| 5 | Images | SVG placeholders, styles, avatars, blur placeholders, `delay`/`fail`, edge caching | 1 weekend |
| — | **Public v0.1** | README, limits, rate limiting, `npx` | **about 5 weekends in** |
| 6 | GraphQL | Schema, connections, page queries, mutations, GraphiQL, parity tests | 1 weekend |
| 7 | Docs and playground | OpenAPI UI, landing page, URL builder, snippets, demo gallery | 1-2 weekends |
| 8 | v1.0 | Docker image, domain, `llms.txt`, Postman/Bruno collection, tagged release, launch posts | 1 weekend |

### v1.1 (next, high value)

- **Auth:** `POST /v1/auth/login` (demo users, documented password), `GET /v1/auth/me`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`; `?expiresIn=30` for short tokens to test refresh; `auth=required` on any route returns 401 without a valid token. Stateless JWT signed with a secret from the environment.
- **Streaming:** `GET /v1/stream/chat` (SSE, fake AI answer token by token; `speed` and `words` parameters; works with `AbortController`); `GET /v1/:resource.ndjson`.
- **Upload:** `POST /v1/upload` (multipart, returns file metadata, nothing stored).
- **MSW handlers:** `import { handlers } from "loadstate/msw"` runs the same Hono app inside Mock Service Worker, for offline tests.
- **Local persistence:** `--persist` and `POST /v1/_reset`.

### Later

- PNG/WebP images and `@2x`
- GraphQL `@defer` and `@stream` (Yoga plugin) for testing incremental delivery in Apollo and Relay
- A lazy-module endpoint (`/v1/module.js?delay=2000&fail=0.2`) for testing `React.lazy`, chunk load errors and error boundaries
- Bring your own data: load a `db.json` the way json-server does, with all the simulation features on top
- More resources: messages and conversations (chat UIs), notifications, calendar events, files
- Locales for generated data
- WebSocket live updates
- Per-session sandboxes on the public instance

---

## 11. Portfolio angle

The fake-API category is crowded. A plain JSONPlaceholder clone reads as a template project, so the README has to lead with what is different: loading and error states, REST and GraphQL on one engine, and one app on three runtimes.

**What it shows a reviewer:** API design (pagination, errors, versioning), TypeScript, Node.js, GraphQL, edge deployment, testing discipline (parity and contract tests), and front-end craft (the playground and demo gallery).

**README checklist**

- A short GIF of the playground at the top
- A 30-second quick start for all three ways to run it
- A fair comparison table with the alternatives
- The design decisions from section 6
- Limits and how to self-host
- How it was built

**Launch:** a dev.to article ("Testing loading and error states without a backend"), Show HN, r/reactjs and r/webdev, and a pull request to the public-apis list. npm downloads and GitHub issues from strangers are evidence that can't be faked.

**Interview talking points:** cursor design and stable ordering, working inside a 10 ms CPU budget, why writes are stateless, the CORS preflight trade-off, and the abuse lesson from httpstat.us.

---

## 12. Open questions

1. **Name and domain.** These names are free on npm today: `loadstate`, `lagbox`, `mockfront`, `fakefront`. Free subdomain, or about $10-12 a year for your own?
2. **Stateless writes** on the public instance: acceptable for v1?
3. **Resources:** is the list in 4.1 right? Real-estate resources (`properties`, `leases`, `loans`) would be unusual among fake APIs and close to what you know.
4. **Hosting:** Cloudflare Workers for the public instance, or AWS to cover the AWS gap?
5. **Playground framework:** React, or Angular to show current Angular?
6. **Auth and streaming:** in v1.0 or v1.1?

---

## Sources

Checked October 13, 2026.

- [DummyJSON docs](https://dummyjson.com/docs)
- [ReqRes llm.txt](https://reqres.in/llm.txt), [ReqRes API docs](https://reqres.in/api-docs), [API Evangelist profile of ReqRes](https://github.com/api-evangelist/reqres)
- [ReqRes blog: JSONPlaceholder alternatives](https://reqres.in/blog/jsonplaceholder-alternatives)
- [Platzi Fake Store API](https://fakeapi.platzi.com/en/about/introduction/)
- [FakeStoreAPI on GitHub](https://github.com/keikaavousi/fake-store-api)
- [GraphQLZero on AlternativeTo](https://alternativeto.net/software/graphqlzero/about)
- [json-server](https://github.com/typicode/json-server)
- [freetier.co: JSONPlaceholder alternatives](https://freetier.co/alternatives/jsonplaceholder) (Mockaroo and mockapi.io limits)
- [TestSprite: JSONPlaceholder tools 2026](https://www.testsprite.com/use-cases/en/the-best-jsonplaceholder-tools) (Mockoon, Beeceptor, MockServer)
- [placehold.co](https://placehold.co)
- [Lorem Picsum](https://picsum.photos/)
- [http-stat.us rebuild](https://github.com/stephenl03/http-status); [commit noting httpstat.us was shut down due to abuse](https://github.com/blog2i2j/arduino.._..arduino-lint/commit/2a310915698f83d629a3d41307b773191dc258a5)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Cloudflare plans](https://www.cloudflare.com/plans.md)
- [Cloudflare Registrar](https://domains.cloudflare.com/), [.com price review](https://startupowl.com/reviews/cloudflare-registrar), [.dev pricing](https://domainoffer.net/tld/dev/cloudflare)
- [is-a.dev](https://github.com/is-a-dev/register)
- [Hono](https://github.com/yusukebe/hono), [Hono runtimes (dev.to)](https://dev.to/0012303/hono-has-a-free-web-framework-that-runs-on-every-javascript-runtime-2idi)
- [GraphQL Yoga on Cloudflare Workers](https://the-guild.dev/graphql/yoga-server/docs/integrations/integration-with-cloudflare-workers), [Yoga vs Apollo Server 2026](https://www.pkgpulse.com/guides/graphql-yoga-vs-apollo-server-vs-mercurius-graphql-2026)
- [Faker docs](https://fakerjs.dev/api/faker)
