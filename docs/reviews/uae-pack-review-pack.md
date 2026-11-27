# UAE rule-pack review pack

**Pack:** `ae-private-sector@0.1.0`
**Pack hash:** `c998e964df0c318cd6e6fee64e19cbb0526d5609e75cd2751a2316b45e926d7d`
**Current assurance:** L0
**Review status:** **No payroll/legal review has happened. No bank validation has happened. No live-employer parallel run has happened.** This pack is a preparation artefact, not a sign-off.

## Reviewer instructions

For every parameter and rule below, verify the implementation against a current primary UAE source, record the source document and exact section, confirm the units (fils, days, minutes, basis points), and state whether the rule applies to the employee population and run type. Review the independent vectors in `packages/engine/golden/uae-vectors.json`; do not treat the engine output as independent evidence. A bank or exchange house must validate generated SIF files; the local SIF checker proves only structural reconciliation.

## Parameters

| Parameter | Current value | Unit / use | Source currently recorded in code | Status |
|---|---:|---|---|---|
| `days_basis` | 30 | days; daily wage denominator | Common UAE practice: wage divided by 30 | needs_reviewer |
| `hours_per_day` | 8 | hours; overtime denominator | Federal Decree-Law 33/2021 via secondary sources | needs_reviewer |
| `days_in_year` | 365 | days; gratuity denominator | Gratuity per day of service | needs_reviewer |
| `ot_normal_num` | 125/100 | premium; normal overtime | Federal Decree-Law 33/2021 via secondary sources; at least 25% | needs_reviewer |
| `ot_special_num` | 150/100 | premium; special overtime | Federal Decree-Law 33/2021 via secondary sources; note says night/rest-day rules differ | needs_reviewer |
| `ot_den` | 100 | rate denominator | Rate denominator | verified in code only |
| `gpssa_ee_num/den` | 5/100 | employee contribution | https://gpssa.gov.ae/pages/en/help/faq (read 2026-11-25) | verified in code; external confirmation required |
| `gpssa_er_num/den` | 125/1000 | employer contribution | same GPSSA FAQ reference | verified in code; external confirmation required |
| `gpssa_gov_num/den` | 25/1000 | government support display line | same GPSSA FAQ reference | verified in code; external confirmation required |
| `gpssa_min` | 100,000 | fils; contribution clamp lower bound | same GPSSA FAQ reference; AED 1,000 | verified in code; external confirmation required |
| `gpssa_max` | 5,000,000 | fils; contribution clamp upper bound | same GPSSA FAQ reference; AED 50,000 | verified in code; external confirmation required |
| `grat_min_days` | 365 | days; gratuity eligibility | Federal Decree-Law 33/2021 via secondary sources | needs_reviewer |
| `grat_first_days` | 21 | days per service year through threshold | same labour-law reference | needs_reviewer |
| `grat_after_days` | 30 | days per service year after threshold | same labour-law reference | needs_reviewer |
| `grat_threshold_days` | 1,825 | days; five years at 365 | same labour-law reference | needs_reviewer |
| `grat_cap_months` | 24 | months of basic wage | same labour-law reference | needs_reviewer |
| `deduction_cap_bps` | 5,000 | basis points; 50% voluntary cap | same labour-law reference | needs_reviewer |

## Rules and outputs

| Rule id | Code / kind | Current implementation | Review question / status |
|---|---|---|---|
| `ae.earn.basic` | BASIC / earning | Basic salary prorated by payable days over period days | Confirm proration basis and treatment of joiners/leavers. Needs reviewer. |
| `ae.earn.housing` | HOUSING / earning | Housing allowance prorated identically | Confirm inclusion and proration. Needs reviewer. |
| `ae.earn.transport` | TRANSPORT / earning | Transport allowance prorated identically | Confirm inclusion and proration. Needs reviewer. |
| `ae.earn.other` | OTHER_ALLOW / earning | Other fixed allowance prorated identically | Confirm classification. Needs reviewer. |
| `ae.earn.overtime` | OVERTIME / earning | Basic wage, minutes, 125% normal and 150% special rates using integer rounding | Confirm hour/day basis and every special-period category. Needs reviewer. |
| `ae.ded.unpaid` | UNPAID_LEAVE / deduction | Total fixed wage divided by 30, multiplied by leave days in thousandths | Confirm wage base, day basis, and rounding. Needs reviewer. |
| `ae.ded.gpssa_ee` | GPSSA_EE / deduction | Clamped contribution salary times 5% for UAE nationals | Confirm population, base, clamp and effective dates. External confirmation required. |
| `ae.er.gpssa_er` | GPSSA_ER / employer | Clamped contribution salary times 12.5% for UAE nationals | Confirm employer rate and employer-cost treatment. External confirmation required. |
| `ae.gov.gpssa` | GPSSA_GOV / government | Clamped contribution salary times 2.5%, informational | Confirm whether this display line is appropriate and current. External confirmation required. |
| `ae.final.gratuity` | GRATUITY / earning | 21 days/year for first five years, 30 thereafter, capped at 24 months; no payment under one year; expats only | Confirm termination eligibility, service-day counting, cap and national treatment. Needs reviewer. |
| `ae.final.leave` | LEAVE_ENCASHMENT / earning | Basic wage / 30 times unused annual-leave days | Confirm leave-balance source and settlement basis. Needs reviewer. |
| `ae.final.notice` | NOTICE_PAY / earning | Total fixed wage / 30 times notice days | Confirm notice semantics and whether this belongs in this pack. Needs reviewer. |

## Independent vectors

The vector file documents the schema, inputs, expected line amounts/totals and derivation method without importing the engine to derive expectations. It covers full-month salary, daily-rated pay, overtime, unpaid leave, gratuity at five years, GPSSA lower and upper clamps, negative net, and a mid-month joiner. The engine regression test executes all nine cases and currently passes. Reviewer questions: are inputs representative, are expected values independently recomputed, and are exclusions/negative-net handling acceptable?

## WPS/SIF and parallel evidence

`buildSif` and `validateSif` check ASCII/field shape, dates, routing/IBAN shape, record count, totals, integer minor-unit amounts, variable earnings, unpaid-leave days, multiple employees and zero-net rows. This is a **self-check, not bank validation**. Required external input is a bank/exchange-house acceptance reference for a named pack hash.

The parallel-run API imports strict integer CSV rows (`employee_no,gross_minor,deductions_minor,net_minor,lines`), compares gross/deductions/net and provided lines, and requires every variance to match or have an explanation. Required external input is at least two real employer cycles with zero unexplained variance.

## Evidence status

- **Reviewer sign-off:** Blocked: external — named qualified UAE payroll/legal reviewer, organisation, credential note, scope, date, and document hash are needed.
- **Independent vector confirmation:** Blocked: external — reviewer/independent actuary must confirm the vector set.
- **Bank WPS acceptance:** Blocked: external — bank/exchange-house validator and acceptance reference are needed.
- **Parallel runs:** Blocked: external — at least two real employer cycles and their variance evidence are needed.
- **Promotion:** Must remain L0 until all four evidence inputs are recorded by the owner process. No repository test is a substitute.
