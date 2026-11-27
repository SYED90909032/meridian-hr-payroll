# ADR-027: UAE assurance evidence gate

Status: Accepted (mechanism only; external evidence is not present)

## Context

The UAE rule pack is intentionally shipped at L0. A named payroll/legal review, independent golden vectors, bank WPS acceptance, and at least two zero-unexplained-variance parallel runs are external evidence, not facts that code can manufacture. The previous registry guard checked only a reviewer and date, which was insufficient to prevent an accidental L2/L3 promotion.

## Decision

Migration 015 adds the owner-controlled `pay.pack_signoff` record keyed by the exact pack id, version, and hash. It records reviewer identity, organisation, credential note, signed date, scope, evidence-document reference/hash, golden-vector-set hash, bank acceptance reference, and parallel-run ids. Runtime roles cannot write it or the registry.

Migration 016 adds tenant-scoped parallel-run and per-employee variance records, bank hand-off/acknowledgement records, and a database trigger guard. L2/L3 updates require the exact matching sign-off plus all three evidence classes and two distinct completed zero-unexplained-variance runs whose pay runs carry the same pack identity. The `pack:signoff` CLI reports each missing condition and refuses promotion when any condition is absent.

The bank connector is a port: manual hand-off and host-key-pinned, key-authenticated SFTP implementations exist. Queueing is allowed only from `payment_released`; the database lifecycle already prevents that state below L2/L3. SIF validation is a structural self-check and is explicitly not bank validation.

## Consequences

The shipped registry remains L0 and live payment remains unreachable without external evidence. The owner database role is the deliberate human change process; runtime roles retain read-only registry access. Evidence is immutable by identity and tied to a pack hash, so changing a pack hash invalidates prior sign-off. Tests use labelled throwaway records only to exercise state-machine mechanics; they are not real review, bank, or employer evidence.

External blockers remain: no UAE reviewer has signed, no bank has accepted a file, and no live employer parallel run has occurred. A merger must not promote any pack based on repository tests or fixture rows.
