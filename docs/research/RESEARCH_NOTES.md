# Research notes (build 0.1)

Date of research: 25 Nov 2026. Everything below was read from the cited page, not from a snippet.

## UAE payroll pack inputs
| Rule | Value used | Source | Status |
|---|---|---|---|
| End-of-service gratuity | 21 days of basic wage per year for the first 5 years, 30 days per year after, capped at 2 years of basic wage | Federal Decree-Law 33/2021 Art. 51, as reported by Gulf News (22 Oct 2026), Arabian Business (23 Oct 2026), Reform Group (27 Oct 2026) | Secondary sources; primary text to be checked by the L2 reviewer |
| GPSSA private sector, UAE nationals | employer 12.5%, insured 5%, government support 2.5% of contribution salary | https://gpssa.gov.ae/pages/en/help/faq | Primary source |
| GPSSA contribution salary bounds | private sector min AED 1,000, max AED 50,000; salary basis is fixed contracted salary | same | Primary source |
| GPSSA salary basis timing | Private-sector contributions use the January salary each year (changes apply next January) | same | Modelled as input `contribution_salary_minor` |
| WPS SIF layout | EDR (10 fields), EVP (10), SCR (10: record type, employer ID, routing code, creation date, HHMM, salary month, EDR count, total salary, currency, employer ref) | https://www.dib.ae/docs/default-source/wps-guidelines/wps-file-format-reference-guide_v1-1.pdf | Bank guide of the MoHRE format; each bank must still validate (blueprint D-20) |
| Overtime, unpaid-leave day basis, 50% deduction cap | pack parameters, marked `needs_reviewer` | Not verified in this session | Open: L2 reviewer must confirm |

The pack ships at assurance L0. That means sandbox and parallel-run only. See ADR-003.

## Design reference: Astryx (https://astryx.atmeta.com/, read 25 Nov 2026)
Open-source React 19 + StyleX design system from Meta, in Beta, 180+ components, themeable, dark mode, agent-ready CLI/MCP docs.
Visual language observed on the landing page: white canvas, generous whitespace, near-black text, restrained neutral greys, one accent used sparingly, rounded cards with hairline borders, dense but calm data tables with inline tags, small status chips, quiet activity feeds.
Decision (ADR-020): follow the look with our own CSS tokens. Do not take a dependency on a Beta library whose API can change; swap-in later is possible because the components are thin wrappers.

## Platform facts carried from the blueprint review (25 Nov 2026)
Cloudflare Queues free-plan limits, EU AI Act Annex III date of 2 Dec 2027, Gmail restricted scopes, Play Integrity quota. See `docs/blueprint-v2.1-delta.md` Part D.
