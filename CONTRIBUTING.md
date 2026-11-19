# Contributing

Thanks for taking a look. This is a personal portfolio project, so the bar for changes is
"small, tested and explained". Issues and pull requests are welcome.

## Development setup

Requirements: Python 3.12+, [uv](https://docs.astral.sh/uv/), Node.js 22+.

```bash
# API on http://127.0.0.1:8000 (docs at /api/docs)
cd backend
cp .env.example .env        # optional; the app runs without any keys
uv sync
uv run uvicorn app.main:app --reload

# Web app on http://localhost:5173 (proxies /api to the API)
cd frontend
npm install
npm run dev
```

Without `GEMINI_API_KEY` the API reads documents with PDF text, Tesseract OCR and rules, so
everything works with no accounts or cost. Install Tesseract (with the `eng` and `spa`
languages) to read photos locally; without it, the OCR test is skipped.

> **Windows tip:** if `uv sync` fails with "DLL load failed … file name too long", the
> project path is too deep for some wheels. Put the virtualenv somewhere short:
> `UV_PROJECT_ENVIRONMENT=C:/venvs/docuextract uv sync`.

## Checks to run before a pull request

```bash
cd backend
uv run ruff check . && uv run ruff format --check .
uv run pytest -q                      # SQLite
TEST_DATABASE_URL=postgresql://… uv run pytest -q   # optional: against Postgres

cd frontend
npm run typecheck && npm run lint && npm test && npm run build
npx playwright install chromium && npm run test:e2e   # E2E + accessibility (axe)
```

CI runs all of the above (backend on SQLite **and** Postgres 17), plus a gitleaks secret scan.

## Conventions

- **Backend:** routers stay thin; logic lives in `services/` and `extraction/`. Every query
  that touches user data goes through an ownership helper (`get_owned_document`,
  `get_owned_schema`). New endpoints need an isolation test.
- **Frontend:** server state lives in TanStack Query hooks (`lib/queries.ts`); components
  call the typed client in `lib/api.ts`, never `fetch` directly.
- **Comments** explain *why*, not *what*. A deliberate shortcut is marked
  `shortcut: <limit>, <when to upgrade>`.
- **Never commit secrets.** `.env` files and local databases are git-ignored.

## Database changes

Edit the models in `backend/app/models.py`, then:

```bash
cd backend
uv run alembic revision --autogenerate -m "describe the change"
```

Review the generated file in `backend/migrations/versions/` (autogenerate is a draft, not
a guarantee), give new non-null columns a `server_default` so existing rows stay valid,
and commit it. The app applies pending migrations on startup; `test_migrations.py`
fails if the models and migrations drift apart.

## Regenerating assets

```bash
# Fictional sample PDFs (backend/app/demo/samples)
cd backend && uv run python -m scripts.generate_samples

# README screenshots and the demo video (uses installed Microsoft Edge to render PDFs)
cd frontend && SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts

# Video → docs/demo.gif
ffmpeg -i docs/.video/demo.webm -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" docs/demo.gif
```
