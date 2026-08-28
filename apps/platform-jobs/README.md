# Radius Platform Jobs

This application is the open BullMQ worker for retryable Platform side effects.
It currently proves queue health and exact-digest OCI deployment verification
through an injected registry provider.

The queue is not a product database. API handlers must authenticate and perform
their authoritative state transition before enqueueing follow-on work. Payloads
contain stable IDs, idempotency keys, references, and digests only. Registry
credentials are resolved from worker configuration and never enter Redis.

## Development

Start the pinned development Redis and registry from the repository root:

```bash
npx bun@1.3.14 run platform:infra:up
```

Run the worker:

```bash
JOBS_REDIS_URL=redis://127.0.0.1:6381 \
RADIUS_PLATFORM_REGISTRIES=127.0.0.1:5001 \
RADIUS_PLATFORM_REGISTRY_USERNAME=radius-dev \
RADIUS_PLATFORM_REGISTRY_PASSWORD=radius-dev-only \
RADIUS_PLATFORM_ALLOW_INSECURE_LOOPBACK=true \
npx bun@1.3.14 run platform:jobs:dev
```

In another terminal, prove a real API-to-Redis-to-worker round trip:

```bash
JOBS_REDIS_URL=redis://127.0.0.1:6381 \
npx bun@1.3.14 run platform:jobs:verify
```

Production Redis must use persistence and `maxmemory-policy noeviction`.
Workers must receive an explicit registry allowlist and workload identity or
operator-configured credentials.

An internal HTTP registry must also appear in
`RADIUS_PLATFORM_INSECURE_REGISTRIES`. This is intended for an explicitly
trusted single-node network; production registries should use HTTPS.

When deployment records use a host-visible registry authority but the worker runs
inside another network, `RADIUS_PLATFORM_REGISTRY_ENDPOINTS` maps that authority
to the worker-reachable host. The mapping changes transport only; it does not
rewrite the immutable image reference stored in the deployment.

To exercise exact-digest registry verification, push an OCI image to an
allowlisted registry and run:

```bash
RADIUS_VERIFY_IMAGE_REFERENCE=127.0.0.1:5001/example/agent:smoke \
RADIUS_VERIFY_IMAGE_DIGEST=sha256:... \
npx bun@1.3.14 run platform:jobs:verify-deployment
```
