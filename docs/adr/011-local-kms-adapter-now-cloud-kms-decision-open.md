# ADR-011: Local KMS adapter now; cloud KMS decision open

Blueprint ref: D11
Status: Open

## Decision
Envelope encryption behind a KMS interface. Master key from the environment in dev. Production must plug a managed KMS before real data.

## Reason
Crypto-shredding design does not depend on the vendor.

## Rejected alternative
Defer all encryption

## Change this
Syed can change any provisional decision. Say which ADR and what to switch to.
