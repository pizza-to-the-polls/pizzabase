# Agent Notes for pizzabase

This is the backend API for Pizza to the Polls. It runs as an AWS Lambda (via `serverless-http`) in production and as a plain Express server on port 3000 during local development.

## Tech Stack

| Layer       | Technology                                                               |
| ----------- | ------------------------------------------------------------------------ |
| Framework   | Express.js (v4)                                                          |
| Language    | TypeScript (~5.9) with `esModuleInterop: true`                           |
| ORM         | TypeORM 0.3 (`DataSource` API)                                           |
| Database    | PostgreSQL locally / Aurora Serverless (`aurora-postgres`) in production |
| Deployment  | Serverless Framework v4 → AWS Lambda                                     |
| Tests       | Jest 30 + ts-jest + node-mocks-http                                      |
| Lint/Format | TSLint + Prettier 2.1.2                                                  |

## Two Entry Points

| Mode          | File            | How it's started        | TypeORM config                   |
| ------------- | --------------- | ----------------------- | -------------------------------- |
| **Local dev** | `src/index.ts`  | `npm run dev` (nodemon) | `devConfig` in `data-source.ts`  |
| **Lambda**    | `src/lambda.ts` | `serverless deploy`     | `prodConfig` in `data-source.ts` |

### Lambda handler pattern (critical — do not break)

```ts
let handler;
const handlerPromise = (async () => {
  await initializeDataSource();   // DB connects ONCE
  handler = serverless(default as any);
  return handler;
})();

module.exports.handler = async (event, context) => {
  const resolvedHandler = await handlerPromise;
  return await resolvedHandler(event, context);
};
```

The handler promise is created at cold start and **reused across warm invocations**. The DB connection must survive the container lifetime. Never re-create the DataSource inside the per-request handler.

## Test Architecture (hoisted, Lambda-matching)

The test suite is architected to behave like a long-lived Lambda container — read this section carefully before modifying anything.

### Shared-connection model

- `jest.config.js` sets **`maxWorkers: 1`** — all test files share one Node process
- `src/tests/dbHelper.ts` is a **module singleton** — `setUpDB()` is a no-op after first `initializeDataSource()` call
- `closeDB()` is a **no-op** — connections are never destroyed (parallels Lambda)
- `npm test` includes **`--forceExit`** so Jest exits despite the open DB pool

### Two test layers

| Layer           | Files                                         | What they test                                                                  |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| **Unit**        | `src/controller/*.test.ts`                    | Controller methods in isolation via `new Controller().action(req, res, next)`   |
| **Integration** | `src/tests/integration/*.integration.test.ts` | Full Lambda path: `API Gateway event → serverless-http → Express → routes → DB` |

### Integration test adapter

Use `src/tests/testLambdaHandler.ts` helpers (`lambdaGet`, `lambdaPost`, `lambdaPut`, `lambdaDelete`) to send requests through the production code path. The Express app is imported **dynamically** inside the `getHandler()` promise so that `jest.setup.ts` has time to set env vars before `app.ts` reads them.

### Test DB config (`data-source.ts`)

```ts
// testConfig (NODE_ENV=test)
type: "postgres",
dropSchema: true,
synchronize: true,   // schema auto-created from entities
```

Production uses `synchronize: false` + migrations. Local dev should too — run `npm run migration:run` to apply schema changes.

## File Quick Reference

| File                                    | Purpose                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| `src/index.ts`                          | Local dev entry point (Express + port 3000)                          |
| `src/lambda.ts`                         | AWS Lambda entry point (serverless-http wrapper)                     |
| `src/app.ts`                            | Express app (routes, middleware, CORS, body-parser)                  |
| `src/routes.ts`                         | Route table → controller mapping                                     |
| `src/data-source.ts`                    | Typed `DataSource` with dev/test/prod configs                        |
| `src/tests/dbHelper.ts`                 | Singleton test DB helper (hoisted connection)                        |
| `src/tests/jest.setup.ts`               | `beforeAll` → `setUpDB()`, `afterEach` → `cleanAll()`, NO `afterAll` |
| `src/tests/testLambdaHandler.ts`        | Lambda integration test adapter (dynamic app import)                 |
| `src/tests/integration/`                | Full-stack Lambda-path smoke tests                                   |
| `src/tests/factories.ts`                | Test data builders                                                   |
| `src/controller/NameController.test.ts` | Unit tests for each resource                                         |
| `src/controller/helper.ts`              | `findOr404`, `isAuthorized`, `checkAuthorization`                    |
| `src/lib/validator/`                    | Input validation + address geocoding                                 |
| `src/lib/stripe.ts`                     | Stripe Checkout sessions + webhook processing                        |
| `src/lib/mailgun.ts`                    | Mailgun.js email sending                                             |
| `src/lib/zapier.ts`                     | Zapier webhook notifications                                         |
| `src/migration/`                        | TypeORM migration files (runs on deploy via CI)                      |

## Environment Variables

### Required for local dev

```
POSTGRES_USERNAME=postgres
POSTGRES_DB=pizzabase        (or pizzabaseTest for tests)
POSTGRES_PASSWORD=           (if needed)
POSTGRES_PORT=5432           (optional, default)
```

### Required for production / Lambda

```
NODE_ENV=production
DB_NAME=pizzabase
AURORA_RESOURCE_ARN=arn:aws:rds:...
AURORA_SECRET_ARN=arn:aws:secretsmanager:...
AWS_REGION=us-west-2
STRIPE_SECRET_KEY=sk_...
STRIPE_PRODUCT_ID=price_...
STRIPE_SECRET_WH=whsec_...
ALLOWED_ORIGINS=polls.pizza,localhost
STATIC_SITE=https://polls.pizza
JWT_SECRET=...
BUGSNAG_KEY=...
ZAP_NEW_REPORT=...
... (other Zapier hooks)
```

### Local `.env` example

```
ALLOWED_ORIGINS=polls.pizza,localhost
STATIC_SITE=http://localhost:3333
POSTGRES_USERNAME=postgres
POSTGRES_DB=pizzabaseTest
GOOGLE_MAPS_KEY=...
STRIPE_SECRET_KEY=sk_test_...
JWT_SECRET=dev-secret
```

## Important Conventions

1. **Always run `npm run fix` before committing.**
   This runs prettier + tslint --fix. The CI workflow enforces both. Prettier version in `package-lock.json` is 2.1.2 — if your local install differs, use `npx prettier@2.1.2` for formatting parity.

2. **Tests must not destroy the DataSource.**
   `jest.setup.ts` intentionally has no `afterAll`. Adding `AppDataSource.destroy()` will break all test files after the first one.

3. **Controller methods return values, not Express responses.**
   `app.ts` wraps each controller call and auto-`res.send()`s the return value. Controllers should return plain objects or `void`. They never call `res.json()` themselves.

4. **Webhooks use raw body-parser.**
   `POST /webhook` is mounted with `bodyParser.raw({ type: "*/*" })` before the JSON parser. This is required for Stripe signature verification. The route is registered first in `routes.ts`.

5. **TypeORM 0.3 API — old patterns are gone.**

   - Old: `createConnection()`, `getConnection()`, `getRepository(Entity)`
   - New: `AppDataSource.initialize()`, `AppDataSource.getRepository(Entity)`
   - `findOne()` now **requires** an options object: `findOne({ where: { id: 1 } })`
   - `countBy()` replaces `count()` in some contexts (used in `Location.mergeInto`)

6. **Default imports required for CommonJS modules.**
   `esModuleInterop: true` is enabled. Use `import serverlessHttp from "serverless-http"` not `import * as serverlessHttp`. This applies to `express`, `cors`, `body-parser`, `serverless-http`, `mailgun.js`.

7. **Migrations run as a separate deploy step.**
   The CI workflow calls `npm run migration:run` after `serverless deploy`. The Lambda handler sets `migrationsRun: false` so migrations don't block cold starts.

8. **Never use `synchronize: true` in production.**
   `prodConfig` has `synchronize: false`. Schema changes must go through `src/migration/` files.

## Common Tasks

### Start local dev server

```bash
npm run dev          # Express on :3000, nodemon hot reload
```

### Run tests

```bash
npm test             # All suites (14 suites, ~90 tests)
npm test -- --testPathPattern=integration   # Just integration tests
npm test -- --testPathIgnorePatterns=integration  # Just unit tests
npm run test:watch   # Watch mode
```

### Connect to local DB

```bash
psql -U postgres -d pizzabase
```

### Run a migration

```bash
npm run migration:run
```

### Generate a migration (after entity changes)

```bash
npx typeorm-ts-node-commonjs migration:generate -d src/data-source.ts NameOfMigration
```

### Sync schema (local dev only — NOT prod)

```bash
npm run schema:sync
```

### Run prettier/lint

```bash
npm run prettier     # check
npm run prettier:fix # write
npm run lint         # check
npm run lint:fix     # auto-fix
npm run fix          # prettier:fix + lint:fix
```

### Test Lambda locally

```bash
npx serverless offline    # API on :3002
```

## CI Pipeline

`.github/workflows/test.yml`:

```
1. checkout
2. npm install
3. npm run prettier
4. npm run lint
5. npm run test   (with Postgres service container)
```

`.github/workflows/deploy.yml`:

```
1. needs: test (must pass)
2. npm install --include=dev
3. serverless deploy --stage prod|dev
4. npm run migration:run
```

## Relationship to polls.pizza

This repo is the backend for the StencilJS frontend at `polls.pizza`. The frontend calls this API via `fetch` to `PIZZA_BASE_DOMAIN` (default: `https://base-next.polls.pizza`).

Key API surface:

- `GET /totals`, `GET /orders`, `GET /locations/:id`, `GET /trucks`
- `POST /report` — create a line report
- `POST /donations` — create Stripe checkout session
- `POST /webhook` — Stripe webhook handler
- `POST /session`, `PUT /session` — admin JWT auth

## Traps for the Unwary

- **CORS origin** is evaluated at **module load time** in `app.ts`. The `ALLOWED_ORIGINS` env var must be set before any test imports `app.ts` or the Lambda handler. The integration test adapter handles this via dynamic import.
- **DB connection errors on tests?** Check `NODE_ENV=test` and `POSTGRES_DB=pizzabaseTest`. The `.env` file at repo root may have `NODE_ENV=production` from a previous developer and will override the test config.
- **`npm install` may need `--legacy-peer-deps`** because `serverless-domain-manager@5` has a peer-dep constraint on `serverless<4`.
- **Aurora Data API driver** cannot be fully tested locally. The driver version was bumped from v1 to v3 — if production behaves differently, check the driver's changelog for breaking changes around `formatOptions.castParameters`.
- **AWS SDK v2 deprecation warnings** are noisy but non-blocking. Migration to v3 is a future concern.
