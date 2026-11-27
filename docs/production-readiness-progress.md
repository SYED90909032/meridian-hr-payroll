# Production-readiness progress

Tracks every task in `docs/production-readiness-blueprint.md` section 8. This file is the single place to see what is built, what is verified and what is waiting on someone outside the repository.

Legend: **Done** = built and covered by tests that run in CI. **Done (partial)** = built, with a stated limit. **Blocked: external** = needs a person, account or third party that this repository cannot supply. **Not started**.

"Verified against" says what the tests actually ran against. A test that ran against a stand-in (for example `moto` for AWS) is not the same as a test against the real service, and the table says which is which.

| Phase | Task | Status | Verified against | Notes |
|---|---|---|---|---|
| 0 | Decisions log | Done (partial) | n/a | `docs/DECISIONS.md`. Working defaults adopted; owner confirmation outstanding. |
| 0 | Appoint reviewers | Blocked: external | n/a | Review packs prepared so a reviewer can start at once. |
| 0 | Object-storage port | Done | local FS, moto S3 | ADR-025. Foundation for Phases 1 and 5. |

(Rows for Phases 1 to 10 are added as each phase is merged.)
