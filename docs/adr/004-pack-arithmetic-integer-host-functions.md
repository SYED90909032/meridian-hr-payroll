# ADR-004: Pack arithmetic: integer host functions

Blueprint ref: D4
Status: Accepted (provisional, amended)

## Decision
Rules are a JSON expression tree with a closed set of integer host functions (mul_rate, pro_rata, round, min, max, tax_table). BigInt intermediates; no float anywhere. CEL is staged; the host-function semantics are the contract.

## Reason
Central rounding rules, safe evaluation with cost limit, no eval. CEL needs an evaluator dependency we did not want in the first slice.

## Rejected alternative
Full CEL now; typed graph

## Change this
Syed can change any provisional decision. Say which ADR and what to switch to.
