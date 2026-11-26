# ADR-022: UI: Spike Admin design system on MUI v7

Blueprint ref: UI
Status: Accepted (supersedes ADR-020)

## Decision
The web app (`apps/web`) uses the look of the Spike Admin UI system (`ssrauf/spike-admin-ui-system`), built on MUI v7 and Emotion. That means Spike's tokens (primary `#0085DB`, radius 18, Plus Jakarta Sans, Solar icons), a floating sidebar and header, breadcrumb page heads, ParentCard cards, and light and dark mode. Tokens live in `src/theme/tokens.ts`. Shared primitives in `src/ui.tsx` keep their old props, so pages stay presentation-agnostic. Legacy class names in `styles.css` read the theme through `--sp-*` CSS variables. Icons are bundled offline as a build-time subset.

## Reason
The owner found the classic white UI unappealing and supplied Spike as the reference. MUI v7 is stable, accessible, responsive and well maintained, so the Beta-dependency concern behind ADR-020 does not apply. Keeping the primitive API unchanged meant no business logic, API call or calculation had to change.

## Rejected alternative
Copying Spike's demo pages wholesale would have meant rewriting page logic. Recolouring our own CSS would not have delivered Spike's components (dialogs, menus, drawer navigation, charts). ApexCharts, which Spike uses, was replaced by MUI X Charts to keep one design system and theme.

## Change this
Syed can change any provisional decision. Say which ADR and what to switch to. Colours, radius and font are edited in `src/theme/tokens.ts`. Rollback: tag `v0.1-pre-spike-ui`.
