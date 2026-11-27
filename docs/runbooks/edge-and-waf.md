# Edge and WAF

Configure the Cloudflare/equivalent edge with TLS 1.2+, managed WAF rules, DDoS/rate-limit shielding, bot management appropriate for the customer population, request-body limits, and origin access restricted to the load balancer. Pass only the headers required by the API and strip untrusted inbound forwarding headers at the trusted proxy. Keep authorization, API/device key, cookie, and token headers private.

Set `TRUST_PROXY=false` unless the service is behind a known proxy chain. In that default, Fastify uses the direct socket address and a client-supplied `X-Forwarded-For` does not change `req.ip` or rate-limit keys. When enabled, configure the proxy trust depth/address range at the deployment edge and test the complete chain; do not enable it merely because a header is present. The application limiter is an additional shield, not a replacement for edge controls.

Metrics `/metrics` requires `Authorization: Bearer <METRICS_TOKEN>` and should be reachable only from the monitoring network. OTLP endpoints should be internal and authenticated at the collector. HSTS is enabled in production by the API.
