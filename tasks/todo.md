# Task list
- [x] 1 Scaffold + engine + tests (33 engine tests)
- [x] 2 DB migrations + RLS + audit chain + cross-tenant tests (migrations 001-012, 26 DB security tests)
- [x] 3 Kernel API (auth, TOTP, step-up, RBAC, idempotency)
- [x] 4 People-core API
- [x] 5 Flow approvals
- [x] 6 Time and leave
- [x] 7 Pay runs
- [x] 8 Service, assistant, insight, platform
- [x] 9 Web UI (17 pages, driven end to end in a headless browser; screenshots in docs/screenshots)
- [~] 10 Security pass, docs, CI, push: dependency audit clean, SECURITY.md, THREAT_MODEL.md, README, Dockerfile, CI written. Docker image not built locally (no daemon); CI workflow not yet run on GitHub at time of writing.

## Not done (staged, see docs/SPEC.md section 8)
Rust/WASM engine, edge workers, Go bridge, mobile apps, passkeys, OIDC/SAML, SCIM, MCP OAuth, Drive/SharePoint connectors, talent and rewards, other countries, email delivery, leave proration, web unit tests, independent RLS review, UAE pack review (L0), bank WPS validation.
