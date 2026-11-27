# Meridian webhooks

Meridian sends HTTPS POST requests with `X-Meridian-Event`, `X-Meridian-Delivery`, `X-Meridian-Timestamp`, and `X-Meridian-Signature`. The signature is `v1=` followed by lowercase HMAC-SHA256 of the exact UTF-8 string `<timestamp>.<raw body>` using the endpoint secret. Verify the signature against the raw request bytes before parsing JSON.

Reject a timestamp outside a five-minute window (and reject a delivery ID already processed). Persist `X-Meridian-Delivery` as an idempotency key; retries can repeat a delivery and ordering is not guaranteed across events or endpoints. Meridian retries unsuccessful deliveries with exponential backoff and records attempts and the final error. Delivery logs are retained for the configured period (90 days by default); the endpoint and outbox record are not removed by log retention.

The tenant destination allow-list, when configured, is checked at endpoint creation and again before every delivery. HTTPS is mandatory. The SSRF guard also rejects private, loopback, link-local, metadata and reserved addresses, pins the validated address, and does not follow redirects. A later allow-list change therefore blocks an existing endpoint.

## Node receiver

```js
import crypto from 'node:crypto';
export function verify(req, rawBody, secret, seen) {
  const ts = Number(req.headers['x-meridian-timestamp']);
  const delivery = req.headers['x-meridian-delivery'];
  if (!Number.isSafeInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 300 || !delivery || seen.has(delivery)) return false;
  const expected = 'v1=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(req.headers['x-meridian-signature'] ?? '');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  seen.add(delivery); // use a durable store in production
  return true;
}
```

## Python receiver

```python
import hashlib, hmac, time

def verify(headers, raw_body, secret, seen):
    ts = int(headers.get("X-Meridian-Timestamp", "0"))
    delivery = headers.get("X-Meridian-Delivery", "")
    if abs(time.time() - ts) > 300 or not delivery or delivery in seen:
        return False
    message = f"{ts}.".encode() + raw_body
    expected = "v1=" + hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, headers.get("X-Meridian-Signature", "")):
        return False
    seen.add(delivery)  # use a durable store in production
    return True
```
