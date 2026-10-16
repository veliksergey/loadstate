# API spec: M1 surface

Planning document, 2026-10-15. This is the concrete M1 contract proposed for M0 review, restored from section 4 of the [original draft](old/API-tool-for-front-end-developers-PLAN.md) and made consistent with [PROJECT-PLAN.md](PROJECT-PLAN.md). M1a steps 1 to 3 implement the resources, the REST routes, the write rules, the query parameters and the list responses below; the other sections are still proposals. Precedence, cursor binding, caching and security rules live in the plan and in [TECHNICAL-DECISIONS.md](TECHNICAL-DECISIONS.md); this document shows what a developer sees. Field names, recipe names and flags are proposals. Two syntax questions, pagination mode selection and the control prefix, are open M0 decisions in the plan, section 15.

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

Counts are fixture-manifest metadata, not promises. The `core@1` pack generated in M1a step 1 holds 30 users, 120 posts, 360 comments, 12 categories (4 top-level, each with 2 children), 96 products and 150 todos, generated with Faker 10.6.0 from a fixed seed and reference time `2026-01-01T00:00:00.000Z`. `packages/core/src/contracts.ts` is the authoritative field list; this table summarizes it. Every record has an integer `id` and UTC ISO 8601 `createdAt` and `updatedAt`. Date-only fields are `YYYY-MM-DD` strings. Money is an integer in minor units plus an ISO 4217 `currency`; this differs from familiar sample APIs on purpose, so formatting code is exercised instead of string concatenation.

| Resource | Relations | Notable fields |
|---|---|---|
| `users` | `posts`, `comments`, `todos` | `name`, `username` (lowercase letters, digits, `.`, `_`, `-`), `email`, `avatar` (image object), `role` (`admin`, `editor`, `viewer`), `status` (`active`, `invited`, `disabled`), `address` (nullable object with `street`, `city`, `postalCode`, ISO `country`), `company` (nullable), `locale`, `timezone` |
| `posts` | `comments` | `userId`, `title`, `slug`, `excerpt`, `body` (Markdown), `cover` (image object), `tags[]`, `readingTimeMinutes`, `status` (`draft`, `published`, `archived`), `publishedAt` (null for drafts) |
| `comments` | `replies` | `postId`, `userId`, `parentId` (nullable, one level), `body`, `likes` |
| `products` | none | `categoryId`, `title`, `slug`, `description`, `priceMinor`, `currency`, `rating` (0–5, one decimal, 0 when unrated), `ratingCount`, `stock` (0 allowed), `brand`, `images[]`, `status` (`active`, `draft`, `discontinued`) |
| `categories` | `products`, `children` | `parentId` (nullable; categories are one level deep and products sit in child categories), `name`, `slug`, `image` |
| `todos` | none | `userId`, `title`, `completed`, `dueDate` (date-only, nullable, may fall after the reference time), `priority` (`low`, `normal`, `high`) |

A relation is read as a nested list with the same pagination rules: `/v1/users/7/posts`, `/v1/comments/3/replies`, `/v1/categories/1/children`. The nested list of a missing parent is 404.

Valid edge packs include records with omitted optional fields, explicit nulls, empty strings, zero stock, long text, Unicode and RTL names, duplicate display names, date boundaries and missing optional relations. Fault packs with malformed or invalid records are separately labeled and arrive in M1b.

Every image field is an object. Fixtures store its `url` as a path under `/img`; responses make it absolute with a trusted base URL, so the same data works on every host. The Node server uses its configured `publicUrl` or its own listening origin, never the client's `Host` header; the Worker uses the hostname Cloudflare routed the request to, and the MSW adapter uses its `baseUrl`, path prefix included. The `/img` endpoint that serves these URLs arrives in M1a step 5. Blur metadata is optional and documented when added.

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
| `DELETE /v1/:resource/:id` | 204 with no body; in a stateful run, repeating it returns 404 |
| `HEAD`, `OPTIONS` | Correct metadata and preflight; HEAD has no body |

Unsupported methods return 405 with `Allow`: `GET, HEAD, POST` on a collection and `GET, HEAD, PUT, PATCH, DELETE` on a record. A malformed id such as `007` matches no route and is 404 for every method.

In stateless mode (the public demo, or `--mode stateless` locally) a successful write returns the record as it would look if saved and `X-Mock-State: stateless`; a following GET of the new id returns 404, and a deleted record is still readable. In memory mode every write is visible to later reads in the same run, and a reset restores the pack and its next ids.

### Writes

Each resource has one writable input contract, published in the OpenAPI document as `{Singular}Create` (POST and PUT) and `{Singular}Patch` (PATCH, every field optional). Unknown keys are rejected, so a typo never passes silently.

| Resource | Required on POST and PUT | Optional, with the default used when omitted | Read-only |
|---|---|---|---|
| `users` | `name`, `username`, `email` | `role` `viewer`, `status` `active`, `address` `null`, `company` `null`, `locale` `en-US`, `timezone` `UTC` | `id`, `avatar`, `createdAt`, `updatedAt` |
| `posts` | `userId`, `title`, `body` | `excerpt` (derived from `body`), `tags` `[]`, `status` `draft` | `id`, `slug`, `cover`, `readingTimeMinutes`, `publishedAt`, `createdAt`, `updatedAt` |
| `comments` | `postId`, `userId`, `body` | `parentId` `null` | `id`, `likes`, `createdAt`, `updatedAt` |
| `categories` | `name` | `parentId` `null` | `id`, `slug`, `image`, `createdAt`, `updatedAt` |
| `products` | `categoryId`, `title`, `description`, `priceMinor`, `brand` | `currency` `USD`, `stock` `0`, `status` `draft` | `id`, `slug`, `images`, `rating`, `ratingCount`, `createdAt`, `updatedAt` |
| `todos` | `userId`, `title` | `completed` `false`, `dueDate` `null`, `priority` `normal` | `id`, `createdAt`, `updatedAt` |

- **PUT replaces.** It takes the same body as POST, and an omitted optional field returns to its default. There is no upsert: a missing target is 404, checked before the body is read.
- **PATCH merges.** Omitted fields keep their stored values. `null` is accepted only for nullable fields (`address`, `company`, `parentId`, `dueDate`). Arrays and nested objects such as `tags` and `address` are replaced whole. An empty object only advances `updatedAt`.
- **Read-only fields are named.** Sending one is a 422 field error with code `read_only`; any other unknown key has code `unknown_field`.

The server derives the rest from the inputs. `createdAt` is kept on PUT and PATCH, and `updatedAt` takes the server clock on every write.

| Field | Rule |
|---|---|
| Post and product `slug` | The title in lowercase ASCII with dashes, then `-{id}`; `post-{id}` or `product-{id}` when nothing is left |
| Category `slug` | Kept while the name stays the same; otherwise the name the same way, or `category` when nothing is left, and while another category has that slug, `-{id}` is appended |
| Post `excerpt` | When omitted on POST or PUT, the start of the body as plain text, at most 160 characters plus an ellipsis; the title when the body has no text |
| Post `readingTimeMinutes` | Words in the body, ignoring surrounding whitespace, divided by 200, rounded up, at least 1 |
| Post `publishedAt` | Set to the write time when a post leaves `draft`, kept while it stays `published` or `archived`, cleared when it returns to `draft` |
| User `avatar` | `/img/avatar/{username}?size=96`; its `alt` follows `name` |
| Post `cover`, category `image`, product `images` | A seeded `/img` placeholder on create, kept on later writes; the `alt` text follows the title or name |
| Comment `likes`, product `rating` and `ratingCount` | 0 on create, kept on later writes |

Writes keep the pack's structure. A reference to a missing record is a 422 field error with code `invalid_reference`; each rule below is a 422 field error with the code shown.

| Rule | Code |
|---|---|
| A comment's post is published or archived | `not_published` on `postId` |
| A post with comments cannot return to draft | `has_comments` on `status` |
| A reply's parent is a top-level comment | `nested_reply` on `parentId` |
| A reply's parent is on the same post | `other_post` on `parentId` |
| A comment cannot reply to itself | `self_reference` on `parentId` |
| A comment with replies stays top-level and on its post | `has_replies` on `parentId` or `postId` |
| A category's parent is a top-level category | `nested_category` on `parentId` |
| A category cannot be its own parent | `self_reference` on `parentId` |
| A category with subcategories stays top-level | `has_children` on `parentId` |
| A category with products keeps its parent | `has_products` on `parentId` |
| A product sits in a subcategory | `not_subcategory` on `categoryId` |

Conflicts are 409. A `username` or `email` already used by another user, with email compared case-insensitively, answers `conflict` with an `already_used` field error per field. Deletes never cascade: deleting a user with posts, comments or todos, a post with comments, a comment with replies, or a category with products or subcategories answers `has_dependents`, and the detail names each relation and its count.

Checks run in a fixed order, and the first failing step answers: route and method (404, 405), query string (400), target record (404), media type (415), JSON syntax (400), fields (422), references and structure (422), then conflicts (409).

## Query parameters

Lists and nested lists accept every parameter below. A single read accepts only `fields` and `expand`, and writes accept none. Unknown, repeated and malformed parameters return 400 `invalid_query` with one field error per problem; nothing is coerced or ignored.

| Parameter | Example | Notes |
|---|---|---|
| `limit`, `offset` | `limit=20&offset=40` | Offset mode, the default; `limit` 1 to 100, default 20 |
| `page`, `perPage` | `page=3&perPage=20` | Page mode; `page` from 1, `perPage` 1 to 100, default 20; a page past the end is an empty 200 |
| `cursor`, `limit`, `withTotal` | `pagination=cursor&limit=20`, then `cursor=...` | Cursor mode; the first page has no cursor; `withTotal=true` adds `meta.total` |
| `pagination` | `pagination=cursor` | `offset`, `page` or `cursor`; when omitted, `page` or `perPage` choose page mode and `cursor` chooses cursor mode. `withTotal` does not choose a mode |
| `q` | `q=lamp` | Every whitespace-separated term must appear in the resource's search fields; 1 to 100 characters, counted as Unicode code points like every length limit |
| field filters | `status=active&userId=7` | Exact match on the resource's filter fields, parsed by type; `null` for nullable fields; `tags=react` means the tags include `react` |
| `_ne` | `status_ne=draft` | Any filter field |
| `_gt`, `_gte`, `_lt`, `_lte` | `priceMinor_gte=1000&priceMinor_lte=5000` | Numeric, date and date-time filter fields |
| `sort` | `sort=-createdAt,title` | Up to 4 sortable fields; `-` sorts descending; `id` breaks every tie |
| `fields` | `fields=id,title,priceMinor` | Top-level scalar fields only, returned in the record's own field order |
| `expand` | `expand=author` | To-one related records, depth one |

One pagination mode per request. A parameter of another mode, a `pagination` value that contradicts the others, or `withTotal` outside cursor mode is 400 `conflicting_parameter`.

| Resource | `q` searches | Filters | Sort | Expand |
|---|---|---|---|---|
| `users` | `name`, `username`, `email` | `role`, `status`, `locale`, `createdAt` | `id`, `name`, `username`, `email`, `createdAt`, `updatedAt` | none |
| `posts` | `title`, `excerpt`, `tags` | `userId`, `status`, `tags`, `readingTimeMinutes`, `publishedAt`, `createdAt` | `id`, `title`, `readingTimeMinutes`, `publishedAt`, `createdAt`, `updatedAt` | `author` |
| `comments` | `body` | `postId`, `userId`, `parentId`, `likes`, `createdAt` | `id`, `likes`, `createdAt`, `updatedAt` | `author`, `post`, `parent` |
| `categories` | `name` | `parentId` | `id`, `name`, `createdAt`, `updatedAt` | `parent` |
| `products` | `title`, `description`, `brand` | `categoryId`, `status`, `currency`, `brand`, `priceMinor`, `rating`, `ratingCount`, `stock`, `createdAt` | `id`, `title`, `priceMinor`, `rating`, `ratingCount`, `stock`, `createdAt`, `updatedAt` | `category` |
| `todos` | `title` | `userId`, `completed`, `priority`, `dueDate`, `createdAt` | `id`, `title`, `completed`, `priority`, `dueDate`, `createdAt`, `updatedAt` | `user` |

- **Text is folded the same way for search and sort.** NFKD normalization, every combining mark (Unicode category M) removed, then lowercase, so `q=zoe` finds "Zoë". The result does not depend on the runtime's locale data.
- **Filter values are typed.** Integers and numbers are plain decimals, booleans are `true` or `false`, enums take a documented value, and dates are `YYYY-MM-DD`. A number must be finite. A date-time filter takes an ISO 8601 date-time with `Z` or an offset and at most millisecond precision, or a bare date that means its first instant in UTC.
- **Nulls.** A null value matches `field=null`, and `field_ne=value` for any non-null value. It never matches `_gt`, `_gte`, `_lt` or `_lte`. `field_ne=null` selects the records that have a value.
- **Sort order.** Nulls come last in both directions. Strings order by folded text, then by code units; enums by their declared order, for example todo `priority` low, normal, high; booleans false first; dates chronologically. Without `sort`, a list is in ascending `id` order.
- **Expansions.** Posts expand `author` from `userId`; comments `author`, `post` and `parent`; categories `parent`; products `category`; todos `user`. An expanded record is the full record with absolute image URLs, or `null` when the reference is null. `fields` applies to the listed record, and expansions are added after it. To-many relations stay on the nested routes.
- **Cursors** are opaque strings of at most 2048 characters. Each one is bound to its route, the fixture pack, the search, the filters and the sort; `limit`, `fields` and `expand` may change between pages. A malformed cursor is 400 `invalid_cursor`, and a cursor reused with a different route, pack, search, filter or sort is 400 `cursor_mismatch`; either way, start again without a cursor.
- **Cursors in a memory engine** stay valid across writes and continue after their boundary row's sort values. Records added before the boundary are not shown, deleted records disappear, and a record whose sort value changes can show twice or not at all. Rejecting a cursor after a write is M1b work.

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

Page envelope meta, for `page=2&perPage=12`:

```json
{ "page": 2, "perPage": 12, "total": 96, "totalPages": 8, "hasMore": true }
```

Cursor envelope; `meta.total` appears only with `withTotal=true`:

```json
{
  "data": ["...20 posts..."],
  "meta": { "limit": 20, "nextCursor": "eyJ2IjoxLCJoIjoi...", "prevCursor": null, "hasMore": true }
}
```

`fields` and `expand` change each record's shape; the OpenAPI document describes those records as `{Singular}Projection`, with every field optional and the expansions added.

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

Every list response carries `Link` with `first`, `prev` and `next` where they apply and, outside cursor mode, `last`. A link keeps the request's other parameters and uses the deployment's trusted base URL: the configured `publicUrl` or the listening origin on Node, the routed hostname on Workers, the MSW `baseUrl`, and a root-relative path in-process. Planned response headers: `ETag` (with 304 on `If-None-Match` for cacheable fixtures), `Retry-After` on 429 and 503, `X-Mock-State` (`stateless` or `memory`), and `X-Mock-Applied` listing the controls and recipe that shaped the response. All of these are listed in `Access-Control-Expose-Headers`. Anonymous public reads allow any origin without credentials. Simulated failures, delays and stateful responses are `no-store`; normal fixtures and images opt into caching.

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
