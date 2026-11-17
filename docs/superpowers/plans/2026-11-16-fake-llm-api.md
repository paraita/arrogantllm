# Fake LLM API Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a documented, tested, Docker-ready fake OpenAI-compatible LLM service with an authenticated model dashboard.

**Architecture:** Express 5 serves API routes and a Vite-built React dashboard. A small JSON repository persists catalog and hashed tokens; signed expiring admin cookies protect management routes. Hugging Face metadata search imports model records without downloading weights.

**Tech Stack:** Node.js 22, Express 5, React 19, Vite, Vitest, Testing Library, Supertest, Docker, GitHub Actions.

---

## File map

- `server/index.js`: Express startup, static frontend and health route.
- `server/config.js`: environment validation and runtime defaults.
- `server/store.js`: atomic JSON persistence and catalog, API settings and token operations.
- `server/auth.js`: password verification, signed admin cookie, API token hashing/validation.
- `server/marketplaces/huggingface.js`: metadata-only Hub search and model mapping.
- `server/routes/admin.js`: login/logout and protected model/token/settings/summary routes.
- `server/routes/openai.js`: OpenAI-shaped model, chat, responses, completions and embedding endpoints.
- `server/generation.js`: delay, template selection, usage, thinking, tool-call and SSE helpers. `server/metrics.js` tracks in-memory request activity.
- `web/src/`: dashboard UI, login, API client, styling and unit tests.
- `tests/`: backend unit and HTTP integration tests.
- Root docs, Docker files and `.github/workflows/ci.yml`: contributor instructions and release pipeline.

## Chunk 1: Project skeleton and core persistence

### Task 1: Establish project metadata and test runner

**Files:** `package.json`, `.gitignore`, `.env.example`, `server/config.js`, `tests/config.test.js`

- [ ] **Step 1: Scaffold `package.json` with a `test` script using `node --test` and the pinned Node engine, then write failing config tests.** Include backend dependencies (Express 5, Supertest) and frontend dependencies (React, Vite, Vitest, Testing Library) so later plan tasks have a defined toolchain.
- [ ] **Step 2: Run `npm test`** and confirm tests fail because the config module is absent.
- [ ] **Step 3: Implement environment config validation and add `test:watch`, `test:web`, `build`, and `start` scripts.** Backend tests use Node's built-in runner; frontend unit tests use Vitest.
- [ ] **Step 4: Run `npm test`** and confirm config tests pass.
- [ ] **Step 5: Commit** as `chore: initialize fake llm api project`.

### Task 2: Implement atomic JSON catalog and model administration

**Files:** `server/store.js`, `tests/store.test.js`

- [ ] **Step 1: Write failing tests** for empty store initialization, creating/updating/toggling/deleting a model, and atomic persistence/reload.
- [ ] **Step 2: Run the store test file** and confirm expected missing-module failures.
- [ ] **Step 3: Implement validated catalog operations** with serialized writes to a temporary file followed by rename.
- [ ] **Step 4: Run store tests** and confirm they pass.
- [ ] **Step 5: Commit** as `feat: add persistent model catalog`.

## Chunk 2: Authentication and OpenAI-compatible API

### Task 3: Add dashboard and consumer authentication

**Files:** `server/auth.js`, `server/metrics.js`, `server/routes/admin.js`, `tests/auth.test.js`, `tests/admin.test.js`

- [ ] **Step 1: Write failing tests** for login success/failure, cookie expiry/signature validation, protected admin routes, API token create/revoke, and hash-only persistence. Also cover GET/PUT settings, delay/template validation, and the protected request-activity summary.
- [ ] **Step 2: Run auth tests** and confirm expected failures.
- [ ] **Step 3: Implement authentication.** Use constant-time secret comparisons, HttpOnly/SameSite cookies, secure cookies when HTTPS is enabled, expiring signed sessions, CSRF checks for state-changing cookie-authenticated routes, and one-time API-token reveal. Persist validated latency/template settings and expose a protected in-memory request activity summary for the dashboard.
- [ ] **Step 4: Run auth tests** and confirm they pass.
- [ ] **Step 5: Commit** as `feat: secure dashboard and api tokens`.

### Task 4: Implement inference formatting and timing

**Files:** `server/generation.js`, `tests/generation.test.js`

- [ ] **Step 1: Write failing tests** for templates, usage shapes, tool choice, arguments inferred from JSON schema, and configured delays.
- [ ] **Step 2: Run generation tests** and confirm expected failures.
- [ ] **Step 3: Implement deterministic injectable helpers** for choosing templates and delays, defaulting to amusing English mock content.
- [ ] **Step 4: Run generation tests** and confirm they pass.
- [ ] **Step 5: Commit** as `feat: add mock generation behavior`.

### Task 5: Expose OpenAI-compatible API routes

**Files:** `server/routes/openai.js`, `server/index.js`, `tests/openai.test.js`

- [ ] **Step 1: Write HTTP integration tests** for public health, rejected/missing Bearer token, active model listing, unknown/inactive models, chat, SSE, tool calls, responses, completions, and embeddings.
- [ ] **Step 2: Run API tests** and confirm the missing route behavior fails.
- [ ] **Step 3: Implement route handlers** with OpenAI-shaped error objects, active-model enforcement, request-size limits and stream disconnect handling.
- [ ] **Step 4: Run API integration tests** and confirm they pass.
- [ ] **Step 5: Commit** as `feat: expose openai compatible mock endpoints`.

## Chunk 3: Marketplace and dashboard

### Task 6: Add metadata-only Hugging Face import

**Files:** `server/marketplaces/huggingface.js`, `server/routes/admin.js`, `tests/huggingface.test.js`

- [ ] **Step 1: Write failing tests** using a local mocked HTTP response for search, metadata mapping, missing fields, error handling, source and import timestamp persistence, field provenance (`published`, `inferred`, or `unknown`), tag/config parsing, and confirming no weight/download URLs are requested.
- [ ] **Step 2: Run marketplace tests** and confirm expected failures.
- [ ] **Step 3: Implement Hub search/info calls** with bounded result counts and timeouts. Map repo ID, task, downloads, license, context length, quantization, version and flavor; persist source and import timestamp; record field provenance; mark unavailable values as unknown rather than inventing facts.
- [ ] **Step 4: Run marketplace tests** and confirm they pass.
- [ ] **Step 5: Commit** as `feat: import model metadata from hugging face`.

### Task 7: Build and test the admin dashboard

**Files:** `web/index.html`, `web/vite.config.js`, `web/src/App.jsx`, `web/src/api.js`, `web/src/styles.css`, `web/src/*.test.jsx`, root `package.json`

- [ ] **Step 1: Write failing UI tests** for login, dashboard model list/toggles, add and edit model, marketplace search/import, editable latency/templates settings, request activity summary, one-time token display, and revoke.
- [ ] **Step 2: Run frontend tests** and confirm expected failures.
- [ ] **Step 3: Implement the responsive English dark operations dashboard** with loading, empty, and error states; use accessible labels and confirmation for destructive actions.
- [ ] **Step 4: Run frontend tests and `npm run build`** and confirm pass.
- [ ] **Step 5: Commit** as `feat: add authenticated model dashboard`.

## Chunk 4: Delivery, docs and final verification

### Task 8: Add container and CI/release workflow

**Files:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/ci.yml`

- [ ] **Step 1: Add workflow configuration checks** and container smoke test instructions.
- [ ] **Step 2: Implement multi-stage non-root Docker build**, health check and persistent data volume. Configure GitHub Actions to test and build on pull requests and all branch pushes, and publish GHCR image tags only for `vMAJOR.MINOR.PATCH` tags.
- [ ] **Step 3: Build image and validate Compose configuration** locally where Docker is available.
- [ ] **Step 4: Commit** as `ci: build and publish versioned docker images`.

### Task 9: Write project documentation and verify release readiness

**Files:** `README.md`, `CONTRIBUTING.md`, `DISCLAIMER.md`, `.env.example`

- [ ] **Step 1: Document** local install, admin login, API tokens, example client requests, marketplace metadata limits, Docker persistence, SemVer/Conventional Commits, AI assistance, and mock/not-honeypot intent.
- [ ] **Step 2: Run full tests and production build.**
- [ ] **Step 3: Check docs and repo for Qwen-specific remnants** outside the untouched reference directory.
- [ ] **Step 4: Commit** as `docs: document mock api setup and disclaimer`.
