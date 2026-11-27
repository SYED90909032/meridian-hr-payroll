# Changelog

All notable changes to Meridian are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

Each entry says **what** changed, **where** (file path) and, for UI work, **which Spike Admin source** it was modelled on, so a future developer can trace any visual decision back to its reference.

## [Unreleased]
### Production-readiness programme (branch `feat/production-readiness`)
Follows `docs/production-readiness-blueprint.md` phase by phase. Progress is tracked in `docs/production-readiness-progress.md`; decisions and their working defaults in `docs/DECISIONS.md`. Each phase below records **what** changed, **where**, **why/approach**, **how it was verified** and **known limits**. The non-negotiables (fixed route pipeline, forced RLS, append-only audit chain, content-hash-bound approvals, field encryption with crypto-erasure, the L2 live-payment gate) are not weakened by any phase.
#### Phase 0 and foundations
- **Decisions log** (`docs/DECISIONS.md`): the eight open questions from blueprint section 15 are recorded with the working default each is being built on, and which need the owner or an outside party. Nothing is marked confirmed that was not.
- **Object storage port** (`apps/api/src/storage/`, ADR-025): `ObjectStore` interface (`put`, `get`, `head`, `delete`, `list`, `presignGet`), a `local` filesystem backend and an `s3` backend for any S3-compatible service. `put(..., { overwrite: false })` is write-once, enforced by the service with `If-None-Match: *`. Keys are validated and cannot escape the root. Config: `OBJECT_STORE`, `OBJECT_STORE_DIR`, `S3_*`. Exposed to code as `svc.objects`.
  - Verified: 15 contract tests run against the local backend and against S3 (`moto`, a wire-compatible AWS stand-in), including write-once, prefix isolation and presigned downloads. Not yet run against real AWS S3 or R2.
- **Test-infrastructure helper** (`apps/api/test/infra.ts`): integration tests that need Redis, S3/KMS (moto), SMTP or ClamAV skip when the service is absent locally, and fail when `REQUIRE_INFRA=1` (CI), so a green pipeline cannot mean silently skipped.
- **Dependencies added for later phases**: AWS SDK (S3, KMS, presigner), nodemailer, @simplewebauthn/server, openid-client, ioredis, prom-client, ssh2, OpenTelemetry API/SDK. `pnpm-workspace.yaml` records that `ssh2`, `cpu-features` and `protobufjs` need no install scripts.
#### Phase 1 - KMS custody, envelope rotation, RLS review pack, and off-box seals
- **Provider-backed key custody** (`apps/api/src/crypto/kms.ts`, `apps/api/src/crypto/secrets.ts`, `apps/api/src/config.ts`, `.env.example`, ADR-023): added local/test and AWS-KMS-compatible providers, deployment-bound encryption context, wrapped-master boot, and a secret-store port. Production refuses the local provider; env-backed secrets remain a loud warning unless `REQUIRE_SECRET_MANAGER=true`. Verified by typecheck and provider tests against the local implementation/moto where available. Real AWS KMS and Secrets Manager were not run.
- **Versioned envelope hierarchy** (`apps/api/migrations/013_key_hierarchy.sql`, `apps/api/src/modules/people/lib.ts`, `apps/api/src/crypto/key-rotation.ts`, `apps/api/src/cli/keys.ts`): added versioned tenant envelopes, random subject DEKs, v0 HKDF compatibility, resumable `keys:upgrade`, and tenant/master re-wrap primitives. Field ciphertext is not re-encrypted. Rotation was exercised against the isolated PostgreSQL test database; a staging drill remains external.
- **RLS review tooling** (`apps/api/migrations/013_key_hierarchy.sql`, `apps/api/migrations/014_legal_hold_erasure.sql`, `apps/api/src/cli/review-rls.ts`, `docs/reviews/rls-review-pack.md`): catalog-driven matrix generation and runtime-role/forced-RLS evidence now cover every table with `tenant_id`, including audit and session tables through narrow owner/auth policies. Existing attack tests remain the evidence for tenant and restricted-class threats. The independent review has NOT happened.
- **Off-box audit seals** (`apps/api/src/modules/audit/seals.ts`, `apps/api/src/modules/audit/routes.ts`): every seal writes a write-once JSON record and public key to `ObjectStore`; reconciliation reports missing, mismatched, and extra records and audits drift. Local storage and S3-compatible moto tests cover tamper/deletion detection; real AWS/R2 was not run.
- **Legal hold enforcement** (`apps/api/migrations/014_legal_hold_erasure.sql`): added a database trigger so owner-level updates cannot shred a subject under an unreleased hold. API and database tests cover refusal and release. No separate retention-policy table was added because it would not be enforceable by the existing data model.
- **Runbook** (`docs/runbooks/key-rotation.md`): records operator commands, verification, emergency revoke, rollback constraints, and secret-handling limits.
#### Phase 2 - UAE assurance gate and parallel evidence
- **Evidence-gated assurance** (`apps/api/migrations/015_pack_signoff.sql`, `016_assurance_parallel.sql`, `apps/api/src/cli/pack-signoff.ts`, ADR-027): owner-only sign-off records are keyed to the exact pack hash; the database trigger requires named review, golden-vector hash, bank acceptance reference, and two distinct completed zero-unexplained parallel runs matching that pack identity. The CLI records/status-checks/promotes but never bypasses the trigger. Verified against PostgreSQL 16 in `test/p2gate-gate.test.ts` (6 tests); the shipped registry remains L0. No external evidence is present.
- **Parallel-run harness** (`apps/api/src/modules/pay/parallel.ts`, `apps/api/src/modules/pay/routes.ts`): strict integer CSV import, exact gross/deductions/net and line comparison, per-employee variance reporting, explained-variance recording, audit events, new `pay.parallel` permission, and forced-RLS tenant tables. Verified against the assigned PostgreSQL database in `test/p2gate-parallel.test.ts` (3 tests), including role and cross-tenant denial.
- **SIF self-check and bank transport ports** (`packages/engine/src/sif.ts`, `apps/api/src/modules/pay/bank/`, `apps/api/test/p2gate-bank-transport.test.ts`): structural SIF reconciliation plus manual and host-key-pinned key-authenticated SFTP transports, with bank submission queued only after `payment_released`. Engine tests run locally with 36 passing tests; the six transport tests run against PostgreSQL 16 and an in-process `ssh2` server. SIF checks are self-checks only and no bank has validated a file; the SFTP transport is verified only against that in-process SSH server, not a real bank, and remains blocked on external bank credentials/sandbox validation.
- **Review and operations documentation** (`docs/reviews/uae-pack-review-pack.md`, `docs/runbooks/live-payroll-gate.md`): every current UAE parameter/rule is listed with its source/status, and external evidence/rollback steps are explicit. Blocked: external — no reviewer sign-off, bank acceptance, or real employer parallel run.
#### Phase 4 - Payroll and time completeness
- **Deterministic edge cases** (`packages/engine/src/contracts.ts`, `packages/engine/src/calc.ts`, `packages/engine/src/packs/uae.ts`, `apps/api/src/modules/pay/inputs.ts`): added 30-day-basis proration, valid-time compensation segments with per-line explanations, contractor/statutory guards, contract notice days, and an off-cycle adjustment-only input path. The UAE pack is version `0.2.0` and remains L0; modified statutory behavior is still reviewer-gated. Verified with 37 engine tests, including integer golden vectors and property coverage, against the in-process TypeScript engine. Known limit: no payroll/legal reviewer or parallel-run diff has been completed.
- **Time attribution** (`apps/api/src/modules/time/attendance.ts`, `apps/api/src/modules/time/routes.ts`): overnight punches are evaluated across midnight and bucketed by configurable local shift start/end date, defaulting to start in `Asia/Dubai`; neighboring dates are recomputed after punch ingest. Verified by 11 API unit tests using UTC+4 arithmetic. Known limit: this proves deterministic local-time handling, not an external attendance vendor integration.
- **Run integrity** (`apps/api/migrations/021_phase4_payroll.sql`, `022_phase4_guards.sql`, `apps/api/src/modules/pay/service.ts`, `routes.ts`): one-off adjustments are claimed by one locked run; reversals create a linked compensating run with equal/opposite lines while original payslips remain frozen; reversal chains are rejected by service and database guards. Verified by the existing payroll API lifecycle tests (18 tests against isolated PostgreSQL `meridian_test_p4pay`) and migration application. Known limit: bank reconciliation and reviewer approval remain external.
- **Settings and evidence** (`apps/api/src/modules/pay/routes.ts`, `apps/api/src/modules/people/routes.ts`, ADR-026, `docs/reviews/phase4-rules-for-reviewer.md`): added audited, strict-schema controls for contractor payroll and leave encashment (both off by default), contract notice-day data, overnight setting, and the Phase 4 reviewer pack. No live-payment gate was changed; L2/L3 is still required.
#### Phase 6/8 - Platform API and assistant hardening
- **API keys and webhooks** (`apps/api/migrations/024_platform_hardening.sql`, `apps/api/src/modules/platform/`, `apps/api/src/http/route.ts`, `apps/api/src/app.ts`): added explicit write opt-in with the documented `people.write`/`leave.admin` allow-list, bounded expiry and expiry-warning list field, per-key Fastify rate-limit buckets, owner-managed webhook destination allow-lists checked at creation and delivery, and worker retention through a least-privilege database function. Verified with API integration tests and real PostgreSQL; provider delivery remains stubbed in tests.
- **SDK** (`packages/sdk/`): added Apache-2.0 zero-runtime client, OpenAPI snapshot and deterministic generator/drift test. Verified with strict TypeScript build and generated-file reproducibility. The package is not published.
- **Assistant gateway** (`apps/api/migrations/025_assistant_gateway.sql`, `apps/api/src/modules/assistant/gateway.ts`, `apps/api/src/modules/assistant/routes.ts`, `apps/api/test/assistant-eval/`, `docs/privacy/assistant-data-flow.md`): added owner consent/version audit, model allow-list, timeout/size caps, DLP scrubbing/refusal, deterministic fallback, hostile-input corpus and grounded source counts; updated the UI without changing chat layout/scrolling. Stub-model/provider and legal/privacy review remain external limits.
- **Design documents** (`docs/adr/029-platform-api-and-assistant-gateway.md`, `docs/adr/032-assistant-gateway.md`, `docs/webhooks.md`, `docs/mcp-server-design.md`): recorded implementation decisions, receiver guidance and staged read-only MCP scope.
#### Phase 3a - communications and account lifecycle
- **Email/SMS outbox delivery** (`apps/api/src/modules/comms/providers.ts`, `apps/api/src/modules/platform/delivery.ts`, `apps/api/src/worker.ts`, migrations `017_communications.sql` and `018_mfa_policy.sql`): added SMTP, Postmark, log-only mailers, Twilio and log-only SMS behind provider interfaces. The worker stores provider message ids, deduplicates through outbox keys, retries transient failures with backoff and permanently records invalid/suppressed recipients. Production refuses log providers and missing required credentials. Verified by the full API suite and the focused SMTP adapter test against an in-process `smtp-server`; no real provider was used.
- **Invitations and password recovery** (`apps/api/src/modules/iam/account-recovery.ts`, `apps/api/src/modules/iam/routes.ts`, `apps/api/src/modules/comms/routes.ts`, `apps/api/test/comms.test.ts`): removed temporary-password responses, added invited membership state, uniform forgot-password responses, expiring purpose-bound tokens, session revocation and password-changed notices. Raw tokens are encrypted only in outbox payloads; SHA-256 hashes are stored in `kernel.account_token`, and atomic consumption is single-use. Password checks include local policy and HIBP range k-anonymity; tests use a fake/unreachable HIBP endpoint and assert no password appears in invite responses. The original 400s were test fixture passwords containing the forbidden substring `password`, not URL encoding or token extraction; fixtures now use compliant passphrases without weakening validation.
- **Transactional notifications and tenant MFA policy** (`apps/api/src/modules/flow/notify.ts`, `apps/api/src/http/route.ts`, `apps/web/src/App.tsx`, `apps/web/src/pages/Auth.tsx`, `apps/web/src/pages/Access.tsx`, `apps/web/src/pages/Security.tsx`): notification events enqueue safe deep links in the same transaction, preferences default on and security mail cannot be disabled, and selected tenant roles can be required to enrol TOTP. A notification UUID is generated before insert to preserve recipient-only RLS (avoiding `INSERT ... RETURNING` on a row the actor cannot read). Verified by the 7-test comms group and the full API suite.
- **Documentation** (`docs/adr/024-communications-and-account-recovery.md`, `docs/runbooks/email-deliverability.md`, `docs/SECURITY.md`, `docs/THREAT_MODEL.md`, `docs/SPEC.md`): recorded the decision, operator-owned SPF/DKIM/DMARC/provider steps, suppression handling and updated security/capability claims. DNS, provider reputation and real mailbox delivery remain external follow-ups.
### Fixed
- **Assistant chat box** (`pages/Assistant.tsx`, `styles.css`): sending a message no longer scrolls the whole page down. The auto-scroll used `scrollIntoView`, which also scrolled the window; it now scrolls only the message list (`.chat-body`). The box height fits the space left on screen, recalculated on resize with a 340px minimum, so the input row always stays visible. `.chat-body` has `min-height: 0` and `overscroll-behavior: contain`.
## [0.2.1] - 2026-11-27 - UI review fixes (calendar, activity filter, theme animation, spacing)
Front-end only (`apps/web`). No change to the API, engine, routes, permissions or calculations.
### Added
- **Animated dark/light switch**: `src/theme/themeReveal.ts`. It ports the user-supplied `applyTheme` / `themeRevealPath` (cojeev ThemeToggle) without the `motion` dependency. The new theme spreads out from a random edge zone as a 12-lobe organic blob, driven by the View Transitions API: 1.2-1.38 s, `cubic-bezier(.42,0,.18,1)`. It switches instantly if the browser lacks the API or the user prefers reduced motion. Scrolling or resizing ends it early. `ThemeRoot.toggleMode` wraps the state change in `flushSync` so the snapshot is taken after React commits.
- **Sun/moon toggle glyph**: `src/theme/ThemeToggleIcon.tsx`. It morphs between sun and moon with staggered rays. The header button is now `role="switch"` with the label "Dark mode".
- **Calendar date picker**: `src/DateInput.tsx`. A Spike-styled popover calendar with day, month and year views, Monday-first weeks, Today/Clear and min/max limits. It is fully keyboard-driven (arrows, PgUp/PgDn, Home/End, Enter, Esc). It replaces the native `date`, `month` and `datetime-local` inputs in Employee, Leave, Payroll, People and Time. Values keep the exact native string format (`YYYY-MM-DD`, `YYYY-MM`, `YYYY-MM-DDTHH:mm`), so API payloads are unchanged. A hidden native input still enforces `required`. Time-only fields stay native.
### Fixed
- **Activity log filter** (`pages/Audit.tsx`). The free-text action-prefix box looked like a broken filter. It is now an "Activity type" select grouped by area, mapped to the same API `action` prefixes, and it applies immediately. A search box narrows the loaded rows by who, action or subject. Clear resets both.
- **Spacing** (`styles.css`):
  - Banners no longer touch the card above them (Leave team requests, Webhooks).
  - Hand-written `.card-b` bodies get the card padding, which fixes the clipped "L0 means unreviewed" footnote in Payroll Controls.
  - Paragraphs followed by a button, banner or chip get 12px of space.
  - Form rows align to the top, which fixes the misaligned Type/Mode fields in "Start a pay run".
- **Chips** (`ui.tsx`, `styles.css`):
  - Adjacent chips get a gap (Access roles, webhook events).
  - `Chip` no longer capitalises text by default, so identifiers such as `employee.created` show as written. `StatusChip` opts in through `capitalize`.
  - The Access roles cell keeps a 240px minimum width on phones.
- **Dashboard chart** (`pages/Dashboard.tsx`): the headcount chart has a minimum width so it never draws a negative-width `<rect>` before it is measured.

## [0.2.0] - 2026-11-27 - Spike Admin UI redesign

Branch `ui/spike-redesign`. Front-end only (`apps/web`). **No change** to `apps/api`, `packages/engine`, the database, any API call, route, permission check or calculation.

Rollback point: branch `backup/pre-spike-ui` and tag `v0.1-pre-spike-ui` (commit `23848ae`).
Decision record: [ADR-022](docs/adr/022-ui-spike-admin-design-system.md) (supersedes ADR-020).

### Added

**Design system foundation**
- `apps/web/src/theme/tokens.ts`: Spike design tokens in one place: palette (primary `#0085DB`), radius 18 (cards) and 9 (inputs), card/dropdown shadows, layout sizes (sidebar 270 / mini 87, header 70, content max 1200) and `onTint` text colours that pass WCAG AA on tinted backgrounds. *Source: Spike `src/theme/*` (LightThemeColors, DarkThemeColors, Shadows, Typography).*
- `apps/web/src/theme/createAppTheme.ts`: MUI v7 theme for light and dark mode, plus component overrides (Card, Button, Chip, TextField, Tabs, Dialog, Table, Alert). *Source: Spike `src/theme/Components.tsx`.*
- `apps/web/src/theme/mui-augment.d.ts`: TypeScript augmentation for `theme.tokens`.
- `apps/web/src/theme/ThemeRoot.tsx`: provides the theme, persists the light/dark choice (`localStorage: meridian:color-mode`, defaulting to the OS preference) and publishes `--sp-*` CSS variables so the existing class-based markup follows the theme. Exposes `useColorMode()`.
- Plus Jakarta Sans font (400/500/600/700) via `@fontsource`, matching Spike typography.

**Icons**
- `apps/web/src/icons/SolarIcon.tsx`: offline Solar "line-duotone" icons (the same set Spike uses), with no CDN calls at runtime.
- `apps/web/scripts/build-solar-subset.mjs`: scans `src/` for `"solar:*"` literals and writes `src/icons/solar-subset.json`, so only the icons in use are bundled. It runs automatically before `dev`, `build` and `typecheck`, and as a Vite plugin during dev. **Rule:** icon names must be string literals so the scanner can find them.

**Application shell** (replaces the old `Shell` in `App.tsx`)
- `apps/web/src/layout/FullLayout.tsx`: page frame with the same redirects, approvals badge (`GET /insight/overview`) and two-step-verification warning as before. *Source: Spike `layouts/full/FullLayout.tsx`.*
- `apps/web/src/layout/Sidebar.tsx`: a floating 270px card on desktop (≥1200px) that collapses to an 87px icon rail (state saved in `meridian:sidebar-mini`). Below 1200px it becomes a slide-in drawer. Includes a profile card with sign-out. *Source: Spike `layouts/full/vertical/sidebar/*`.*
- `apps/web/src/layout/navConfig.ts`: navigation groups built from the **same** permission checks as before (`buildNav(can)`).
- `apps/web/src/layout/Header.tsx`: sticky 70px header with quick page search, light/dark toggle, notifications menu (`GET /flow/notifications`, `POST /flow/notifications/read`) and a profile menu. *Source: Spike `layouts/full/vertical/header/*` (Search, Notifications, Profile).*
- `apps/web/src/layout/Logo.tsx`: Meridian mark and wordmark.

**Profile pictures**
- `apps/web/public/images/avatars/avatar-1…8.png`: the 8 supplied portraits, cropped to 256×256 PNG.
- `apps/web/src/avatars.ts`: avatar catalogue and a small reactive store (`useAvatar`, `setAvatar`).
- `AvatarPicker` in `ui.tsx`, used in:
  - **Create workspace** (Register): optional picture for the owner.
  - **Add person** (People): optional picture for the new employee.
  - **Employee profile**: the pencil button on the header avatar (shown to the person themself or anyone with `people.write`).
  - **Header → Change picture**: for the signed-in user.
- Illustrations from Spike: `public/images/auth/auth-hero.png`, `auth/error-illustration.png` and `dashboards/welcome-illustration.png`.

**Documentation**
- `docs/adr/022-ui-spike-admin-design-system.md` and this changelog.

### Changed

- `apps/web/src/ui.tsx`: every shared primitive was rebuilt on MUI with the **same exports and props**, so no page logic had to change:
  - `PageHead` is now the Spike breadcrumb card (and accepts an optional `avatar`).
  - `Card` is now ParentCard.
  - `Stat` is now a KPI card with a tinted icon box; long money values shrink to fit instead of overflowing.
  - `Chip` and `StatusChip` are tinted MUI chips.
  - `Banner` is an Alert.
  - `Tabs` are MUI Tabs.
  - `Modal`, `FormModal` and `ConfirmModal` are MUI Dialogs.
  - `Drawer` is an MUI Drawer.
  - The toast stack uses filled Alerts.
  - New helpers: `IconBox`, `useChartColors`, and the `Tone` and `PaletteKey` types.
- `apps/web/src/styles.css`: the legacy utility classes used across the 18 pages (`btn`, `input`, `table`, `kv`, `steps`, `chatbox`, `payslip`, …) were restyled to the Spike look through `--sp-*` variables. Highlights: pill buttons, 44px inputs, tables that scroll inside `.table-wrap` on small screens, and a numbered pay-run stepper with done/current states. Print rules are kept for payslips.
- `apps/web/src/pages/Dashboard.tsx`: Spike "Modern" dashboard layout: welcome card, KPI cards, headcount bar chart and people-by-team donut (`@mui/x-charts`), recent pay runs, leave balances and notifications. **Same API calls and figures.**
- `apps/web/src/pages/Auth.tsx`: Spike two-column auth card (login, register, change password). The form logic is unchanged.
- `apps/web/src/pages/PayRun.tsx`: stepper labels no longer carry a "✓ " text prefix (the CSS draws the tick); KPI icons.
- `apps/web/src/pages/Leave.tsx`: KPI icons.
- `apps/web/src/App.tsx`: same routes, now rendered inside `FullLayout`.
- `apps/web/src/main.tsx`: loads fonts and wraps the app in `ThemeRoot`.
- `apps/web/vite.config.ts`: icon-subset plugin; MUI/Emotion and React split into separately cached vendor chunks. Charts stay lazy-loaded with the Dashboard.
- `apps/web/package.json`: `icons` script; `predev`, `build` and `typecheck` regenerate the icon subset first.

### Dependencies (apps/web)

| Package | Type | Why |
|---|---|---|
| `@mui/material`, `@mui/system` ^7.3 | runtime | Spike's component library |
| `@emotion/react`, `@emotion/styled` ^11.14 | runtime | MUI styling engine |
| `@mui/x-charts` ^8.29 | runtime | Dashboard charts (Spike uses ApexCharts; MUI X keeps one design system) |
| `@iconify/react` ^6 | runtime | Icon renderer (offline subset) |
| `@fontsource/plus-jakarta-sans` ^5.3 | runtime | Spike typeface, self-hosted |
| `@iconify-json/solar`, `@iconify/utils`, `@iconify/types` | dev | Build-time icon subsetting |

### Known limitations

- **Profile pictures are saved per browser** (`localStorage: meridian:avatars`, keyed by display name) because the API has no avatar field and the backend was out of scope. A picture chosen on one device will not appear on another. The fix is a small `avatar_id` column on the person record plus one API field; the UI is already isolated in `avatars.ts`, so only that file would change.

### Verification

- `tsc` typecheck and `vite build` pass with no warnings.
- Every page was screenshotted at desktop (1440×900), tablet (820×1180) and mobile (390×844), in light and dark mode. There is no horizontal page overflow at any size; wide tables scroll inside their card.
- Figures cross-checked against the database for pay run `16d62a74…`: 7 people paid, gross AED 113,500.00, net AED 111,637.50, deductions AED 1,862.50. These match the UI exactly. `git diff main -- apps/api packages` is empty.

## [0.1.0] - 2026-11-26

- First version: API, payroll engine and classic white web UI (ADR-020). Tagged `v0.1-pre-spike-ui`.
