# API spec: M1 surface

Planning document, 2026-10-15. This is the concrete M1 contract proposed for M0 review, restored from section 4 of the [original draft](old/API-tool-for-front-end-developers-PLAN.md) and made consistent with [PROJECT-PLAN.md](PROJECT-PLAN.md). Nothing here exists yet. Precedence, cursor binding, caching and security rules live in the plan and in [TECHNICAL-DECISIONS.md](TECHNICAL-DECISIONS.md); this document shows what a developer sees. Field names, recipe names and flags are proposals. Two syntax questions, pagination mode selection and the control prefix, are open M0 decisions in the plan, section 15.

`api.loadstate.example` is a placeholder until the name and domain are chosen.

## Quick look

```text
GET  /v1/users                                       list, offset pagination (default)
GET  /v1/users/7                                     single record, bare object
GET  /v1/users/7/posts                               nested list, same query rules
GET  /v1/posts?pagination=cursor&limit=20            first cursor page; the next page adds cursor=...
GET  /v1/products?pagination=page&page=2&perPage=12&sort=-priceMinor&q=lamp
GET  /v1/products?status=active&priceMinor_gte=1000&fields=id,title,priceMinor,currency
GET  /v1/todos?_mock.delay=1500                      slow response
GET  /v1/products?_mock.scenario=maintenance         503 with Retry-After
GET  /v1/users/7?_mock.status=404                    forced status with a Problem Details body
POST /v1/posts                                       validated; stored only in a stateful run
GET  /img/600x400?text=Hero                          SVG placeholder
GET  /img/avatar/jane-doe?size=96                    initials avatar
```

## Resources (M1a packs)

Counts are fixture-manifest metadata, not promises; the initial targets are tens of users and categories and hundreds of posts, comments, products and todos. Every record has an integer `id` and UTC ISO 8601 `createdAt` and `updatedAt`. Date-only fields are `YYYY-MM-DD` strings. Money is an integer in minor units plus an ISO 4217 `currency`; this differs from familiar sample APIs on purpose, so formatting code is exercised instead of string concatenation.

| Resource | Relations | Notable fields |
|---|---|---|
| `users` | `posts`, `comments`, `todos` | `name`, `username`, `email`, `avatar` (image object), `role` (`admin`, `editor`, `viewer`), `status` (`active`, `invited`, `disabled`), `address`, `company`, `locale`, `timezone` |
| `posts` | `author` (user), `comments` | `title`, `slug`, `excerpt`, `body` (Markdown), `cover` (image object), `tags[]`, `readingTimeMinutes`, `status` (`draft`, `published`, `archived`), `publishedAt` (nullable) |
| `comments` | `post`, `user` | `body`, `likes`, `parentId` (nullable, one level) |
| `products` | `category` | `title`, `slug`, `description`, `priceMinor`, `currency`, `rating` (0–5, one decimal), `ratingCount`, `stock` (0 allowed), `brand`, `images[]`, `status` (`active`, `draft`, `discontinued`) |
| `categories` | `products`, `parent` (nullable) | `name`, `slug`, `parentId`, `image` |
| `todos` | `user` | `title`, `completed`, `dueDate` (date-only, nullable), `priority` (`low`, `normal`, `high`) |

Valid edge packs include records with omitted optional fields, explicit nulls, empty strings, zero stock, long text, Unicode and RTL names, duplicate display names, date boundaries and missing optional relations. Fault packs with malformed or invalid records are separately labeled and arrive in M1b.

Every image field is an object. Blur metadata is optional and documented when added.

```json
{
  "url": "https://api.loadstate.example/img/800x600?seed=p17",
  "width": 800,
  "height": 600,
  "alt": "Walnut desk organizer",
  "color": "#8a5a3c"
}
```

## REST routes

| Route | Behavior |
|---|---|
| `GET /v1/:resource` | `{ data, meta }` list envelope, deterministic default order |
| `GET /v1/:resource/:id` | Bare record; 404 when absent |
| `GET /v1/:resource/:id/:relation` | Bounded nested list with the same query and pagination rules |
| `POST /v1/:resource` | Validate; 201, `Location`, created representation; stored only in a stateful run |
| `PUT /v1/:resource/:id` | Replace writable fields; required fields enforced; 404 for a missing target; no upsert |
| `PATCH /v1/:resource/:id` | Merge documented writable fields; omitted fields unchanged; explicit `null` only where nullable; arrays replaced whole |
| `DELETE /v1/:resource/:id` | 204 with no body; repeating it returns 404 |
| `HEAD`, `OPTIONS` | Correct metadata and preflight; HEAD has no body |

Unsupported methods return 405 with `Allow`. Server-owned fields (`id`, `createdAt`, `updatedAt`) in a write body are rejected with a 422 field error of code `read_only`. Foreign keys are validated. In M1b, deleting a record with dependents returns 409.

In stateless mode (the public demo, or `--mode stateless` locally) a successful write returns the record as it would look if saved and `X-Mock-State: stateless`; a following GET of the new id returns 404. In memory mode the write is visible to later reads in the same run.

## Query parameters

| Parameter | Example | Notes |
|---|---|---|
| `limit`, `offset` | `limit=20&offset=40` | Default mode; `limit` defaults to 20, maximum 100 |
| `pagination=page`, `page`, `perPage` | `pagination=page&page=3&perPage=20` | Page mode |
| `pagination=cursor`, `limit`, `cursor` | `pagination=cursor&limit=20` then `&cursor=...` | Cursor mode; the first page has no cursor; `withTotal=true` opts into a total |
| `q` | `q=lamp` | Search over a documented per-resource field list; case-insensitive, Unicode-normalized |
| field filters | `status=active&userId=7` | Exact match on allowlisted fields |
| range filters | `priceMinor_gte=1000&priceMinor_lte=5000` | `_gt`, `_gte`, `_lt`, `_lte`, `_ne` on numeric and date fields |
| `sort` | `sort=-createdAt,title` | Allowlisted fields; `-` descending; `id` always breaks ties |
| `fields` | `fields=id,title,priceMinor` | Top-level scalar fields only; unknown fields are rejected |
| `expand` | `expand=author` | Allowlisted relations, depth one in M1 |

One pagination mode per request. Conflicting mode parameters, invalid numbers, unknown controls and duplicate scalar parameters return 400 with a Problem Details body.

## Responses

List envelope:

```http
GET /v1/products?limit=2&sort=-priceMinor&fields=id,title,priceMinor,currency
```

```json
{
  "data": [
    { "id": 17, "title": "Walnut Desk Organizer", "priceMinor": 8999, "currency": "USD" },
    { "id": 4, "title": "Linen Throw Pillow", "priceMinor": 7950, "currency": "USD" }
  ],
  "meta": { "limit": 2, "offset": 0, "total": 200, "hasMore": true }
}
```

Cursor envelope:

```json
{
  "data": ["...20 posts..."],
  "meta": { "limit": 20, "nextCursor": "b2Zmc2V0...", "prevCursor": null, "hasMore": true }
}
```

Single records are bare objects. Errors use RFC 9457 Problem Details with a stable `code` and a field-error extension:

```json
{
  "type": "https://api.loadstate.example/problems/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "2 fields are invalid",
  "code": "validation_failed",
  "errors": [
    { "field": "email", "code": "invalid_email", "message": "Must be a valid email" },
    { "field": "title", "code": "required", "message": "Required" }
  ]
}
```

Response headers: `Link` (`next`, `prev`, `first`, `last` where applicable), `ETag` (with 304 on `If-None-Match` for cacheable fixtures), `Retry-After` on 429 and 503, `X-Mock-State` (`stateless` or `memory`), and `X-Mock-Applied` listing the controls and recipe that shaped the response. All of these are listed in `Access-Control-Expose-Headers`. Anonymous public reads allow any origin without credentials. Simulated failures, delays and stateful responses are `no-store`; normal fixtures and images opt into caching.

## Simulation controls

Query controls win over their header equivalents. Immutable host limits apply first, then explicit request controls, then run configuration, then recipe defaults. Incompatible combinations, for example a malformed body with 204, return 400.

| Query | Header | Example | Effect |
|---|---|---|---|
| `_mock.delay` | `X-Mock-Delay` | `1500` | Wait before sending headers; maximum 10 000 ms on the public host |
| `_mock.status` | `X-Mock-Status` | `503` | Allowlisted final status with a Problem Details body; bodyless statuses are respected |
| `_mock.scenario` | `X-Mock-Scenario` | `maintenance` | Named recipe from the table below |
| `_mock.body` | `X-Mock-Body` | `malformed-json` | Fault profile: `malformed-json`, `empty`, `html`, `wrong-content-type` |
| `_mock.step` | `X-Mock-Step` | `2` | Select a step of a stepped recipe; stateless endpoints do not track progress |
| `_mock.failRate` | `X-Mock-Fail-Rate` | `0.3` | Exploratory random failure, 0 to 1; never the mechanism for automated tests |
| `_mock.fixture` | `X-Mock-Fixture` | `core@1` | Published fixture-pack version; default is the release's documented pack |
| `_mock.seed` | `X-Mock-Seed` | `42` | Reproducible variation input; not a run identifier |

Named recipes in M1a are deterministic unless marked exploratory:

| Recipe | Behavior |
|---|---|
| `slow` | Fixed 2 000 ms delay, then the normal response |
| `empty` | Lists return empty `data` with correct `meta`; single records return 404 |
| `error` | 500 |
| `unauthorized` | 401 |
| `forbidden` | 403 |
| `notfound` | 404 |
| `ratelimited` | 429 with `Retry-After: 5` |
| `maintenance` | 503 with `Retry-After: 60` |
| `timeout` | Waits the maximum delay, then 504; this is a gateway error, not a client timeout |
| `validation-error` | Writes return 422 with field errors; reads are unaffected |
| `retry-then-ok` | 503, 503, 200: selected by `_mock.step=1..3` on stateless endpoints, automatic per-run sequence in M1b |
| `flaky` | Exploratory: 200–800 ms delay and a 30 % failure rate; not for automated tests |

## Images

| URL | Result |
|---|---|
| `/img/600x400` | 600×400 SVG with the size as text |
| `/img/600` | Square |
| `/img/600x400?text=Hero&bg=0f172a&fg=e2e8f0` | Custom text and colors; text is escaped and length-limited |
| `/img/600x400?seed=p17&style=gradient` | Seeded `plain`, `gradient` or `pattern` so grids are not uniform gray boxes |
| `/img/avatar/jane-doe?size=96` | Initials avatar; `style=identicon` for a pattern |
| `/img/600x400?_mock.delay=2000` | Slow image for lazy-loading tests |
| `/img/600x400?_mock.status=404` | Broken image for `onError` fallbacks |

Dimensions are 10 to 2 000 logical pixels. SVG output contains no script, foreign objects or external references. Normal images carry long-lived cache headers; delay and status variants are `no-store`. M1b adds a small licensed raster set at fixed paths such as `/img/sample/desk.jpg` for screenshot tests.

## Utility and discovery endpoints (M1a)

| Endpoint | Purpose |
|---|---|
| `GET /v1` | Resource catalog with fixture-pack version and counts |
| `GET /capabilities` | API and fixture versions, supported scenarios and controls, adapter limits, current mode |
| `ANY /v1/_utils/echo` | Method, normalized query, allowlisted headers and bounded parsed JSON body; credentials and cookies redacted |
| `GET /v1/_utils/status/:code` | Supported status fixtures with protocol-correct headers and body rules |
| `GET /healthz`, `GET /readyz` | Liveness and readiness outside the simulation engine |
| `GET /openapi.json`, `GET /docs` | Generated contract and interactive reference |

## CLI

```text
npx loadstate                       start on http://127.0.0.1:4000 in memory mode
  --port 4000
  --host 127.0.0.1                  bind address; a non-loopback host is for self-hosting
  --mode memory|stateless           memory is the local default; stateless mirrors the public demo
  --fixture core@1                  fixture pack and version
  --seed 42
  --cors-origin https://app.test    repeatable; default allows any origin without credentials
  --max-delay 10000
```

M1b adds `--control`, which enables the loopback control API used by the test harness and prints a per-process secret at startup, and the Docker image, `docker run -p 4000:4000 <image>`, with the same flags as environment variables. Journal and clock flags are M2.

## Public limits

Starting points to validate in M0, from the plan, section 12: default 20 and maximum 100 records per page; delay up to 10 seconds; request bodies up to 256 KiB; responses up to 1 MiB; SVG dimensions 10 to 2 000 pixels; expansion depth one. Request-rate and concurrency limits are configured separately from simulated 429 responses.
