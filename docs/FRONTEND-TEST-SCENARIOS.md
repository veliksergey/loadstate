# Front-end test scenario catalog

Planning document · 2026-10-15 · No implementation is implied by this catalog.

This catalog extends the two drafts in `docs/old`. It describes what a developer should be able to reproduce, what their application should assert, and where the behavior can be reproduced faithfully. It is a coverage map, not a claim that a finite API can test every application or browser behavior. Each application still needs its own business rules and assertions.

The product should offer a small set of composable primitives plus named recipes. A developer should be able to select “search results arrive out of order” or “save succeeds but acknowledgement is lost” without inventing a server. The first stable release should prioritize repeatability and isolation over the number of sample resource types.

## Delivery layers and release priorities

| Label | Delivery layer | What it can prove |
|---|---|---|
| H | Public hosted HTTP API | Real HTTP responses, data, bounded delays, response headers, and documented public fixtures. Shared demo resources remain stateless. |
| L | Local engine / local HTTP server / self-hosted private test run | Isolated mutable data, deterministic sequences, virtual business time, request journals, and controlled local HTTP services. In-process execution proves engine semantics; use its HTTP adapter when testing transport. |
| I | In-process test adapter or MSW adapter | Offline unit/component tests using the same fixture and scenario definitions. It can emulate client-visible responses and failures but is not proof of the real network stack. |
| B | Real browser and application test harness | Rendering, cancellation, actual CORS/cookies/cache behavior, navigation, service workers, accessibility, storage, and browser policies. Use Playwright or another real-browser runner. |
| P | Controlled proxy / network / dedicated protocol server | Connection resets, bandwidth limits, TLS/DNS faults, malformed transport, and other faults ordinary hosted handlers cannot reliably produce. Optional local recipes, not requirements for the free public service. |

A cell such as `H/L/I + B` means those layers provide the fixture and the browser supplies the UI assertion. `L/I` does not promise that every MSW/browser/runtime combination supports every streaming or cancellation detail; publish an adapter capability matrix and reject unsupported configurations explicitly.

| Release | Priority | Scope |
|---|---|---|
| M1 | Core | Supported by the end of M1b. M1a ships the hosted REST demo, local `npx` server, error/data/loading cases, basic SVG images and documentation; M1b adds the local engine, MSW integration, isolated state, deterministic sequences and the M1-core examples below. Hosted-layer (H) rows marked M1 are available from M1a. |
| M2 | Next | GraphQL, realistic simulated auth flows, uploads/downloads, SSE/NDJSON, richer cache/cookie fixtures, and advanced mutation workflows. |
| M3 | Advanced | Bidirectional realtime, advanced customization/import, incremental GraphQL delivery where supported, larger protocol labs, optional hosted isolated sandboxes after cost/security validation. |
| Recipe | Documented harness integration | A recipe may accompany M1/M2/M3 without implementing a new server capability. Browser and proxy functionality remains owned by the relevant testing tools. |

In the tables, a release is the first planned supported delivery. An earlier recipe may use hand-authored fixtures without making that feature a supported product contract.

### M1-core gate

About seventy rows below are marked M1. Only the following need a runnable example and a passing acceptance test before the M1b release; every other M1 row means the server supports the fixture and an example may follow. Each group maps to one acceptance example in [PROJECT-PLAN.md, section 13](PROJECT-PLAN.md#13-delivery-roadmap-and-acceptance-gates).

| Acceptance example | Scenarios |
|---|---|
| M1a public demo | DATA-01, DATA-02, DATA-07, DATA-13, FETCH-01, FETCH-09, FETCH-15, LIST-01, LIST-03, LIST-04, FILE-02 |
| M1b component | FETCH-10, FETCH-11, WRITE-04, APP-12 |
| M1b E2E | WRITE-01, WRITE-06, APP-11 |
| M1b race | FETCH-04, LIST-06, LIST-07 |

## Reproducibility contract: required before claiming CI support

### One independent run per test

1. Create a fresh run for each test or explicitly shared test workflow. Its manifest includes scenario version, dataset version, seed, initial logical time, adapter, and configured limits. A runner can derive a unique namespace from project, worker, test, and retry identifiers; uniqueness and reproducibility are separate concerns.
2. A run owns records, IDs, sequence counters, simulated sessions, idempotency keys, event offsets, rate-limit counters, and journal entries. Nothing in another run can alter these values. Separate tabs can intentionally share one run for multi-tab tests.
3. In-process tests get an engine instance per test. HTTP tests get scoped run URLs or explicit scoped configuration. Browser and server-side application requests must carry the same run scope without exposing a privileged control credential to the browser.
4. A namespace string is an identifier, not authorization. Mock login credentials cannot grant access to run controls. The binding, credential and ownership rules are in [Technical decisions, section 6](TECHNICAL-DECISIONS.md#6-security-boundaries).
5. No public global reset endpoint. Reset and teardown act on exactly one authorized run; portable checkpoint restore joins them in M2 with the same boundary. Teardown cancels owned timers/streams and removes owned data. TTL and size limits recover abandoned runs.
6. Never put tests on the shared public demo by default. CI should be fully runnable offline after dependencies and fixtures are installed. The hosted service gets separate availability/compatibility checks whose outages do not invalidate application unit tests.

### Deterministic matching, randomness, and sequences

- Match on method, route, normalized query, selected headers, and validated body fields; for GraphQL, operation name plus variables and operation kind. Document matcher priority and reject ambiguous equal-priority rules. Do not derive behavior from accidental query parameter order or object key order.
- A fixed seed by itself is insufficient. Derive independent random streams from dataset/scenario version, seed, fixture identity, stable operation key, and an explicit attempt or sequence step. Unrelated parallel requests must not consume each other's random numbers.
- Repeated identical requests should return the same random fixture unless the scenario explicitly declares a transition. “30% failures” is for exploratory demos; a test should use a named sequence such as fail, fail, succeed. A proportion is not a guarantee that a small sample contains a failure.
- Counters belong to a matched operation in a run, never the whole server. Reserve a sequence step atomically when the matching request is accepted, before delaying its response. Preflight requests, health probes, and journal reads do not consume application steps.
- Concurrent indistinguishable requests have no inherent stable order. Require a test-provided correlation key or explicit synchronization for order-sensitive assertions. Otherwise define arrival order as nondeterministic and assert invariant outcomes rather than which caller won.
- A caller-supplied attempt selector is a simulation control, not a real production retry protocol. Provide an automatic per-run sequence for clients that should be tested without changing their request shape. Public stateless recipes may expose explicit attempt selection but must say they do not track workflow state.
- Sequences declare exhaustion behavior: repeat final outcome, cycle, or fail with a diagnostic. Default tests should fail on unexpected extra calls or unhandled routes. If a retry reruns a whole test, create a new run rather than continuing an exhausted sequence.
- Cancellation semantics must be explicit: a request accepted into a sequence consumes its reserved step even if the client aborts. Mutation commit is a separate scripted event. A cancelled client request does not imply a rolled-back server write.

### Time, reset, journals, and evidence

Milestones: M1b provides reset, sequences and strict unhandled-request mode; the injected business clock, journal export and checkpoints are M2.

Use an injected logical clock for generated timestamps, token expiry, rate windows, delayed job transitions, and idempotency expiry. Use a separately controlled scheduler for response delays and event delivery. Advancing business time must not accidentally run every pending network timer. Test runners and browser timers need coordination; changing engine time does not change the browser's `Date`, native request timeout, HTTP cache clock, or a remote server clock.

Freeze fixtures at a declared epoch. Generated IDs and timestamps should be reproducible for equivalent runs. Keep wall-clock timing tests separate, use tolerances, and prefer waiting for observable state or a barrier over sleeping for an arbitrary duration.

Reset returns a run to its declared manifest, clears state and sequence counters, and advances an internal generation marker. Older in-flight handlers must not commit into the new generation. The harness must cancel or drain old browser work so a late response cannot overwrite the new UI. Export a redacted failure journal before resetting it.

The journal should capture request identity, matched scenario/step, request and response timing, selected non-sensitive fields, status, commit/event milestones, and cancellation if observable. Bound retention and body size. Redact authorization, cookies, control capabilities, upload bytes, and configured sensitive fields. Assert counts, matched body fields, request order where specified, and unexpected calls. A server journal proves what the server observed; it does not prove that a browser received or rendered a response.

Each scenario export should contain its versioned definition, manifest, relevant fixture IDs, expected outcome, and adapter requirements. A failing test should be reproducible from that bundle without sharing secrets or production data.

## 1. Data shape, content, and rendering

Normal fixtures obey the declared schema. Invalid-contract fixtures live in explicitly labeled fault scenarios; they must not silently weaken normal schemas or generated TypeScript types.

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| DATA-01 | Ordinary list, one record, zero records, missing record | Distinct content, empty, and not-found states; no crash or perpetual spinner | H/L/I + B | M1 |
| DATA-02 | Omitted optional field, explicit `null`, empty string, zero, and `false` | Defaults apply intentionally; zero/false are not mistaken for absence | H/L/I + B | M1 |
| DATA-03 | Short text, long paragraph, unbroken identifier/URL, multiline text | Wrapping/truncation works; controls remain usable; expansion exposes full content | H/L/I + B | M1 |
| DATA-04 | Emoji, combining marks, CJK, RTL text, mixed scripts, non-ASCII names | Correct encoding and direction; no broken text or invalid slicing | H/L/I + B | M1 |
| DATA-05 | Decimal amount as declared string or minor units, zero/negative amounts, very large integers as strings | Accurate formatting; no precision loss or accidental string concatenation | H/L/I + B | M1 |
| DATA-06 | Dates around midnight, leap day, DST boundary, timezone offsets, date-only values, future/expired dates | Appropriate timezone/date treatment and stable relative-time labels | H/L/I + B | M1 |
| DATA-07 | Missing relationship, empty children, optional parent, deleted related record | Useful fallback; no unsafe property access or endless relation fetch | H/L/I + B | M1 |
| DATA-08 | Duplicate display names, equal sort values, non-sequential IDs, string IDs in a custom contract | Stable identity and ordering; correct selected item after reorder | H/L/I + B | M1; custom ID contract M3 |
| DATA-09 | Unknown enum value, extra field, missing required field, wrong field type | Explicit schema/fallback behavior; diagnostics do not crash the entire page | H/L/I + B | M1 fault fixtures |
| DATA-10 | Small, large, and bounded stress lists; deeply nested fixture | Virtualization and responsiveness meet application targets; no uncontrolled expansion | H/L/I + B; large local fixtures L | M1 baseline; M3 custom scale |
| DATA-11 | Literal HTML/script-like text, Markdown links, unsafe-looking URL fields | Text escaping/sanitization and URL policy work without executing fixture content | H/L/I + B | M1 |
| DATA-12 | Localized labels/currencies, plural counts 0/1/2/many, missing translation keys | Locale-aware display, layout, and fallback text | H/L/I + B | M2 locale packs |
| DATA-13 | Valid JSON with unexpected root shape; empty body; invalid/truncated JSON; wrong media type; HTML proxy error page | Parse, content-type, schema, and HTTP failures remain distinguishable | H/L/I + B | M1 |

Use fictional people and safe sample contact/domain values. Avoid production records, real credentials, and remotely fetched user-provided image URLs. Fixtures containing hostile-looking content are inert data, not executable payload hosting.

## 2. Loading, fetching, retries, and cancellation

`fetch()` resolves for ordinary HTTP error responses; the caller checks status. A network failure or abort takes another path, and malformed JSON fails while reading the body. A 504 response is an HTTP gateway error even when deliberately delayed; it is not a client timeout. Keep these named scenarios separate. [Fetch behavior](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch), [HTTP 504 semantics](https://www.rfc-editor.org/rfc/rfc9110.html#name-504-gateway-timeout), checked 2026-10-15.

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| FETCH-01 | Immediate response, delayed first byte, response just above/below loading threshold | Skeleton/spinner timing and disabled controls match product intent | H/L/I + B | M1 |
| FETCH-02 | Fast headers, slow body, long pause between chunks | Loading ends when usable data is ready, not merely when headers arrive | H/L/I + B | M2 streaming |
| FETCH-03 | Several independent endpoints with distinct delays and one failure | Independent panels settle correctly; one failure does not erase successful panels | H/L/I + B | M1 |
| FETCH-04 | Slow old search result followed by fast new result | Latest user intent wins; stale response cannot replace newer results | L/I + B; H with explicit delays | M1 |
| FETCH-05 | Debounced search, repeated identical query, mount/unmount/remount | Expected request count; cleanup; no stale state update or duplicate effects | L/I + B | M1 |
| FETCH-06 | User abort before headers or during body consumption | Cancellation UI differs from error UI; resource cleanup; no surprise toast | H/L/I + B | M1 headers; M2 body |
| FETCH-07 | Response stalls longer than application timeout | Application timeout fires, retry/cleanup works, late completion is ignored | L/I + B; bounded H only when timeout is shorter than host limit | M1 |
| FETCH-08 | Actual connection refusal/reset, DNS/TLS fault, offline browser | Network-error path and recovery without assuming a readable status/body | B/P; I emulates rejection | M1 recipe; M3 protocol labs |
| FETCH-09 | 400/401/403/404/409/410/422/429/500/502/503/504 fixtures | Correct retryable versus permanent classification and appropriate message | H/L/I + B | M1 |
| FETCH-10 | Sequence 503, 503, success; 429 with delta or HTTP-date `Retry-After` | Retry count, bounded exponential backoff/jitter, deadline, cancel-retry behavior | L/I + B; H explicit step | M1 |
| FETCH-11 | Exhausted retry budget; recovery after user presses retry | No infinite retry loop; retry button restores a usable state | L/I + B | M1 |
| FETCH-12 | Background refetch while stale data exists, then failure | Existing useful data remains visible; background error is represented intentionally | L/I + B | M1 |
| FETCH-13 | Navigation while pending, back/forward navigation, two simultaneous consumers | Correct deduplication/cancellation policy; stale navigation does not overwrite current route | L/I + B | M1 |
| FETCH-14 | HTTP redirect chain, loop, same-origin/cross-origin destinations; 303 versus 307/308 | Redirect/error handling and method behavior are tested in actual client runtime | H/L + B; P for lower-level anomalies | M2 |
| FETCH-15 | Successful 204 or HEAD response with no body | Client does not unconditionally parse JSON or display an error | H/L/I + B | M1 |
| FETCH-16 | Delayed module/script load and failed code chunk | Lazy fallback and route error boundary recover as designed | B controlling application's own build assets | M1 recipe |

A delay in a fetch inside an Effect does not automatically activate React Suspense. Provide separate examples for ordinary fetch loading, a supported Suspense data integration, and `React.lazy` code loading. Lazy chunk failures must target the application's built asset; a generic remote module endpoint is not a substitute. [React Suspense](https://react.dev/reference/react/Suspense), checked 2026-10-15.

## 3. Lists, pagination, filtering, and dependent queries

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| LIST-01 | First/middle/last page, exact page-size multiple, partial page, empty result | Correct next/previous controls and end-of-list state | H/L/I + B | M1 |
| LIST-02 | Offset and numbered-page pagination; invalid or mixed parameters | Client serializes one mode correctly and presents validation failures | H/L/I + B | M1 |
| LIST-03 | Cursor forward/backward, omitted total, empty end cursor | Infinite scroll stops without guessing from page length or assuming totals | H/L/I + B | M1 |
| LIST-04 | Cursor expired/invalid or reused with different filter/sort/dataset version | Client restarts or shows a useful error; no silent unrelated page | H/L/I + B | M1 |
| LIST-05 | Equal sort values with stable tie-breaker; sorting direction changes | No skipped/duplicate rows under the declared pagination consistency model | H/L/I + B | M1 |
| LIST-06 | Change search/filter while a later page is loading | Old page discarded; cursor/page reset; correct loading and empty states | L/I + B | M1 |
| LIST-07 | Later page fails, retry succeeds; duplicate load-more gesture | Existing pages retained; no duplicate append or request flood | L/I + B | M1 |
| LIST-08 | Create/delete/reorder data between page fetches | Application handles live-view changes; snapshot mode preserves its declared snapshot | L/I + B | M2 explicit consistency modes |
| LIST-09 | Search escaping, spaces, `+`, ampersands, Unicode, case/accent behavior | Correct URL encoding and documented matching; no query injection | H/L/I + B | M1 |
| LIST-10 | Combined filters, inclusive/exclusive numeric/date boundaries, zero matches | Correct query construction, filter chips, reset, and empty-state text | H/L/I + B | M1 |
| LIST-11 | Sparse fields and relation expansion; unknown fields or excessive depth | UI handles intentionally absent fields; invalid requests fail predictably | H/L/I + B | M1 bounded features |
| LIST-12 | Parent selection changes before dependent child query completes | Child options and selected values belong to current parent | L/I + B | M1 |

Cursor opacity alone does not guarantee stable results while data changes. Define whether a cursor traverses a frozen snapshot or a live collection, bind it to its query and version, and test that contract. A stable ID tie-breaker solves equal-sort-value ordering, not every concurrent-mutation anomaly.

## 4. Forms, writes, optimism, and concurrency

Public echo writes are useful for form wiring but cannot validate create-read-update-delete workflows. M1 needs local stateful runs so successful writes are observable by later reads. Public docs must state clearly when writes are simulated without persistence.

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| WRITE-01 | Create/read/update/delete in one isolated run | Subsequent UI reflects stored changes; deleting one test's record cannot affect another | L/I + B | M1 |
| WRITE-02 | Successful POST with server ID, canonicalized fields, timestamps and `Location` | Temporary ID replaced consistently across list/detail/cache | H echo or L/I state + B | M1 |
| WRITE-03 | PUT replacement versus PATCH partial update; explicit null versus omission | Form sends intended semantics and handles server result | H/L/I + B | M1 |
| WRITE-04 | Field-level validation, nested array errors, form-level business error | Errors attach to the correct fields, preserve input, and focus appropriately | H/L/I + B | M1 |
| WRITE-05 | Delayed save, double click, Enter plus click, submit after unmount | Submission state and duplication policy work; no unexpected extra write | L/I + B | M1 |
| WRITE-06 | Optimistic create/update/delete succeeds or fails | Correct confirmation or rollback, including counts and related caches | L/I + B | M1 |
| WRITE-07 | Two optimistic edits overlap; earlier request fails after later success | Rollback does not erase the newer successful edit | L/I + B | M1 sequence recipe |
| WRITE-08 | 409 domain conflict; stale ETag/version rejected with 412 | Conflict UI preserves local edit and offers a deliberate resolution | L/I + B | M1 domain conflict; M2 conditional update |
| WRITE-09 | Same idempotency key and payload sent twice; key reused with different payload | One operation/result for a retry; mismatched reuse yields documented error | L/I + B | M2 |
| WRITE-10 | Commit succeeds, acknowledgement is lost; client retries | Reconciliation avoids duplicate records/payment-like actions | L + P/B or I modeled rejection | M2 |
| WRITE-11 | Delayed visibility after successful mutation | UI handles explicit eventual consistency and pending status without false rollback | L/I + B | M2 |
| WRITE-12 | 202 accepted, job polling progresses/runs/fails/cancels | Progress, polling interval, terminal stop, navigation and cancellation work | L/I + B | M2 |
| WRITE-13 | Bulk mutation partly succeeds; per-item validation/conflict | Successful items stay saved; failed items can be retried individually | L/I + B | M2 |
| WRITE-14 | Deleting already deleted item; stale detail after list delete; undo window expires | Consistent not-found and undo behavior; no resurrected stale record | L/I + B | M2 |
| WRITE-15 | Two tabs edit same object; role changes during edit | Conflict and access changes propagate without data leakage | L/I + B | M2 |

The toolkit should define its idempotency fixture contract, including key scope, body comparison, pending duplicate behavior, replay window, and expiry. Do not imply that sending an `Idempotency-Key` header alone makes an arbitrary backend idempotent.

## 5. Authentication, authorization, and session UX

These are simulated application behaviors. They do not secure the toolkit itself. Protect every real control endpoint using separate credentials and run ownership checks, even when a scenario deliberately simulates a broken application authorization rule.

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| AUTH-01 | Unauthenticated 401 versus authenticated-but-forbidden 403 | Login prompt versus access-denied UI; no unbounded refresh loop | H/L/I + B | M1 static; M2 stateful |
| AUTH-02 | Login valid/invalid/disabled/unverified user; logout | Form and session lifecycle, redirects, cache clearing | L/I + B; H demo fixtures | M2 |
| AUTH-03 | Access token expires during session; refresh succeeds/fails | Refresh resumes valid requests or ends session cleanly | L/I + B | M2 |
| AUTH-04 | Several requests receive 401 concurrently | One coordinated refresh, correct retry count, no stampede | L/I + B | M2 |
| AUTH-05 | Refresh rotation/reuse, logout during refresh, revoked session | Stale refresh cannot restore a logged-out session | L/I + B | M2 |
| AUTH-06 | Owner/non-owner, tenant A/B, role permitted/denied, entitlement active/expired | Correct UI state and server fixture scope; cached tenant data is not reused across users | L/I + B | M2 |
| AUTH-07 | Cookie session with missing credentials, SameSite differences, cookie blocked | Session failure explained; no assumption that success in Node proves browser cookies work | L + B; controlled origins | M2 |
| AUTH-08 | CSRF missing/invalid token in a cookie-auth workflow | Form recovers deliberately without treating a rejected write as saved | L + B | M2 recipe |
| AUTH-09 | Multi-step MFA/OTP, password reset expiry, recovery codes | Step transitions, expired challenge and resend cooldown | L/I + B | M3 fixture templates |
| AUTH-10 | OAuth/OIDC-style redirect/callback success, denial, state mismatch | Redirect handling and application session transition | Dedicated local provider/harness + B | M3 integration recipe |

Demo roles, tenants, and entitlement flags are fixture inputs, not real proof of authorization. Namespace ownership and control permissions must be enforced independently server-side. A public simulation parameter must never bypass host quotas, expose another run, or change real service credentials.

## 6. HTTP cache, CORS, cookies, and browser policy

HTTP caching and a client library's data cache are different layers. `Cache-Control` does not directly set a TanStack Query/SWR stale time, invalidation policy, or garbage-collection time. Provide separate recipes for each layer and test their interaction. Browser tests must run without an interception mode that bypasses the behavior being asserted.

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| HTTP-01 | ETag/If-None-Match and Last-Modified/If-Modified-Since | Correct conditional request and revalidation; no JSON parse of a raw bodyless 304 | H/L + B; I semantic fixture | M1 ETag; M2 dates |
| HTTP-02 | Fresh, stale, `no-store`, `no-cache`, `private`, and immutable assets | Browser cache behavior matches contract; sensitive data not reused across sessions | H/L + B | M1 basics; M2 full matrix |
| HTTP-03 | Query-client fresh/stale/error cache, invalidate, refetch on focus/reconnect | UI data and request counts match explicitly configured library policy | L/I + B | M1 recipe |
| HTTP-04 | Cache key includes filter, pagination, user, tenant, locale and run | No accidental cross-query or cross-user cached response | L/I + B | M1 |
| HTTP-05 | Allowed and rejected actual CORS requests from a second origin | Allowed response readable; blocked response has network-error UX, not a readable 403 body | H/L + B | M1 |
| HTTP-06 | Preflight allowed/rejected, missing method/header permission, cached preflight | Actual write sent only after allowed preflight; diagnostic recipe distinguishes phases | L + B; selected H fixtures | M1 |
| HTTP-07 | Exposed versus unexposed pagination/ETag/Retry-After headers | Browser code does not depend on unreadable headers | H/L + B | M1 |
| HTTP-08 | Credentials allowed with explicit origin; wildcard mismatch; third-party cookie blocked | Login/session UX handles browser policy; no token leakage in URL fallbacks | L + B; controlled origins | M2 |
| HTTP-09 | `Vary: Origin` / language / encoding and personalized cache responses | One browser/origin/user does not receive another variant | L + B; controlled cache/proxy | M2 |
| HTTP-10 | Opaque `no-cors` response and manual redirect response | Application does not expect readable body/status for opaque responses | H/L + B | M2 recipe |
| HTTP-11 | CSP `connect-src`/`img-src`, mixed content, CORP/COEP and canvas tainting | Appropriate UI failure/fallback; application security policy remains enabled | Controlled application origins + B | M2 recipe |
| HTTP-12 | Resource timing available/hidden via Timing-Allow-Origin | Observability handles restricted timing without treating it as zero-duration success | H/L + B | M2 |

Credentialed CORS needs explicit allowed origins; third-party cookie policy can still block cookies. `Set-Cookie` cannot be made readable to browser JavaScript by adding it to exposed headers. CORS failure must be exercised cross-origin; omitting CORS headers on a same-origin route proves nothing. A failed preflight does not carry the arbitrary custom header values of the blocked request, so choose that scenario using the URL or preconfigured run. [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), [Fetch standard](https://fetch.spec.whatwg.org/), checked 2026-10-15.

## 7. Images, files, uploads, and downloads

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| FILE-01 | Placeholder image, unusual aspect ratio, missing alt data, transparent image | Stable layout, appropriate accessible text/fallback, intentional crop | H/L/I + B | M1 SVG and small bundled raster set; M2 richer media fixtures |
| FILE-02 | Slow image, 404 image, success HTTP status with undecodable image bytes | Lazy loading and `onError` fallback; no infinite fallback loop | H/L/I + B | M1 slow/404; M2 decode |
| FILE-03 | Responsive image candidates, high pixel density, blur placeholder | Correct image selected and placeholder removed; layout shift within application budget | H/L + B | M2 |
| FILE-04 | Multipart file and metadata; multiple files; empty file; Unicode filename | Correct request serialization and success metadata; local preview cleared as intended | L/I + B; bounded H metadata-only | M2 |
| FILE-05 | Size/type/count rejected; MIME/extension mismatch; 413/415/422 | Per-file error, preserved valid selections, clear retry policy | H/L/I + B | M2 |
| FILE-06 | Slow upload, abort, mid-upload disconnect, processing after upload | Distinguishes upload progress from server processing; cancellation and retry work | L + B/P; I semantic cases | M2 |
| FILE-07 | Download with filename, missing filename, UTF-8 filename, known/unknown length | Useful save name and progress state; object URLs cleaned up | H/L + B | M2 |
| FILE-08 | Download stream fails halfway; retry or resume with range | Partial artifact not presented as complete; deliberate retry/resume behavior | L + B/P; H bounded stream where supported | M2 |
| FILE-09 | Byte range 206, invalid range 416, seekable sample media | Download resume/media seeking and progress state | L + B; H only after host validation | M2 download ranges; M3 seekable media |
| FILE-10 | Expired signed-download fixture; metadata exists but blob unavailable | Refresh link or show recoverable missing-file state | L/I + B | M2 |
| FILE-11 | Resumable upload offsets, duplicate chunk, interruption, finalize conflict | Resume does not duplicate bytes; app restores pending upload state | L + B/P | M3 optional protocol recipe |
| FILE-12 | CSV/text/binary download, byte-order mark, escaping and embedded newlines | Export is valid for the chosen format and user-facing preview/download works | H/L + B | M2 |

A delayed upload response does not simulate slow request upload. Use a controlled server/proxy for transfer timing. Browser upload progress is exposed by APIs such as XHR's upload events; do not promise equivalent portable progress callbacks from every Fetch client. [XMLHttpRequest upload](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/upload), checked 2026-10-15.

## 8. GraphQL

GraphQL needs its own error model: request/validation errors, field execution errors, partial data, and non-null propagation. Do not return RFC 9457 as the normal GraphQL execution-error envelope. Keep transport-fault scenarios separate and select HTTP status/content type according to the chosen supported GraphQL-over-HTTP contract. [GraphQL response semantics](https://graphql.org/learn/response/), checked 2026-10-15.

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| GQL-01 | Query, variables, fragments, aliases and operation names | Correct operation and variable values; expected normalized cache identities | H/L/I + B | M2 |
| GQL-02 | Syntax/schema validation/variable coercion failure before execution | Request error shown; no assumed successful mutation or stale result | H/L/I + B | M2 |
| GQL-03 | Valid data plus field errors with path/extensions; nullable field fails | Usable data remains visible under the client's chosen error policy | H/L/I + B | M2 |
| GQL-04 | Non-null child failure bubbles to nullable ancestor/root | UI handles actual schema nullability; no invented arbitrary null placement | H/L/I + B | M2 |
| GQL-05 | HTTP transport error, non-JSON body, network failure | Transport and GraphQL errors are handled distinctly | H/L/I + B; P for transport faults | M2 |
| GQL-06 | Connection pagination, empty edges, cursor reset, omitted/optional total | Infinite scroll respects pageInfo and query identity | H/L/I + B | M2 |
| GQL-07 | Optimistic mutation, rejection, ID replacement, relation cache update | Optimistic layer removed correctly; normalized entities stay consistent | L/I + B | M2 |
| GQL-08 | Two operations share URL but differ in name/variables | Matcher and sequence scope do not mix unrelated operations | L/I + B | M2 |
| GQL-09 | Auth expiration during operation, field-level forbidden result | Correct refresh/error policy without exposing inaccessible data | L/I + B | M2 |
| GQL-10 | Incremental multipart result, delayed patch, patch error, abort | Supported client merges patches and closes loading state reliably | L + B; supported H/I adapters only | M3 experimental/compatibility-gated |
| GQL-11 | Subscription reconnect, duplicate event, schema/version mismatch | Recovery and event deduplication match chosen subscription protocol | L + B/I where supported | M3 |

Record GraphQL server/client versions and supported transport variants in recipes. Do not claim universal `@defer`/`@stream` or subscription compatibility across clients.

## 9. Streaming, live updates, and long-running work

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| LIVE-01 | SSE events with IDs/types, comment heartbeats, orderly end | Correct parsing, partial rendering and terminal state | H/L/I + B | M2 |
| LIVE-02 | SSE disconnect/reconnect with Last-Event-ID; replayed event | Resume at intended point; duplicate event does not duplicate UI item | L + B; I if adapter supports client behavior | M2 |
| LIVE-03 | NDJSON rows and malformed/incomplete final record | Earlier records remain usable; documented parse-failure handling | H/L/I + B | M2 |
| LIVE-04 | Arbitrary byte boundaries including split UTF-8 characters | Parser decodes across chunks; never assumes one chunk equals one event/row | L/I + B | M2 |
| LIVE-05 | Long pause, heartbeat, cancellation, total time limit | Timeout versus still-alive state, visible cancel, resource cleanup | H/L/I + B | M2 |
| LIVE-06 | Stream error before headers versus after first content | Distinct initial failure and interrupted partial-content experience | L/I + B; P for physical disconnect | M2 |
| LIVE-07 | AI-style tokens, metadata, finish reason, structured tool-result fixture | Incremental rendering and final completion; incomplete content is not treated as final | H/L/I + B | M2 generic fixtures |
| LIVE-08 | WebSocket handshake success/failure, normal close, abnormal disconnect | Connected/reconnecting/offline states and bounded retry | L + B/I supported adapter; H optional | M3 |
| LIVE-09 | WebSocket duplicate/out-of-order/stale message and sequence gap | Deduplicate, reorder or resynchronize according to app contract | L/I + B | M3 |
| LIVE-10 | Presence, typing, optimistic message acknowledgement, failed send | Pending/failed/delivered UI and cleanup when peers leave | L/I + B | M3 |
| LIVE-11 | Realtime permissions revoked, token expires, resubscribe | Unauthorized stream closes and protected data is removed | L/I + B | M3 |
| LIVE-12 | Slow consumer, event burst, queue full, reconnect after retention expires | Bounded memory, explicit overflow/reload behavior | L + B/P; I semantic queue | M3 |
| LIVE-13 | Polling replaces push, backoff, visibility pause/resume | Equivalent state without duplicate subscriptions or endless polling | L/I + B | M2 polling recipe |

Network/proxy buffering can merge chunks; exact byte-to-packet timing is not a hosted guarantee. Test parsers with deliberate chunk boundaries in-process and test progressive rendering separately over real HTTP. Native EventSource has its own reconnection/event framing semantics; use a different fetch-stream recipe when custom authorization headers are needed. [SSE guide](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events), checked 2026-10-15.

## 10. Browser lifecycle, SSR, service workers, and application integration

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| APP-01 | Server-side fetch and browser refetch use same run and initial fixture/revision | Matching initial/hydrated data; no unexpected duplicate request or data leak | L + application server + B; I for supported Node runtime | M1 example |
| APP-02 | SSR error, delayed server data, nested loading boundary | Correct shell/fallback/error boundary and progressive reveal | L + framework harness + B | M1 example |
| APP-03 | Static/build-time fetch versus dynamic request-time fetch | Build never depends accidentally on public uptime; fixtures are explicitly provided | L/I + framework harness | M1 recipe |
| APP-04 | Server data cache, browser HTTP cache and query cache configured independently | Revalidation hits intended layer; changing run cannot reuse another run's result | L + B/framework harness | M1 basics; M2 advanced |
| APP-05 | Service worker not ready, out of scope, updated, or disabled | Startup waits for chosen mocking mode; no accidental live request escape | I + B | M1 |
| APP-06 | PWA offline cache, queued write, reconnect, conflicting server state | Offline state and replay work without duplicate mutation | L + B; dedicated PWA test suite | M2 |
| APP-07 | Page reload, back/forward cache restore, background tab, multiple tabs | Correct refetch/session/polling policy and no leaked timers/subscriptions | L/I + B | M2 |
| APP-08 | Browser storage denied/full, persisted cache obsolete/corrupt | Recoverable fallback; no assumption API success guarantees local persistence | B storage harness | M2 recipe |
| APP-09 | Mobile viewport, touch, slow CPU, reduced motion, zoom | Loading/error UI stays usable; responsive layout and focus are stable | H/L/I + B | M1 examples |
| APP-10 | Client time/timezone/locale differs from server clock | Stable hydration and intended date/expiry behavior | L/I + B | M1 |
| APP-11 | Test aborts midway; next test starts concurrently | No leaked run, timer, worker handler, socket or shared state | L/I + B | M1 |
| APP-12 | Unhandled URL and disallowed external host | Strict test mode fails with actionable diagnostics instead of contacting production | L/I + B/harness | M1 |

Browser MSW cannot intercept a request issued by a separate Next.js/server process. Use a local HTTP base URL or a supported server-process adapter. Next.js extends server `fetch` with framework caching behavior, so each example must specify its cache settings and test under its declared development/production mode. [Next.js fetch reference](https://nextjs.org/docs/app/api-reference/functions/fetch), checked 2026-10-15.

Service workers require an appropriate secure/same-origin registration setup and scope. The app must host its worker; it cannot register an arbitrary worker from the public mock API's origin. Choose one interception owner per test suite: an MSW suite exercises MSW, while browser network-routing tests may disable service workers. Do not disable them in the suite intended to test the application's PWA behavior. [Service worker registration](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register), [Playwright networking and service workers](https://playwright.dev/docs/network), checked 2026-10-15.

## 11. Accessibility, localization, and security-related UI behavior

These are application assertions supported by fixtures; an API response alone cannot certify accessibility or security.

| ID | Fixture or behavior | Expected client assertion | Layer | Release |
|---|---|---|---|---|
| UX-01 | Long loading then success, retry failure and recovery | Status announcements are useful and not repeated excessively; keyboard focus remains intentional | H/L/I + B + manual assistive-tech check | M1 recipe |
| UX-02 | Multi-field validation and form-wide failure | Error summary, field association, focus movement, non-color cues | H/L/I + B | M1 recipe |
| UX-03 | Infinite scroll and live feed updates | Keyboard access, loading announcement, stable focus and explicit end state | L/I + B | M1 list; M2 live |
| UX-04 | RTL/long translations, currencies, plural forms, localized dates | Readable layout and correct semantics across selected locales | H/L/I + B | M2 |
| UX-05 | Images missing alt metadata or unavailable; video unavailable | Meaningful fallback without repeated/incorrect accessible text | H/L/I + B | M1 images; M3 media |
| UX-06 | Session expires with unsaved work; permission revoked mid-flow | Accessible prompt, safe navigation and input recovery policy | L/I + B | M2 |
| UX-07 | External link/redirect fields and HTML-like user content | Application obeys its navigation and sanitization policies | H/L/I + B | M1 inert fixtures |
| UX-08 | Duplicate or reordered entities under virtualized list | Stable accessible labels, selected row, keyboard target and reading order | L/I + B | M1 |

Automated accessibility checks should accompany representative examples, with manual checks for focus, announcement timing and screen-reader usability. Do not advertise automated checks as complete accessibility validation.

## What the public service can and cannot emulate

| Requested condition | Honest public behavior | Faithful test alternative |
|---|---|---|
| “Timeout” | Bounded response delay or an explicit 504 response; host/proxy limits still apply | Client deadline against a stalled local handler; browser abort; proxy socket timeout |
| DNS lookup failure or invalid certificate | Not controllable by an ordinary HTTP response from the valid public domain | Browser fixture/controlled DNS or TLS environment; local network lab |
| TCP reset, partial TLS record, broken HTTP framing | Provider and runtime often own the connection and may normalize failures | Controlled proxy/dedicated local server; do not equate an MSW rejection with wire-level proof |
| Offline device | The public server cannot turn off the user's connectivity | Browser offline mode or controlled network namespace |
| Failed CORS request | Can omit/reject CORS on a dedicated endpoint, observable only from another origin | Two-origin real browser test, with deliberate preflight configuration |
| Third-party cookie acceptance | Can set headers but cannot override browser privacy settings | Controlled HTTPS origins and supported-browser policy matrix |
| Slow upload | A delayed response only slows acknowledgement | Proxy/server throttling of incoming bytes plus actual browser upload client |
| Slow download | Bounded streaming; intermediaries may buffer or compress | Validate deployed behavior; local server/proxy for controlled transfer timing |
| React Suspense or lazy-code failure | API can supply delayed/rejected data | Supported Suspense integration or browser routing of actual application assets |
| Browser HTTP cache correctness | Server can supply cache directives | Real browser with interception disabled for cache assertions |
| Exact retries/ordered failures on shared demo URL | Stateless response or explicit attempt selector | Scoped local run and operation sequence |
| Shared persistent CRUD workflow | Public demo echo is not persistence | Local stateful run; authenticated ephemeral hosted run only if later implemented |

Toxiproxy is an example of an existing local TCP fault-injection tool; integrating recipes is more practical than building a new network emulator. Its transport-level scope is distinct from HTTP business fixtures. [Toxiproxy documentation](https://github.com/Shopify/toxiproxy), checked 2026-10-15.

## Scenario authoring and composition rules

Every recipe needs a stable ID, short user-facing description, release/support status, input fixture, match conditions, schedule/sequence, expected observable outcome, compatible adapters, and cleanup requirements. Diagnostics should say which layer is missing when a user asks a hosted HTTP endpoint for a transport-only fault.

Define one documented precedence rule for request controls, saved scenario configuration, and defaults. Validate controls before execution and reject incompatible combinations instead of silently choosing one. Examples: bodyless 204 with malformed-body mode, indefinite hang on the bounded public host, or a stateful sequence on a stateless URL.

Keep default responses realistic. Explicit fault recipes may violate application schemas or media types; transport violations require a capable adapter. Normal protocol behavior still applies to methods/statuses such as HEAD, 204, 304 and redirects. “Any status code” cannot mean “every status carries a JSON body.”

Cache keys must include every dimension that changes a cacheable public fixture. Stateful and fault-control responses should default to an appropriate non-shared cache policy; cache scenarios opt in deliberately. Per-origin CORS variants and user/run-specific data must not enter a shared anonymous cache accidentally.

## Release acceptance and example packs

M1a is ready when a developer can complete the hosted and local quick starts and the public demo passes its acceptance example. M1b is ready when a developer can copy one documented scenario into a component test, the same scenario into a local HTTP E2E test, and reproduce the relevant response semantics with no public-service dependency. Cross-adapter parity means matching supported observable behavior, not pretending identical network timing or browser enforcement.

| Example pack | Minimum scenario coverage | First release |
|---|---|---|
| Fetch basics and forms | Empty/data/error, malformed JSON, 204, abort, timeout, validation | M1 |
| Search and infinite list | Stale-response race, debounce, cursor reset, failed next page, last page | M1 |
| Optimistic editor/cart | Stateful CRUD, rollback, overlapping edits, conflict | M1 editor/domain conflict; M2 carts, conditional writes and idempotency/commit-loss |
| React Suspense / Next.js | Ordinary loading versus Suspense, nested boundary, SSR/browser shared run | M1 |
| Query-client integrations | TanStack Query or SWR baseline with explicit retry/cache settings | M1; add frameworks by demand |
| Accessible state gallery | Loading/empty/error/validation focus and announcements, long text, missing images | M1 |
| Session lifecycle | Expiry, refresh fan-out, logout race, forbidden state, tenant switch | M2 |
| GraphQL client | Partial error, null propagation, operation matching, pagination, optimistic cache | M2 |
| Files and streams | Progress/abort, unknown download length, split UTF-8, interrupted stream, SSE reconnect | M2 |
| Realtime and offline | Duplicate events, gap/reconnect, queued mutations, cross-tab conflict | M3; selected offline recipes in M2 |

For the toolkit itself, verify deterministic replay with reordered unrelated requests, parallel run isolation, reset during in-flight work, journal redaction, sequence exhaustion, cancellation/commit semantics, and no network escape in strict mode. Run real-browser tests for browser-only claims and local HTTP tests for transport-facing adapters. Validate unsupported capability errors as carefully as successful scenarios.

No implementation tests were run for this document: this task creates a plan only. The listed tests are future acceptance criteria, not claims of existing coverage.
