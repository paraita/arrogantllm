# Make Believe LLM

Make Believe LLM is a small, self-hosted **mock** OpenAI-compatible API for developing and testing applications without calling real language models. It exposes configurable fictional models, an authenticated administration dashboard, and deliberately theatrical placeholder answers, thinking text, and latency.

**This is not a honeypot, does not run real inference, and must not be used as a honeypot.** It does not download model weights or provide a real model service. The responses are fictional jokes and must not be presented as real model output.

> This project was written with the assistance of AI.

## Features

- OpenAI-style `GET /v1/models`, chat completions (including SSE streaming and mock tool calls), Responses, legacy completions, and embeddings endpoints.
- Bearer-token authentication for API consumers. Tokens are shown once and only their hashes are stored.
- A separate local username/password login for the dashboard. An Authelia instance can optionally protect the web UI in front of this application as an additional access layer; the dashboard's own login remains enabled.
- A model catalog with manual model creation, metadata editing, activation toggles, and deletion.
- Hugging Face Hub search and metadata import. Imports create inactive catalog entries and **never download model weights**. The importer reads public model metadata and, when needed, the small `config.json` file for context length. Values show whether they were published, inferred from tags/names, or unavailable (`unknown`).
- Adjustable fake reasoning text, response templates, and latency.
- JSON persistence in `./data` locally or `/data` in Docker.

## Requirements

- Node.js 22.x and npm
- Docker Engine with the Compose plugin, if using Docker

## Run locally

Install dependencies, create local configuration, and build the dashboard:

```bash
npm ci
cp .env.example .env
npm run build
npm start
```

Open <http://localhost:8080>. The copied `.env` defaults to username `admin` and a local placeholder password. Change it before exposing the dashboard beyond your machine. The development-only defaults in the application are not suitable for shared or production environments. Set a unique `ADMIN_PASSWORD` and generate a strong session key:

```bash
openssl rand -hex 32
```

Put the generated value in `ADMIN_SESSION_SECRET`. Production mode refuses to start without an admin password and a session secret of at least 32 characters. Keep `.env` private; it is ignored by Git.

The dashboard stores models, settings, and API token hashes in `DATA_DIR` (default `./data`). The Hugging Face search feature needs an internet connection; the API and dashboard otherwise run locally.

### Frontend development

For hot reload, run the API server and Vite in two terminals:

```bash
# Terminal 1: API and admin routes on port 8080
npm run dev
```

```bash
# Terminal 2: dashboard on port 5173; /api, /v1, and /healthz proxy to port 8080
npm run dev:web
```

Open <http://localhost:5173>. The Vite proxy keeps browser requests same-origin with the dashboard during development.

## Create a model and API token

1. Sign in to the dashboard.
2. In **Models**, add a fictional model or open **Marketplace** to search Hugging Face metadata. Imports start inactive.
3. Turn on the model's **Active** toggle to expose it through `GET /v1/models` and inference routes.
4. In **API Tokens**, create a named token and copy its secret. The complete secret is shown once; create a replacement if you lose it.

## OpenAI-compatible API

Use the model ID shown in the dashboard and an API token created there:

```bash
export API_BASE_URL=http://localhost:8080
export MOCK_API_TOKEN='sk-mock-your-token'
export MOCK_MODEL='your-model-id'

curl "$API_BASE_URL/v1/models" \
  -H "Authorization: Bearer $MOCK_API_TOKEN"

curl "$API_BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $MOCK_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$MOCK_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello\"}]}"
```

The service implements these routes:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Public container health check |
| `GET` | `/v1/models` | List active fictional models; requires a Bearer token |
| `POST` | `/v1/chat/completions` | Chat placeholders, optional SSE streaming and mock tool calls |
| `POST` | `/v1/responses` | Responses-shaped placeholder output |
| `POST` | `/v1/completions` | Legacy completion-shaped placeholder output |
| `POST` | `/v1/embeddings` | Fixed fake vectors; these are not embeddings |

All `/v1` routes require a valid API token; `/healthz` is public. Only active models are listed or accepted. Tool calls are shaped to match the supplied schema; **no tool is executed**. Streaming sends Server-Sent Events. Responses and thinking text are configurable English templates. The dashboard's delay setting simulates response latency; it does not represent model computation time.

## Docker Compose

Prepare local configuration and start the service:

```bash
cp .env.example .env
# Edit ADMIN_PASSWORD and set ADMIN_SESSION_SECRET to a random value from `openssl rand -hex 32`.
docker compose up --build -d
docker compose ps
```

The dashboard and API are available on port `8080`. Compose mounts `./data` at `/data`, so catalog records, token hashes, and settings persist when the container is recreated. To stop the service, run `docker compose down`; this leaves the `./data` directory in place.

The image uses Node 22, runs as a non-root user, and includes a `/healthz` container health check. For a reverse-proxy deployment, put Authelia in front of the dashboard if desired and configure the proxy for the API routes as appropriate. Keep API tokens and admin secrets out of proxy labels and logs, and use HTTPS when clients connect over an untrusted network.

## CI and versioned images

GitHub Actions runs backend tests, dashboard tests, the frontend production build, and a Docker build on branch pushes and pull requests. A tag matching `vMAJOR.MINOR.PATCH` publishes a GHCR image with version, major.minor, and major tags:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The image is published at `ghcr.io/<owner>/<repository>:0.1.0` (replace the owner and repository with this project’s GitHub path).

## Troubleshooting

- **Production startup says `ADMIN_PASSWORD` or `ADMIN_SESSION_SECRET` is required:** copy `.env.example` to `.env`, set both values, and make the session secret at least 32 characters.
- **The dashboard is missing at port 8080:** run `npm run build` before `npm start`. During development, use `npm run dev:web` and `npm run dev` in separate terminals.
- **The API returns `401`:** create a consumer token in the dashboard and send it as `Authorization: Bearer <token>`. The dashboard login password is not an API token.
- **A model returns not found:** confirm it is active and use the exact model ID from the dashboard.
- **Marketplace search fails:** it requires access to `huggingface.co`; imports do not retrieve model weights.

## Project documents

- [CONTRIBUTING.md](CONTRIBUTING.md) — setup, tests, coding conventions, and release flow.
- [DISCLAIMER.md](DISCLAIMER.md) — intended use and fictional-output notice.
