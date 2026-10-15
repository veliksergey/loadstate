# Loadstate

A fake REST API and scenario toolkit for building and testing front-end loading, error and data states.

**Status: pre-release, milestone M0.** Today there is one resource, users, served by a shared engine through a Node server, a Cloudflare Worker and an MSW adapter. The [project plan](docs/PROJECT-PLAN.md) describes what comes next.

Live demo, stateless: https://loadstate.veliksergey.workers.dev/v1/users?limit=2

## Requirements

- Node.js 22.12 or later; 24 is the reference version.
- pnpm 12.11.2, pinned in `package.json` through `packageManager`.

## Development

```sh
pnpm install
pnpm check                                   # lint, typecheck, build, test
pnpm smoke:pack                              # pack and use the packages from a fresh project
pnpm smoke:worker                            # run the Workers entry under local Wrangler
pnpm --filter @loadstate/server start        # after a build; PORT defaults to 4000
pnpm --filter @loadstate/server dev:worker   # the Workers entry, locally
```

The server listens on `127.0.0.1` only.

| Route | Result |
|---|---|
| `GET /healthz` | `{ "status": "ok" }` |
| `GET /readyz` | `{ "status": "ready" }` |
| `GET /v1/users?limit=20&offset=0` | `{ data, meta }` list; `limit` 1 to 100 |
| `GET /v1/users/:id` | One user, or 404 |
| `POST /v1/users` | Validates `{ name, username, email }` and answers 201 with `Location` |

The Node server is stateless: a create is validated and answered but not stored, and every `/v1` response carries `X-Mock-State: stateless`. `HEAD` mirrors `GET`, and other methods get 405 with `Allow`. Invalid input, unknown routes and server failures return RFC 9457 Problem Details.

## Use in tests

An engine created with `state: "memory"` stores creates until `reset()`, and can return scripted failures before normal responses. The same engine runs in-process, behind the Node server, or inside MSW:

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
