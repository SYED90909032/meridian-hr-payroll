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
