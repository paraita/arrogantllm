# ArrogantLLM — OpenAI-Compatible Mock LLM API

**A fake LLM API with real confidence.** ArrogantLLM is a self-hosted, OpenAI-compatible mock API for local development, integration testing, and demos that should not spend money on actual inference. It serves configurable fictional models through familiar OpenAI-style endpoints, with API-token authentication and a web dashboard.

The model is pretend. The latency is theater. The confidence is unfortunately real.

> **This is a mock for development and humor, not a honeypot. Do not use ArrogantLLM as a honeypot or present its output as real AI inference.** It does not run language models or download model weights.

This project was written with the help of AI.

## Why ArrogantLLM?

- Mock an OpenAI-compatible LLM API while developing an application, without connecting it to a real LLM or paying for tokens.
- Test OpenAI SDK integrations, bearer-token authentication, streaming responses, model selection, and error handling.
- Add fictional models manually or import model-card metadata from Hugging Face Hub. Imports create inactive entries and fetch metadata only; model files are never downloaded.
- Toggle models on or off in the web dashboard and issue separate API tokens for client applications.
- Make requests wait through configurable fake latency and receive proudly fabricated answers, reasoning text, tool-call shapes, and embeddings.

Supported routes include `GET /v1/models`, `POST /v1/chat/completions` (including SSE streaming), `POST /v1/responses`, `POST /v1/completions`, and `POST /v1/embeddings`. The routes imitate familiar shapes; they do not perform inference or execute tools.

## Quick start with Docker

```bash
cp .env.example .env
# Edit .env: set ADMIN_PASSWORD and a random ADMIN_SESSION_SECRET (at least 32 characters).
docker compose up --build -d
```

Open <http://localhost:8080>, sign in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` from `.env`, create a model, activate it, and create an API token. The generated token is shown once. Compose persists dashboard data in `./data`.

## Run locally with Node.js

Requires Node.js 22.x and npm.

```bash
npm ci
cp .env.example .env
# Edit .env and set a strong ADMIN_PASSWORD and ADMIN_SESSION_SECRET.
npm run build
npm start
```

The dashboard and API are served at <http://localhost:8080>. Generate a session secret with:

```bash
openssl rand -hex 32
```

For frontend development with hot reload, run `npm run dev` and `npm run dev:web` in separate terminals; open <http://localhost:5173>.

## Configure the public API URL

Set the optional `PUBLIC_BASE_URL` environment variable to the public origin clients should use, especially when running behind a reverse proxy. The dashboard's API Guide uses this value in its examples. If unset, the origin used to open the dashboard is used instead.

```dotenv
PUBLIC_BASE_URL=https://llm.example.com
```

Provide only the origin: no `/v1` suffix and no other path. The application listens on port `8080` by default.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | Dashboard login name |
| `ADMIN_PASSWORD` | — | Dashboard login password; set before exposing the service |
| `ADMIN_SESSION_SECRET` | — | Cookie signing secret; use a random value of at least 32 characters |
| `PORT` | `8080` | HTTP listen port |
| `DATA_DIR` | `./data` | Directory for model catalog, settings, and token hashes (`/data` in Compose) |
| `PUBLIC_BASE_URL` | Dashboard origin | Optional public origin shown in API examples |
| `API_DELAY_MIN_MS` | `180` | Minimum simulated API delay |
| `API_DELAY_MAX_MS` | `900` | Maximum simulated API delay |

The dashboard has its own username/password login. Authelia can also sit in front of the web UI as an additional access layer. API consumers use separate bearer tokens created in the dashboard.

## Connect an OpenAI-compatible client

Create and activate a model in **Models**, then create a token in **API Tokens**. Use the model ID shown in the dashboard. For example:

```bash
export OPENAI_BASE_URL=http://localhost:8080/v1
export OPENAI_API_KEY='sk-mock-your-token'
export OPENAI_MODEL='your-active-model'

curl "$OPENAI_BASE_URL/models" \
  -H "Authorization: Bearer $OPENAI_API_KEY"

curl "$OPENAI_BASE_URL/chat/completions" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$OPENAI_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello\"}]}"
```

The dashboard's **API Guide** provides copyable examples for cURL, Python and Node.js OpenAI SDKs, OpenCode, and Codex CLI. It uses `PUBLIC_BASE_URL` when configured. Claude Code uses Anthropic's Messages API and the ChatGPT app does not accept arbitrary API base URLs, so they need an adapter or a compatible tool integration to connect directly.

All `/v1` routes require `Authorization: Bearer <token>`. Only active models are listed or accepted. `/healthz` is public for container health checks. Tool calls are shaped to match a request but are never executed. Embedding vectors and reasoning text are fictional, too.

## Discover and add fictional models

Open **Marketplace** in the dashboard to search public Hugging Face model metadata and import a model card into your catalog. ArrogantLLM can record details such as model name, context length, quantization, version, and flavor when metadata is available. Some details are inferred from model names or tags; missing values are marked `unknown`.

Importing does not download weights, install software, or run a model. New imports start inactive. Turn on a model's **Active** toggle to expose it through the API. You can also create and edit fictional models manually.

## API routes

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `GET` | `/healthz` | Public health check |
| `GET` | `/v1/models` | List active mock models |
| `POST` | `/v1/chat/completions` | Chat-shaped placeholder output and optional SSE stream |
| `POST` | `/v1/responses` | Responses-shaped placeholder output |
| `POST` | `/v1/completions` | Legacy completion-shaped placeholder output |
| `POST` | `/v1/embeddings` | Fixed fake vectors, not embeddings |

## Development and tests

```bash
npm ci
npm test
npm run test:web
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project setup, conventions, and release guidance. See [DISCLAIMER.md](DISCLAIMER.md) for the project's intended use and fictional-output notice.

## Versioned Docker images

GitHub Actions runs the test suites and production build, and builds the Docker image. When a pull request is merged into `main`, the workflow increments the patch version, creates a `vMAJOR.MINOR.PATCH` tag, publishes the image to GitHub Container Registry (GHCR), and creates a GitHub Release with generated notes. Starting from `v0.1.0`, the next merged pull request creates `v0.1.1`.

The image is published with its exact version and `latest` tags. You can still publish a manually created semantic-version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The image path is `ghcr.io/<owner>/<repository>:0.1.0`.

## License

ArrogantLLM's original code and documentation are released under the MIT License; see [LICENSE](LICENSE). Third-party dependencies and metadata keep their own licenses and notices. The direct runtime dependencies declare MIT; the dependency lockfile also includes packages with other permissive licenses and attribution terms. The project license does not replace those terms.
