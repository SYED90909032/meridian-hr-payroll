# Decisions log (blueprint Phase 0)

Source: `docs/production-readiness-blueprint.md`, section 8 Phase 0 and section 15.

The blueprint asks the product owner to answer eight questions. Until the owner answers, the build proceeds on a **working default** that was chosen to be the least irreversible option and to sit behind an interface, so changing the answer later does not mean rewriting code. Each row says what was assumed, what it affects, and how to change it.

Status values: **Default adopted** (building on it, owner has not confirmed), **Confirmed** (owner answered), **Blocked: external** (needs a person or organisation outside this repository).

| # | Decision (blueprint 15) | Working default adopted | Status | What depends on it / how to change it |
|---|---|---|---|---|
| 1 | Cloud provider and hosting | AWS-compatible APIs (S3, KMS, Secrets Manager). Nothing in the code imports a vendor outside an adapter. | Default adopted | Storage and KMS adapters (ADR-023, ADR-025). Moving to GCP, R2 or Neon means a new adapter, not a rewrite. |
| 2 | KMS vendor and custody model | AWS KMS for master-key wrap and unwrap, behind the `KeyProvider` interface. The `local` provider stays for development and tests only and is refused in production. | Default adopted | ADR-023 (supersedes the open part of ADR-011). Custody model: the application role can ask KMS to unwrap but the operator holding only database access cannot. |
| 3 | Email/SMS provider and object-storage vendor | Email through SMTP or Postmark HTTP, behind a `Mailer` interface; SMS behind the same outbox channel (provider not wired until chosen). Object storage: any S3-compatible service. | Default adopted | ADR-024 (email), ADR-025 (storage). Resolves the provisional state of ADR-015 and ADR-012. |
| 4 | Business model versus AGPL-3.0 (ADR-016) | Unchanged: AGPL-3.0 core, Apache-2.0 SDK and bridge. | **Needs owner confirmation** | Licensing is a commercial decision. Nothing in the build depends on it, but the generated SDK (Phase 6) is licensed Apache-2.0 on the assumption it holds. |
| 5 | UAE reviewer and bank channel | None appointed. | **Blocked: external** | Phase 2 cannot be completed without a named UAE payroll/legal reviewer and a bank or exchange house that will validate WPS files. The build delivers the mechanisms (sign-off record, evidence gate, parallel-run harness, bank-transport connector) but **does not and must not flip the pack to L2**. |
| 6 | Proration basis and mid-period split | 30-day month basis, as the blueprint's stated default. Mid-period split on the effective date of the compensation change. | Default adopted | Phase 4. Recorded in ADR-026. The basis is a pack parameter, so a reviewer's different answer is a data change plus new golden vectors. |
| 7 | Target customer size | 100 to 1,000 employees per tenant for design; load test target 1,000 per run, stretch 10,000. | Default adopted | Phase 7 load test and SLOs (blueprint 10). |
| 8 | Which compliance marks are contractual | UAE PDPL only until a customer contract says otherwise. SOC 2 control mapping is prepared but not scheduled. | Default adopted | Phase 9 timeline. |

## Provisional flags D1 to D16 and the open ADRs

| Item | Resolution in this build |
|---|---|
| ADR-011 (KMS vendor) | Resolved to the `KeyProvider` interface with AWS KMS as the production default. See ADR-023. |
| ADR-012 (storage identity) | Resolved to the `ObjectStore` interface with an S3-compatible backend. See ADR-025. |
| ADR-015 (bulk email domain) | The sending domain is a deployment setting (`MAIL_FROM`). SPF, DKIM and DMARC are DNS tasks for the operator; the runbook lists them. |
| ADR-014 (residency baseline) | Unchanged. Object-store and database region are deployment settings. |
| ADR-016 (licence) | Unchanged, pending decision 4. |
| ADR-001 to ADR-008 provisional flags | Not re-opened. No code in this build depends on changing them. |

## Reviewers and channels (blueprint Phase 0 tasks)

| Task | State |
|---|---|
| Appoint an independent PostgreSQL security reviewer | **Blocked: external.** The build adds a catalog-driven RLS coverage test and a written review pack (`docs/reviews/rls-review-pack.md`) so a reviewer can start immediately. |
| Appoint a UAE payroll/legal reviewer | **Blocked: external.** The build adds a reviewer pack of every rule parameter with its source (`docs/reviews/uae-pack-review-pack.md`) and independent golden-vector inputs. |
| Private security reporting channel | Named in `docs/SECURITY.md` (GitHub private advisory). The repository setting must be enabled by the owner. |
| Incident-response draft | `docs/runbooks/incident-response.md`. |

## How to record an answer

Change the Status to **Confirmed**, add the date and the owner's name in the "What depends on it" cell, and if the answer differs from the default, open an ADR that supersedes the relevant one. Do not edit the code first.
