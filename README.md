# Stellar Source Code Verification

Stellar Source Code Verification is a set of self-hostable services that verify
whether a Soroban contract's on-chain wasm was reproduced from a specific Rust
source package, and that serve those results over the read-only
[Contract Verification Registry API](stellar-protocol/ecosystem/sep-contract-verification-registry.md)
(keyed on the wasm hash, using the [SEP-58](https://github.com/stellar/stellar-protocol)
build/source vocabulary).

## Architecture overview

A small set of services that can be deployed independently or together:

1. **Compilation & Verification API** (`apps/api-verifier`) — stateless,
   compute-heavy. Runs `stellar contract verify` inside rootless
   Docker-in-Docker to reproduce a wasm from source and compare hashes. No
   database.
2. **Contract Verification Registry API** (`apps/api-registry`) — stateful,
   Node.js + Postgres. Implements the SEP endpoint
   `GET /wasms/:wasm_hash.json`, delegates the reproducible build to (1), and
   persists the results.
3. **OpenAPI / Swagger UI docs** (`apps/api-docs`) — a fully static Swagger UI
   site generated from the `api-registry` route annotations and published to
   GitHub Pages. No runtime server.

The registry never compiles or verifies on its own; it always delegates to the
Verification API and persists the result. This keeps the heavy
toolchain isolated from the database tier.

## Repository layout

This is a [pnpm](https://pnpm.io) workspace monorepo (`pnpm-workspace.yaml`).
Each service is a package under `apps/`:

| Path | Service | Port | Stack |
|------|---------|------|-------|
| `apps/api-verifier` | Compilation & Verification API | `8080` | `stellar contract verify` in rootless Docker-in-Docker |
| `apps/api-registry` | Registry API | `8081` | Express + Drizzle/Postgres |
| `apps/api-docs` | OpenAPI / Swagger UI docs | `8082` | Generated from `api-registry` annotations |
| `apps/*-cloudflare` | Cloudflare Workers deploy wrappers | — | Opt-in; wrap the matching service |

Postgres runs alongside on host port **5434** (to avoid clashing with a local
Postgres on `5432`/`5433`).

Packages use bare directory names, so `pnpm --filter` takes the directory:
`pnpm --filter api-registry <script>`.

## Getting started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose v2
  (`docker compose`, BuildKit enabled by default).
- For host-side development (optional): [Node.js](https://nodejs.org) 24+ and
  [pnpm](https://pnpm.io) (`corepack enable`).

### Run the full stack

From the repository root:

```bash
docker compose up --build
```

This builds and starts everything in the right order:

1. **postgres** — the database (host port `5434`).
2. **api-registry-migrate** — a one-shot job that applies the Drizzle
   migrations, then exits.
3. **api-verifier** (`http://localhost:8080`) — compilation & verification API.
4. **api-registry** (`http://localhost:8081`) — the registry API, started only
   after Postgres is healthy and the migration job has completed successfully.

No `.env` files are required — the compose file ships sensible dev defaults.

> **First build is slow.** `api-verifier` bundles a full toolchain and runs
> reproducible builds in a nested Docker daemon, so the initial build and first
> verification can be slow. Subsequent runs are cached and fast.

Once it's up, hit the APIs directly:

```bash
curl http://localhost:8080/   # api-verifier
curl http://localhost:8081/   # api-registry (latest-ledger probe)

# Look up the verifications held for a wasm hash:
curl http://localhost:8081/wasms/<wasm_hash>.json
```

### Stop

```bash
docker compose down       # stop the stack
docker compose down -v    # also wipe the database volume
```

### Develop a service outside Docker (optional)

Run the parts you're _not_ editing in Docker, and the one you _are_ editing on
the host. Install once at the root:

```bash
pnpm install
```

**Registry API (`api-registry`).** It needs Postgres + api-verifier reachable,
so start those first:

```bash
cp apps/api-registry/.env.example apps/api-registry/.env   # then edit as needed
docker compose up -d postgres api-verifier
pnpm --filter api-registry dev
```

(The defaults in `.env.example` expect Postgres on `localhost:5434` and
api-verifier on `localhost:8080`, matching the compose stack above.)

### Useful commands

Run from the repository root — each fans out across every workspace package:

```bash
pnpm test         # run all test suites (Vitest)
pnpm lint         # Biome lint + format check
pnpm format       # apply Biome fixes
pnpm typecheck    # type-check every package
pnpm build        # build every package
```

> The `api-registry` test suite talks to Postgres, so start it first:
> `docker compose up -d postgres`.

## API documentation

Interactive OpenAPI (Swagger UI) docs for the **Registry API** are published
live at:

**https://walnuthq.github.io/stellar-source-code-verification/**

The docs are generated from the `api-registry` route annotations by the
`api-docs` app and deployed to GitHub Pages. To preview them locally:

```bash
pnpm --filter api-docs dev   # serves the docs at http://localhost:8082
```

## Deployment

The services run anywhere Docker does — see the `Dockerfile` in each `apps/*`
service.

A [Cloudflare Workers](https://workers.cloudflare.com) deployment path is also
provided via dedicated, opt-in packages:

```bash
pnpm --filter api-verifier-cloudflare cf:deploy
pnpm --filter api-registry-cloudflare cf:deploy
```

These wrap the vendor-neutral services; deleting them removes Cloudflare with no
impact on the core apps. On push to `main`, a dedicated workflow per service
deploys it automatically — and only when that service is affected:

- `.github/workflows/deploy-api-verifier-cloudflare.yml`
- `.github/workflows/deploy-api-registry-cloudflare.yml`
- `.github/workflows/deploy-api-docs.yml` (publishes `api-docs` to GitHub Pages)

Each runs only when its own `apps/<service>/**` paths change, so an unrelated
change never redeploys every service. Each can also be triggered manually via
`workflow_dispatch`. The Cloudflare workflows require the `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

## License

MIT
