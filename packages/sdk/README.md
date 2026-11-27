# @meridian/sdk

Apache-2.0 typed client generated from the Meridian `/api/v1/openapi.json` route registry. Runtime dependencies are zero: the client uses the host's `fetch` implementation.

Run `pnpm sdk:generate` from the repository root after an OpenAPI change. The generator reads `openapi.json` and writes `src/generated.ts`; CI should fail if a fresh generation changes that file. `ApiClient` supports `X-Api-Key` authentication and forwards `Idempotency-Key` for mutating calls. API errors preserve the platform's `{ error: { code, message, details?, request_id? } }` shape.

This package is prepared for publication but is not published. A release owner must run the package's build, drift check, and integration smoke test against staging before publishing.
