# Phase 4 rules for reviewer

Status: **L0 / unreviewed**. This pack documents mechanisms and assumptions; it is not legal advice or statutory sign-off. No reviewer has confirmed a UAE rule and no parallel-run diff has been completed.

## Rule and parameter register

| Rule/mechanism | Parameter/default | Source or assumption | Golden vectors/tests | Reviewer question |
|---|---|---|---|---|
| New-hire/leaver proration | `days_basis = 30`; payable days are bounded by the 30-day default basis | Blueprint §8 Phase 4 task 1 states the documented default is a 30-day month basis. UAE legal treatment is an assumption. | `p4.proration.31day.one-day`; engine Phase 4 test “one-day joiner in a 31-day month” | Confirm the basis, treatment of 31-day months, and whether hire/termination dates are inclusive. |
| Mid-period compensation split | One segment per active `people.compensation.valid_during` interval; each segment carries its dates, rate, and payable days | Bitemporal compensation schema is repository-backed. Segment calculation is an implementation mechanism; statutory treatment is unreviewed. | `p4.comp-split.two-segments`; engine Phase 4 segment test; API payroll tests remain green | Confirm valid-time boundary and rounding treatment, including retroactive changes and two changes in one period. |
| Central rounding | UAE pack `defaultRounding = half_up`; money stays integer minor units and BigInt intermediates | Existing engine contract and pack; pack remains L0 | Existing 33 engine tests plus Phase 4 vectors | Confirm rounding mode per payroll rule. |
| Overnight attribution | `overnight_bucket = start` by default; tenant may select `end`; default timezone `Asia/Dubai` | Setting/mechanism is repository-backed. The attribution choice is a product assumption, not a UAE legal rule. | API unit test cross-midnight start/end attribution; `apps/api/test/unit.test.ts` | Which local date should receive attendance, overtime, and holiday treatment for overnight shifts? |
| Notice pay | `people.employee.contract_notice_days`, default `0`; daily rate uses pack `days_basis = 30` and fixed wage | Contract field is data. No source in repository confirms a universal notice period or daily-rate rule. | Engine existing final notice vector; API final-input path | Confirm each contract's notice period and wage components included. |
| End-of-service gratuity | Existing UAE pack rules/parameters; contractor path excludes it; all remain L0 | Existing pack sources in `packages/engine/src/packs/uae.ts`; primary/legal review is pending | Existing gratuity vectors; contractor Phase 4 test | Confirm eligibility, service-day counting, tiers, cap, and employment-type treatment. |
| Leave encashment | `leave_encashment_enabled = false` by default; tenant setting; line disabled unless enabled | Brief says default OFF unless repository sources specify the rule. No source-backed default was found. | Contractor/final engine test and API setting route | Confirm whether unused annual leave is payable on exit, the balance source, and the daily wage basis. |
| Off-cycle/bonus/adjustment | `pay.adjustment.claimed_by_run_id`; one adjustment can be claimed by one locked run; off-cycle is adjustment-only | Mechanism is integrity protection. No statutory claim. | `p4.off-cycle.adjustment-only`; API pay lifecycle tests; migration guard | Confirm which items may be off-cycle and whether claims should be released on cancellation/rejection. |
| Contractor payroll | `contractors_enabled = false` by default; when enabled, contractors use a distinct employment type and no statutory deductions/gratuity | Brief requires reviewer confirmation before enabling. This exclusion is a safe default, not a legal conclusion. | Contractor engine test; API setting permission/strict-schema route | Confirm contractor payment, withholding, gratuity, WPS, and payslip treatment with reviewer. |
| Reversal | New linked run (`is_reversal`, `reverses_run_id`) with equal/opposite lines and original frozen as `reversed`; reversal chains rejected | Blueprint §8 Phase 4 task 7 and database immutability controls | Service reversal implementation; migration 022 trigger; existing immutable payroll tests | Confirm operational approval/finalisation sequence for compensating runs and bank reconciliation. |

## Source notes

The only repository-backed Phase 4 default is the blueprint's 30-day basis statement. Existing UAE pack references and research notes are preserved in the pack, but the pack remains L0. `review_status` is represented by the pack's `needs_reviewer` parameter status and the L0 registry assurance. No new live-payment path was introduced; the database still requires L2/L3 for `payment_released`.

## Verification limits

The engine tests run locally against the TypeScript implementation. API tests run against the isolated PostgreSQL database `meridian_test_p4pay`; they prove database/pipeline behavior, not a bank, payroll vendor, or legal interpretation. Overnight tests use UTC+4 `Asia/Dubai`, which has no daylight-saving transition in the tested dates. A real bank WPS validator, external reviewer, and parallel-run employer remain required before promotion.
