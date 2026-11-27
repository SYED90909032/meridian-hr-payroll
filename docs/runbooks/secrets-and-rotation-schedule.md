# Secrets and rotation schedule

| Secret or key | Storage | Rotation | Notes |
|---|---|---|---|
| `MERIDIAN_MASTER_KEY` | Managed KMS/secret manager | On suspected exposure and scheduled annual review | Re-wrap tenant keys; do not log or export plaintext. |
| `MERIDIAN_SIGNING_KEY` | Managed secret manager/HSM | On suspected exposure or approved key lifecycle | Preserve the old public key for historical seal verification. |
| Database role credentials | Secret manager | At least quarterly and on leaver/incident | Rotate owner/app/auth/worker independently. |
| Redis credential/endpoint | Secret manager | At least quarterly and on incident | Use a unique deployment prefix; never flush shared Redis. |
| `METRICS_TOKEN` / OTLP credentials | Secret manager | At least quarterly | Restrict scrape/export network paths. |
| S3/KMS/provider credentials | Secret manager | Provider policy and at least quarterly | Prefer workload identity over static keys. |

Operator procedure: create the replacement secret, deploy it in a backward-compatible window, verify health and audit/metrics, revoke the previous secret, and record the change. Rotation, managed Postgres PITR/failover, and vendor-side deletion are operator work and are not exercised by local tests.
