# Security review and deployment

Review date: 2026-11-17. Scope: repository source, dependency lockfile, application tests, Dockerfile, Compose and CI workflow. This is a code review with local regression tests, not a penetration test of the running production host. The deployed Traefik/Authelia rules, firewall, TLS, container image/OS packages and host configuration were not inspected. No claim of immunity to attacks is made.

## Authentication boundary

Local authentication remains enabled by default. Set `ADMIN_AUTH_ENABLED=false` only behind a gateway that authenticates **every dashboard/admin request**, including `/api/admin/session`, `/api/admin/models`, `/api/admin/tokens`, marketplace and settings. `PUBLIC_BASE_URL` is mandatory in this mode, and must be HTTPS in production. This mode deliberately grants full admin access to anyone who can reach the backend. It does not verify an Authelia identity, provide per-user roles, or treat `Remote-User`/`X-Forwarded-*` as authentication.

Use an Authelia policy restricted to administrators, preferably with MFA. Keep the backend inaccessible from public networks. Containers sharing its Docker network are within this trust boundary. Only the exact `/v1` subtree should bypass browser SSO, and it still requires an application-issued bearer token. The health endpoint reveals only `ok`; it need not be exposed publicly.

The disabled local login still uses signed, eight-hour CSRF sessions and a per-session token. Cookies are HttpOnly and SameSite=Strict, and Secure in production. Mutations require the cookie plus `X-CSRF-Token`. In production, the fallback origin uses HTTPS and the preserved Host header even when TLS terminates at the proxy; set PUBLIC_BASE_URL if the gateway rewrites Host. Admin requests with a conflicting Origin or `Sec-Fetch-Site: cross-site` are rejected. Without an explicit secret, a fresh random signing key is generated on restart; reload existing tabs after a restart or expired CSRF session. Local sign-out is hidden because it cannot end an Authelia session.

## Findings and changes

Severity describes the pre-change impact and prerequisites, not a CVSS certification.

| Finding | Severity / prerequisites | Result |
| --- | --- | --- |
| Public backend port can bypass external authentication | Critical if local auth is disabled without network isolation | Default Compose now binds loopback. Standalone Traefik example has no published port. Actual production isolation remains an operator check. |
| Unlimited local password guesses | High when login is reachable | A process-wide limit of 10 attempts/minute returns 429 with Retry-After; changing forwarded headers cannot bypass it. |
| Documented example credentials accepted in production | High if examples are deployed unchanged | Production rejects known example/development passwords and signing secrets. |
| Unbounded pending requests during artificial delays and SSE | High availability risk with valid API tokens; uploads also consume resources | Separate budgets of 64 authenticated API requests and 16 admin requests per process, before JSON parsing and released on completion/disconnect. API authentication precedes body parsing; health/static UI bypass both quotas. Invalid tokens on incomplete uploads receive 401 and connection closure. Header/upload timeouts are 15/30 seconds; keep-alive is 5 seconds. |
| Tool argument echo and embedding array response amplification | Medium, valid API token | 2,048 embedding inputs; 32 tools; 128 parameters/required entries per tool; generated query echoes truncated to 2,048 characters. |
| Metrics store arbitrary requested paths forever | Medium, valid API token | Only supported method/path pairs produce metrics; arbitrary paths return 404 without metric entries or artificial delays. |
| Missing browser hardening and sensitive-response cache policy | Medium, requires another attack or unsuitable cache | CSP limits scripts/resources to self, blocks framing, objects and base changes; nosniff, frame denial, no-referrer and no-store headers added. Inline styles remain allowed for the existing UI. |
| Cross-origin login requests accepted | Medium, login CSRF | Explicit Origin and Fetch Metadata validation added to all admin routes; existing per-session CSRF protection preserved. |
| Arbitrarily deep JSON and compressed request processing | Medium availability risk | Existing 1 MiB body cap retained, nesting capped at 32, compressed bodies rejected with 415. |
| Marketplace fetch automatically follows redirects and buffers unbounded bodies | Medium hardening; requires upstream-controlled response/redirect | Fetch uses manual redirects, maximum three within HTTPS huggingface.co, eight-second deadline and 2 MiB decoded response cap. Unread response bodies are canceled on all exits. External redirects are intentionally rejected, including legitimate CDN redirects. |

Evidence: `tests/security.test.js`, `tests/config.test.js`, `tests/huggingface.test.js` and `web/src/App.test.jsx` cover the new protections and authentication mode. Existing auth, catalog, generation and OpenAI tests remain part of validation. Tests cover local flows and simulated HTTP upstreams, not a live Authelia deployment.

## Validation performed

- Initial verification under Node 22.23.5: 58 backend tests and 11 frontend tests passed; production frontend build succeeded.
- `npm audit --json`: zero known npm vulnerabilities at review time.
- `git diff --check`: clean. Standalone Traefik Compose example parsed with `docker compose config --quiet`.
- Docker image built and started as non-root with read-only root filesystem, dropped capabilities, no-new-privileges and no external network. Smoke tests passed for UI/assets, external session bootstrapping, Secure cookie, CSRF/origin rejection, model writes, API bearer authentication and token revocation. The temporary container and data volume were removed.
- Independent review identified two additional issues (TLS-terminated local login and unread upstream error bodies); both were reproduced in regression tests and corrected before the final backend run.

## Follow-up review corrections

A fresh-context review reproduced two additional findings, now covered by regression tests:

- Docker local HTTP login was rejected because production's fallback origin assumed HTTPS. Default Compose now explicitly sets the local origin; the local-only cookie exception supports login, CSRF mutations and logout while HTTPS/external mode retains Secure cookies.
- Partial API uploads acquired the old shared quota before authentication, causing 429 on admin and health requests. Token authentication now precedes JSON parsing, incomplete invalid-token uploads get an immediate 401 with connection closure, and API/admin quotas are independent. Tests use real local HTTP connections with incomplete bodies, verify health/admin isolation and capacity recovery on disconnect. The Traefik example now includes separate per-client concurrency limits.

Follow-up validation: 63/63 backend and 11/11 frontend tests passed under Node 22.23.5, with a successful frontend and Docker build. A hardened temporary Docker container passed local HTTP login, cookie retention, CSRF mutation, cross-origin rejection and logout using a cookie jar. Compose's local default and HTTPS override were validated with disposable environment fixtures. A fresh-context reviewer independently passed 23/23 targeted tests and found no additional issue in these two fixes. Browser automation was unavailable, so no real-browser result is claimed. The temporary container and volume were removed.

## Existing protections verified in source

- Random 256-bit API tokens; only SHA-256 hashes are persisted, clear tokens are returned once. Token comparison uses constant-time digests. Revocation removes tokens from subsequent authentication checks.
- Admin sessions use HMAC signatures and enforce expiry. Local credentials are compared through fixed-length hashes.
- React renders model metadata as text; no raw HTML injection or command execution was found in the application paths reviewed. Fake tool calls never execute tools, and marketplace imports never download or load model weights.
- Persistence writes atomically with mode 0600; new data directories use 0700. Docker runs as the non-root `node` user. API errors avoid exposing stack traces and internal persistence errors.
- No wildcard CORS policy is enabled. Dependency installation is lockfile-based. No known npm advisory was returned at review time (this does not cover OS packages, unknown vulnerabilities or compromised upstream releases).

## Remaining risks and operational requirements

1. **Verify the gateway and network boundary before disabling local auth.** A missing ForwardAuth middleware on an admin route or an exposed backend allows an attacker to mint API tokens and alter the catalog. The app cannot detect this deployment error. Require authorization in Authelia, not merely a valid account.
2. **Availability controls remain necessary at the edge.** The application limits are per process, not per user/IP and not shared between replicas. A valid API token can occupy the API budget with slow uploads/streams, but cannot consume the separate admin budget or the health endpoint. Unauthenticated admin login uploads can still consume the admin budget; slow headers and raw connection floods are outside these application quotas. An attacker can also consume the login attempt quota. The Traefik example adds separate per-client in-flight limits (8 API / 4 dashboard), using the direct peer IP; configure trusted upstream IP extraction if needed. Configure per-client rate limits, concurrent-connection limits, request/response deadlines and body size limits at Traefik; use upstream DDoS protection for volumetric attacks. Limit outbound access to the services actually required. Hugging Face is still a trusted upstream, including its DNS/TLS.
3. **Session/token lifecycle is basic.** Local logout clears the browser cookie but does not revoke a stolen signed cookie before its eight-hour expiry. Rotate `ADMIN_SESSION_SECRET` to invalidate all local sessions. API tokens have no automatic expiry or scoped permissions: revoke/rotate them in the dashboard. Authelia owns external session revocation; the app's CSRF cookie grants no gateway access.
4. **Single-instance storage.** The JSON catalog is intended for one process. Do not share the data directory between replicas. Administrator-driven catalog growth and queued writes are not given disk quotas by the app; apply volume/host quotas and backups. Protect `.env`, backups and data ownership/permissions (existing directory permissions are not automatically changed).
5. **Logging and monitoring.** The app has aggregate usage metrics, not an immutable admin audit trail or intrusion detection. Enable proxy access/authentication logs and alerts for failed logins, 401/403/429 responses, latency, memory and disk usage. Avoid logging Authorization, Cookie, CSRF tokens or full request bodies.
6. **Supply chain and host.** Rebuild current Node 22 base images regularly, scan the final container/OS packages, keep Traefik/Authelia and the host patched, and restrict Docker socket access. CI actions/base images use version tags rather than immutable digest pins. Deployment and image provenance require their own review.
7. **Compatibility changes.** Public production dashboards require HTTPS. The local-auth quick start explicitly configures http://localhost:8080 and disables Secure only for a configured HTTP origin with hostname localhost, 127.0.0.1 or [::1]. This exception never depends on request Host or forwarded headers and is unavailable in external-auth production mode. Compressed JSON uploads and exceptionally deep/large mock requests now fail intentionally. The default Docker port is reachable only from the host. The Traefik example uses a new named volume: migrate the existing catalog before switching deployments if it must be retained.

## Deployment acceptance checks

Run these against your own deployment after adapting the example; they were not run on production during this review:

- From outside the host, connecting directly to backend port 8080 must fail (check IPv4 and IPv6). Docker's published ports can bypass host firewall expectations; verify externally.
- In a signed-out browser, `/` and `/api/admin/session` must require Authelia; `/api/admin/models` and `/api/admin/tokens` must not disclose data. Access should fail closed if Authelia is unavailable.
- After Authelia authorization, dashboard reads and mutations work without a second login. An authenticated non-admin account must be denied by the Authelia policy.
- `/v1/models` without a token and with a revoked token must return 401. A valid API token must work without browser SSO. Paths such as `/api/admin/tokens` must never use the API exemption.
- The response headers include CSP and no-store, HTTPS is enforced, and gateway caches never cache admin/token responses. Inspect gateway timeouts and limits with normal SSE usage.
- Backup/restore the catalog, verify ownership, and test token revocation and secret rotation.

## References

- [Authelia: Traefik integration and forwarded header trust](https://www.authelia.com/integration/proxies/traefik/)
- [Traefik: ForwardAuth middleware](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/forwardauth/)
- [Traefik: in-flight request limits](https://doc.traefik.io/traefik/reference/routing-configuration/http/middlewares/inflightreq/)
- [Express: production security practices](https://expressjs.com/en/advanced/best-practice-security/)
