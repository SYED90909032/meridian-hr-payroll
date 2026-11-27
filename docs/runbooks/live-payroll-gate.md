# Live payroll gate runbook

## Scope and current status

This runbook controls the only path from sandbox/parallel payroll to live bank payment. The shipped UAE pack is L0. **Blocked: external:** no reviewer sign-off, bank acceptance, or real employer parallel run is present. Do not promote based on fixtures, local tests, or a verbal statement.

## Roles

- **Payroll/legal reviewer:** independently reviews every parameter/rule and confirms the vectors.
- **Bank/exchange-house contact:** validates SIF edge cases and supplies an acceptance reference.
- **Employer payroll administrator:** supplies existing-payroll exports for at least two real cycles.
- **Meridian owner:** records evidence in the owner database role and runs the CLI; never delegates this to the app role.
- **Payroll approver:** performs normal maker-checker approval after the pack gate is complete.

## Procedure

1. Freeze the exact pack id, version and SHA-256 pack hash from the registry and review pack. Do not edit the pack while evidence is being collected.
2. The reviewer records a signed document identifying name, organisation, credential note, date, scope and document hash. Record the golden-vector-set hash only after the reviewer confirms the independently derived vectors.
3. Generate SIF files for variable earnings, unpaid leave, zero net, multiple employees and long/non-ASCII names. Run the structural self-check. Send the files through the bank/exchange-house’s approved validator and record the bank’s acceptance reference. The self-check is not bank evidence.
4. For at least two real employer pay cycles, create Meridian parallel runs for the same periods. Import the employer CSV through `POST /api/v1/pay/parallel-runs`; resolve every per-employee variance with a documented explanation or exact match. Confirm each pair is `zero_variance` and retain its id.
5. As the owner database role, record the sign-off and all evidence:

   ```text
   pnpm --filter @meridian/api pack:signoff -- record \
     --pack-id ae-private-sector --version 0.1.0 \
     --pack-hash <exact-pack-sha256> \
     --reviewer-name <name> --reviewer-organisation <organisation> \
     --credential-note <credential> --signed-at <RFC3339> \
     --scope <review-scope> --document-reference <controlled-reference> \
     --document-hash <document-sha256> \
     --golden-vector-hash <vector-set-sha256> \
     --bank-acceptance-reference <bank-reference> \
     --parallel-run-id <run-id-1,run-id-2>
   ```

6. Inspect the exact missing list. If anything is listed, stop:

   ```text
   pnpm --filter @meridian/api pack:signoff -- status \
     --pack-id ae-private-sector --version 0.1.0 --pack-hash <exact-pack-sha256>
   ```

7. Only when status reports no missing conditions, run `promote`. The database trigger repeats the checks in the same transaction; a CLI success is not a bypass of the trigger. Promotion is to L2, never directly to L3.
8. Re-run the normal maker-checker flow on a small controlled live run. Queue bank submission only after the run is `payment_released`; SFTP requires pinned host key and key authentication. Reconcile acknowledgements per employee and retain bank evidence.

## Rollback to L0

The owner may immediately set the exact registry row back to L0 through the owner database change process, recording the incident/reason and audit evidence. Do not delete sign-off or parallel evidence; preserve the history. Stop new live runs, finish or reverse any already released run through the payroll incident procedure, and have the owner verify that `payment_released` is unreachable for newly finalised runs. A pack hash change automatically invalidates the old sign-off because the key includes the hash.

## Failure handling

- Missing reviewer, vectors, bank reference, or two qualifying parallel runs: remain L0; do not improvise a substitute.
- Bank rejects a file: record the bank response, correct the pack/file only through review, and repeat validation; do not mark accepted manually.
- Variance remains unexplained: keep the pair `needs_review`; do not promote.
- SFTP transport failure: retain the payment release state and receipt/error metadata without logging file contents or credentials; use the approved manual hand-off only if the business process permits it.

## Evidence and limits

The repository tests prove database enforcement, CSV comparison, integer arithmetic, SIF structural checks, and protocol handling against local/throwaway infrastructure. They do not prove UAE legal correctness, bank acceptance, a real employer parallel run, or production SFTP interoperability. Those remain **Blocked: external** until independently supplied and recorded.
