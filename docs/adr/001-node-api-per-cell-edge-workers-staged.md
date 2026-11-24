# ADR-001: Node API per cell; edge Workers staged

Blueprint ref: D1
Status: Accepted (provisional)

## Decision
Core API runs as a Node/Fastify service. Workers at the edge are staged.

## Reason
Avoids Worker CPU, pooling and KMS-call limits; standard HA unit. Workers + Hyperdrive is cheaper but unproven for payroll scale.

## Rejected alternative
Workers + Hyperdrive

## Change this
Syed can change any provisional decision. Say which ADR and what to switch to.
