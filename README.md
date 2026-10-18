# Loadstate

A fake REST API and scenario toolkit for building and testing front-end loading, error and data states.

**Status: pre-release, milestone M0.** Today there is one resource, users, served by a shared engine through a Node server, a Cloudflare Worker and an MSW adapter. The [project plan](docs/PROJECT-PLAN.md) describes what comes next.

Live demo, stateless: https://loadstate.veliksergey.workers.dev/v1/users?limit=2

## Requirements

- Node.js 22.13 or later; 24 is the reference version.
- pnpm 12.11.2, pinned in `package.json` through `packageManager`.

## Development

```sh
pnpm install
pnpm check                                   # lint, typecheck, build, test
pnpm smoke:pack                              # pack and use the packages from a fresh project
pnpm smoke:worker                            # run the Workers entry under local Wrangler
pnpm --filter @loadstate/server start        # after a build; PORT defaults to 4000
pnpm --filter @loadstate/server dev:worker   # the Workers entry, locally
pnpm --filter @loadstate/core fixtures:generate   # regenerate the fixture pack
```

The server listens on `127.0.0.1` only.

| Route | Result |
|---|---|
| `GET /healthz` | `{ "status": "ok" }` |
| `GET /readyz` | `{ "status": "ready" }` |
| `GET /v1/:resource` | `{ data, meta }` list of `users`, `posts`, `comments`, `categories`, `products` or `todos`, with a `Link` header. Offset (`limit`, `offset`), page (`page`, `perPage`) or cursor (`pagination=cursor`, then `cursor`) pagination; `q` search; filters such as `status=active` or `priceMinor_gte=1000`; `sort=-createdAt,title`; `fields` and `expand` |
| `GET /v1/:resource/:id` | One record, or 404; `fields` and `expand` apply |
| `GET /img/600x400`, `GET /img/600` | A placeholder SVG; `text`, `bg`, `fg`, `seed` and `style` shape it |
| `GET /img/avatar/:name` | An initials or identicon avatar SVG; every image URL in the fixtures resolves here |
| `GET /v1/users/:id/posts` | A nested list with the same query rules; also `users/:id/comments`, `users/:id/todos`, `posts/:id/comments`, `comments/:id/replies`, `categories/:id/products` and `categories/:id/children` |
| `POST /v1/:resource` | Validates the body and answers 201 with `Location` and the record, server defaults filled in |
| `PUT /v1/:resource/:id` | Replaces the writable fields; omitted optional fields return to their defaults |
| `PATCH /v1/:resource/:id` | Changes only the fields sent |
| `DELETE /v1/:resource/:id` | 204 with no body, or 409 while other records refer to it |

The Node server is stateless: a write is validated and answered but not stored, and every `/v1` response carries `X-Mock-State: stateless`. `HEAD` mirrors `GET`, and other methods get 405 with `Allow`. Invalid input, unknown routes and server failures return RFC 9457 Problem Details. `docs/API-SPEC.md` lists each resource's search fields, filters, sort fields and expansions, and its writable fields, defaults, derived fields and structural rules.

```text
GET /v1/products?q=lamp&status=active&priceMinor_gte=1000&sort=-priceMinor&fields=id,title,priceMinor
GET /v1/posts?pagination=cursor&limit=10&sort=-publishedAt&expand=author
GET /v1/users?_mock.scenario=slow                  2 s delay, then the normal page
GET /v1/users/7?_mock.status=503                   503 with Retry-After, the route never runs
GET /v1/products?_mock.fixture=edge@1              the edge pack: long, RTL and emoji text, nulls, zeros
```

Every `/v1` route takes `_mock.*` simulation controls or their `X-Mock-*` headers: a delay, a status, a named scenario such as `maintenance` or `retry-then-ok`, a body fault, a fail rate and a fixture pack. `docs/API-SPEC.md` lists them all.

## Use in tests

An engine created with `state: "memory"` stores every write until `reset()`, and can return scripted failures before normal responses. The same engine runs in-process, behind the Node server, or inside MSW:

```ts
import { createEngine } from "@loadstate/core";
import { createHandlers } from "@loadstate/msw";
import { setupServer } from "msw/node";

const engine = createEngine({
  state: "memory",
  sequences: { "GET /v1/users/:id": [503, 503] }, // two failures, then normal responses
});
const server = setupServer(...createHandlers(engine, { baseUrl: "https://api.example.test" }));
server.listen({ onUnhandledFrame: "error" });
```

The packages are private until the first release.

## Documentation

- [Project plan](docs/PROJECT-PLAN.md)
- [API spec](docs/API-SPEC.md)
- [Technical decisions](docs/TECHNICAL-DECISIONS.md)
- [Front-end test scenarios](docs/FRONTEND-TEST-SCENARIOS.md)
- [Research](docs/RESEARCH.md)

## License

[MIT](LICENSE)
