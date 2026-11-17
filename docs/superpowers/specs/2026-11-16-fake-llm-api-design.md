# Fake LLM API Design

## Purpose

Build a lightweight, self-hostable joke service that mocks an OpenAI-compatible LLM API for local development. It must be clearly labeled as fictional and must not present itself as a honeypot or a real model provider.

## Architecture

- One Node.js service using Express 5 serves both the JSON API and the built React dashboard.
- The frontend is React 19 with Vite. The visual style is a polished dark model-operations console, responsive from desktop to mobile.
- A JSON file in a mounted data directory stores model records, API token hashes, and settings. Writes are atomic to avoid corrupting the catalog.
- The admin dashboard has a local username/password login (username defaults to `admin`; password is set through environment configuration). Authenticated, expiring, HttpOnly, SameSite cookies protect both the UI session and all management routes. Authelia can be placed in front as an additional access layer.
- API consumer tokens are created and revoked in the dashboard. Show a token secret once, store only its hash, and require Bearer authentication for model and inference routes. Health checks remain public.
- The Hugging Face Hub is the first marketplace source. Search and model metadata endpoints provide repository information without downloading model weights. Store the source and timestamp. Context length, quantization, version, and flavor are filled from published metadata when available and marked unknown/estimated when inferred.
- The API supports `GET /healthz`, `GET /v1/models`, `POST /v1/chat/completions` (including SSE streaming and basic tool calls), `POST /v1/responses`, `POST /v1/completions`, and `POST /v1/embeddings`. Only active models are listed or callable. Invalid credentials and inactive/unknown models return OpenAI-shaped errors.
- Latency and a theatrical fake thinking field are configurable. English placeholder response templates make the joke explicit while varying the claimed model identity.

## Dashboard

- Overview with active model count, API token count, and request activity.
- Model catalog with active toggles, source badges, metadata, and add/edit controls.
- Marketplace search to inspect and import Hugging Face metadata. Import does not download weights.
- API token management with one-time secret display and revoke action.
- Settings for response delay and humor templates.
- Login screen, clear admin-only labeling, and API endpoint/curl guidance.

## Quality and delivery

- Node built-in test runner plus Supertest for HTTP behavior; frontend unit tests use Vitest and Testing Library.
- GitHub Actions runs tests and builds the container on pushes and pull requests. SemVer tags (`vMAJOR.MINOR.PATCH`) publish versioned and major/minor Docker tags to GHCR.
- Docker Compose supports local use with persistent data. The image uses a non-root user and includes a health check.
- `README.md`, `CONTRIBUTING.md`, and `DISCLAIMER.md` are in English. README documents local startup, API usage, Docker, admin security, AI assistance, and that this is a mock, not a honeypot.
- Conventional Commits are used for project commits.

## Explicit constraints

- Remove Qwen-specific configuration and branding from this project. Joke templates may humorously claim to be real models, but remain generic/configurable and clearly documented as fiction.
- Marketplace operations must never download model weights.
- No real model inference occurs.
- This service is intended for development and humor, not production inference or deceptive deployment.
