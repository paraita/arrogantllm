# Contributing

Thanks for helping improve Make Believe LLM. Keep changes small, tested, and consistent with the project's purpose: a clearly labeled development mock with no real inference.

## Development setup

Use Node.js 22.x and npm:

```bash
npm ci
cp .env.example .env
npm run dev
```

For the dashboard with Vite hot reload, start a second terminal and run:

```bash
npm run dev:web
```

The dashboard runs on port `5173` and proxies API requests to the Express server on port `8080`. To check the production dashboard build, run `npm run build`; the Express server serves the resulting `web/dist` files.

## Checks

Run these before opening a change:

```bash
npm test
npm run test:web
npm run build
```

Backend tests use Node's built-in test runner and Supertest. Dashboard tests use Vitest, jsdom, and Testing Library. The GitHub Actions workflow runs the same checks and builds the Docker image on branch pushes and pull requests.

## Project layout

- `server/` contains Express startup, configuration, JSON persistence, auth, marketplace access, and OpenAI-compatible routes.
- `web/` contains the React dashboard and Vite build configuration.
- `tests/` contains backend and HTTP integration tests; `web/src/` contains dashboard tests.
- `Dockerfile`, `docker-compose.yml`, and `.github/workflows/ci.yml` define container builds, local runtime, and CI/release automation.

The Hugging Face integration may read model metadata and `config.json`; it must never download model weight files. Keep marketplace data marked with its source and its published/inferred/unknown provenance. Keep fake inference explicit in code, tests, and docs.

## Pull requests

- Explain the user-facing change and any configuration impact.
- Add or update tests for behavior changes.
- Keep documentation and dashboard copy in English.
- Never commit `.env`, API token secrets, session secrets, local `data/`, or build output.
- Do not add real inference, real model weights, or honeypot behavior.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), for example:

```text
feat: add model metadata filters
fix: reject inactive model requests
test: cover streaming disconnects
docs: clarify local admin setup
ci: publish versioned container images
```

Use imperative, concise descriptions. Common types are `feat`, `fix`, `test`, `docs`, `chore`, and `ci`.

## Release process

The workflow publishes a container to GitHub Container Registry only when a pushed tag matches `vMAJOR.MINOR.PATCH`. Create and push the tag after the release is ready:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The GHCR image receives version, major.minor, and major tags. Branch pushes and pull requests run CI and build the image without publishing it.
