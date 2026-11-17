# Proxy authentication and security hardening

Goal: allow the existing Traefik/Authelia gateway to own dashboard authentication while preserving bearer authentication and CSRF defenses. Scope: repository review and local tests, not a production penetration test.

Design decisions: ADMIN_AUTH_ENABLED defaults to true and accepts only true/false. Disabled mode requires PUBLIC_BASE_URL (HTTPS in production), bypasses local login, issues signed CSRF sessions with an ephemeral secret when none is configured, and never trusts identity headers. All gateway-authorized users are administrators. Backend network isolation is mandatory.

Implementation checklist:
- [x] Add configuration, session, CSRF/origin and UI regression tests; observe failures; implement disabled mode and document activation.
- [x] Add and reproduce security regressions: login throttling, HTTP headers/no-store, bounded concurrent requests, bounded JSON depth, embeddings/tool amplification, metric cardinality, bounded same-origin marketplace fetches. Implement protections.
- [x] Restrict default Compose port binding; supply a separate Traefik example with no published port. Document confirmed findings, residual risks and deployment checks in SECURITY.md.
- [x] Run backend/frontend suites, production build, dependency audit and independent code review. Record evidence and limitations.

Validation: default mode still requires credentials; spoofed proxy headers grant nothing; disabled mode can mutate only with its session and CSRF token; cross-origin traffic fails; API tokens remain required; production config rejects placeholders. Verify 429 and slot release, unknown-path metrics, payload expansion and upstream response limits. Preserve existing OpenAI and frontend tests.

Execution: implement directly in the user-provided workspace, leaving reviewable uncommitted changes. No production configuration is changed. This follows the user's requested update without an additional approval gate.

Validation evidence: Node 22.23.5; 58/58 backend and 11/11 frontend tests; production Vite build successful; npm audit reported 0 known vulnerabilities; git diff --check clean; Traefik Compose example parsed successfully. Docker image built, then smoke-tested with no external network, read-only root filesystem, no capabilities and no-new-privileges: built UI/assets, external session, Secure cookie, CSRF/origin rejection, model persistence, API token access and revocation passed. Temporary container and its volume removed.

Independent review found two P2 issues, both reproduced with failing tests then corrected: production local-auth origin fallback behind TLS termination; unread upstream response bodies on error/404. Full backend suite passed after both fixes. The explicit production origin fallback assumes HTTPS (matching Secure cookies), preserves Host and ignores forwarded headers. Production gateway/firewall and image OS vulnerability scanning remain outside the verified scope, as detailed in SECURITY.md.

Follow-up findings addressed: default Compose explicitly selects its local HTTP origin and allows a non-Secure cookie only for a configured loopback HTTP local-auth dashboard. API authentication now precedes body parsing and its concurrency quota; admin requests use MAX_ADMIN_CONCURRENT_REQUESTS=16 independently of MAX_CONCURRENT_REQUESTS=64 for API traffic. Health/static routes bypass both budgets. Rejected incomplete API uploads close their connection. The example gateway has separate per-peer concurrency controls. Five new tests reproduced the missing behavior before implementation; final 63 backend/11 web tests pass. A fresh reviewer ran 23 targeted tests and accepted both fixes. Docker HTTP cookie-jar smoke and Compose origin default/override validation passed; browser automation was unavailable. No production deployment changed.
