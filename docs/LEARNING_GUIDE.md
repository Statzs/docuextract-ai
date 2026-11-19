# Learning guide

This guide explains how DocuExtract AI works for someone who is new to full-stack web
development. It walks from the big picture down to individual files, defines each
technology the first time it appears, and ends every part with exercises. You do not need
a Gemini key for any of it.

**How to use it:** run the app locally first (see the README), keep it open next to this
guide, and open each file as it is mentioned. Paths are relative to the repository root.

---

## Part 1 — The big picture

### What the product does

1. A user defines a **schema**: the list of fields they want from a type of document
   (for an invoice: number, vendor, date, total…).
2. They upload a PDF or image.
3. An **extractor** reads the document and fills in each field with a value and a
   confidence score.
4. A human reviews the values next to the original, fixes mistakes and marks the document
   **validated**.
5. Validated data is exported to CSV, Excel or JSON.

### The three pieces

```
Browser ──HTTP/JSON──▶ API server ──SQL──▶ Database
(React app)            (FastAPI)            (PostgreSQL / SQLite)
                           │
                           └──▶ Gemini (AI) or the standard reader (no AI)
```

- **Frontend**: the part that runs in the browser. It draws the screens and calls the API.
  It never talks to the database or to Gemini directly.
- **Backend (API)**: a Python program that receives HTTP requests, checks who is asking,
  reads and writes the database, and runs the extraction.
- **Database**: where users, schemas, documents and usage records are stored permanently.

Why split them? The browser cannot be trusted: anyone can open the developer tools and
change what the JavaScript does. Everything that matters for security (who owns what, file
validation, the AI key) therefore lives on the server.

### Exercises

1. Open the app, press F12, go to the *Network* tab and upload a sample document. Find the
   `POST /api/documents` request and the repeated `GET /api/documents/<id>` requests that
   follow it. Why does the browser keep asking? (Answer in Part 5.)
2. Open http://127.0.0.1:8000/api/docs. This page is generated automatically from the
   backend code. Try `GET /api/health`.

---

## Part 2 — The backend, layer by layer

### Technologies

| Name | What it is | Where |
|---|---|---|
| **Python** | The programming language of the backend | `backend/` |
| **FastAPI** | A framework: you write functions, it turns them into HTTP endpoints and validates input | `backend/app/routers/` |
| **Pydantic** | Describes the shape of data with Python classes and validates it | `backend/app/schemas.py` |
| **SQLAlchemy** | Lets Python code talk to SQL databases using classes instead of raw SQL strings | `backend/app/models.py`, `db.py` |
| **uv** | Installs Python packages and runs commands in the project's environment | `backend/pyproject.toml` |
| **pytest** | Runs automated tests | `backend/tests/` |

### Follow one request

Take `POST /api/schemas` (create a schema) and read these in order:

1. **`backend/app/main.py`**: creates the `FastAPI` app and plugs in the routers. Every
   request also passes through `security_headers`, a *middleware*: code that runs around
   every request (here, to add safety headers and reject oversized uploads early).
2. **`backend/app/routers/extraction_schemas.py`**: the function decorated with
   `@router.post("")`. Look at its parameters:
   - `body: SchemaIn` means FastAPI parses the JSON body and validates it with the Pydantic
     class `SchemaIn`. A bad body never reaches your code; the client gets a `422` error.
   - `user: User = Depends(current_user)` is **dependency injection**: before calling the
     function, FastAPI runs `current_user`, which reads the session cookie and loads the
     user, or answers `401` if there is none.
   - `db: Session = Depends(get_db)` gives the function a database session that is closed
     automatically afterwards.
3. **`backend/app/schemas.py`**: `SchemaIn` and `FieldDef`. Notice the rules, such as the
   regular expression for field keys and the check that rejects duplicate keys. Validation
   at the boundary means the rest of the code can trust its input.
4. **`backend/app/models.py`**: `ExtractionSchema` is a *model*: a Python class mapped to a
   database table. `user_id` is a **foreign key**, a column that points at a row in
   another table (the owner).

### Where the real work happens

Routers are kept thin. Logic lives in plain functions that are easy to test:

- `backend/app/services/files.py` checks uploads. It ignores the file name and the type
  the browser claims, and looks at the first bytes of the file (**magic bytes**: `%PDF`
  for PDFs, `\x89PNG` for PNG images).
- `backend/app/services/processing.py` runs one extraction job, retries temporary
  failures, records usage and sets the final status.
- `backend/app/services/exporter.py` builds CSV, Excel and JSON files.
- `backend/app/extraction/` contains the two extractors behind a common interface.

### Exercises

1. Add a field `notes` (text, optional) to the *Receipt* template in
   `backend/app/demo/data.py`. Start a new demo workspace. Where does it show up?
2. In `backend/tests/test_api.py`, find `test_users_cannot_access_each_others_data`.
   Explain in one sentence why the API answers **404** and not **403** for someone else's
   document.
3. Write a test that uploads a file of 0 bytes and checks the response code. Run it with
   `uv run pytest -q -k your_test_name`.

---

## Part 3 — Data and the database

### Tables

Open `backend/app/models.py` and draw the tables on paper:

- `users` (one row per account)
- `extraction_schemas` (many per user)
- `documents` (many per user; each remembers which schema it used)
- `usage_events` (one per AI attempt)
- `password_reset_tokens` (short-lived, one per reset request)

### Three ideas worth understanding

- **Snapshot instead of reference.** A document stores a *copy* of its schema's fields
  (`schema_snapshot`). If the user edits the schema later, old documents still make sense.
- **Never overwrite the AI's answer.** `extracted_data` holds what the model returned;
  human corrections go to `reviewed_data`. `final_values()` in
  `services/exporter.py` merges them for exports. You can always see what the AI got wrong.
- **SQLite locally, PostgreSQL in production.** SQLAlchemy hides most differences, and the
  same tests run against both (see `backend/tests/conftest.py`).

### Migrations

The database's structure changes over time (for example, password reset added a column
and a table). **Alembic** records each change as a numbered *migration* in
`backend/migrations/versions/`. On startup the API applies any that are missing, so an
existing database is upgraded in place and keeps its data. See `init_db()` in
`backend/app/db.py`.

### Supabase and Row Level Security

Supabase is a hosted PostgreSQL. It also publishes every table through a public REST API.
We do not use that API, so `backend/app/db.py` turns on **Row Level Security** (RLS) with no
rules, which means "nobody may read anything" for Supabase's public roles. Our backend
connects as the table owner, which RLS does not restrict.

### Exercises

1. Run `uv run python` in `backend/` and use `SessionLocal` and `select(Document)` to list
   the documents in your local database.
2. Why is `content` (the file bytes) marked `deferred` in `models.py`? What would happen
   to the documents list page without it?

---

## Part 4 — Security, explained simply

| Threat | What could happen | What the code does |
|---|---|---|
| Stolen passwords | A database leak exposes passwords | Only **bcrypt** hashes are stored (`security.py`). bcrypt is slow on purpose, so guessing is expensive. |
| Session theft with JavaScript | Malicious script reads the login token | The token is in an **HttpOnly cookie**; JavaScript cannot read it at all. |
| Cross-site requests | Another site makes your browser act on DocuExtract | The cookie is **SameSite=Lax**, so browsers do not send it with cross-site POST requests. |
| Guessing other users' IDs | Reading someone else's documents | Every query filters by the current user (`get_owned_document`). |
| Malicious uploads | An "invoice" that is really an HTML page | Type is decided by magic bytes; files are served with `nosniff`. |
| Spreadsheet formulas | A value like `=HYPERLINK(...)` runs in Excel | Exports prefix such cells with `'`. |
| Password reset abuse | Enumerating emails, reusing links | Same answer for every email; token stored hashed; single use; expires in 30 minutes; all sessions revoked after a reset. |
| Rate-limit evasion | Faking a new IP address per request | Limits also keyed on the account, email or user; behind Vercel, an origin secret blocks direct calls |
| Surprise AI bill | A public demo gets hammered | Daily caps per user and global; demo users never call Gemini. |

### Exercises

1. In the browser's developer tools (*Application → Cookies*), find `dx_session`. Try
   `document.cookie` in the console. Why is it missing?
2. Read `reset_password` in `backend/app/routers/auth.py`. Why is "mark the token used" a
   single `UPDATE … WHERE used_at IS NULL` instead of "read the token, check it, then save"?
   (Hint: two requests at the same moment.)

---

## Part 5 — The frontend

### Technologies

| Name | What it is | Where |
|---|---|---|
| **React** | Builds the UI from *components*: functions that return what to show | `frontend/src/` |
| **TypeScript** | JavaScript with types, which catches mistakes before running | every `.ts/.tsx` file |
| **Vite** | Development server and build tool | `frontend/vite.config.ts` |
| **Tailwind CSS** | Styling with small utility classes (`flex`, `text-sm`, `rounded-xl`) | class names everywhere, tokens in `src/index.css` |
| **shadcn/ui** | Copy-in accessible components (dialogs, menus, inputs) built on Base UI | `src/components/ui/` |
| **TanStack Query** | Fetches server data, caches it, refetches it, tracks loading and errors | `src/lib/queries.ts` |
| **React Router** | Maps URLs to pages | `src/App.tsx` |
| **Motion** | Animations | page and list transitions |

### How data reaches the screen

1. `src/lib/api.ts` is a typed wrapper around `fetch`. Every API error, whatever its shape,
   becomes an `ApiError` with a message and per-field messages.
2. `src/lib/queries.ts` wraps each call in a hook such as `useDocument(id)`. The hook
   **polls** (asks again every couple of seconds) only while the document is still being
   processed. That is the answer to the Part 1 exercise.
3. A page such as `src/pages/document-detail.tsx` calls the hook and renders loading,
   error or data.

### Local state versus server state

The review form keeps the user's unsaved edits in `useState` (local state). The document
itself lives in the TanStack Query cache (server state). Keeping the two apart is what
makes "unsaved changes", per-field undo and "Save draft" straightforward.

### Exercises

1. In `src/components/common.tsx`, change the colour thresholds of `ConfidenceMeter`.
   Watch the review screen update without a page reload (that is Vite's hot reload).
2. Add a new route `/app/about` that shows a short paragraph. Use the lazy pattern already
   in `src/App.tsx`.
3. Run `npm run build` and look at the list of files. Which page pulls in the chart
   library, and why is it not in the main bundle?

---

## Part 6 — The AI part

`backend/app/extraction/gemini.py` turns the user's schema into a **response schema**: a
description of the exact JSON the model must return. Each field becomes
`{value, confidence}`, with `value` typed as a number, boolean or string. Because the model
is forced into that shape, there is no fragile text parsing.

Then `backend/app/extraction/normalize.py` cleans the values: `"1.234,56 €"` becomes
`1234.56`, `"14.10.2026"` becomes `2026-10-14`. A value that cannot be cleaned is kept, but
with low confidence, so a human sees it.

Errors are sorted into two kinds (`extraction/base.py`):
- **Transient** (rate limited, server overloaded, timeout): retried with *exponential
  backoff*, waiting 1 s, 2 s, 4 s…
- **Permanent** (bad request, invalid output): fail at once, because retrying would only
  waste money.

The **standard reader** (`extraction/text.py` + `extraction/rules.py`) is not AI. It reads
the PDF's text (or runs Tesseract OCR on photos and scans) and looks for known labels such
as `Total` or `Invoice No.` followed by a value. It is used in private mode, for demo
workspaces, and whenever Gemini is unavailable, so the app and its tests work with no key.

### Exercises

1. Add a test in `backend/tests/test_units.py` for `parse_number("CHF 1'250.00")`. Does it
   pass? If not, decide whether the parser should support it.
2. Read `test_transient_errors_are_retried_then_succeed`. How does the test make the
   extractor fail twice without any network?

---

## Part 7 — Testing and CI

| Level | Tool | Example |
|---|---|---|
| Unit | pytest, Vitest | number parsing, error-message mapping |
| Integration | pytest + FastAPI `TestClient` + real database | upload → review → export through the real API |
| End to end | Playwright | a real browser clicks through sign-up, upload, review and export |
| Accessibility | axe-core | every screen checked against WCAG 2.1 AA rules |

**CI** (continuous integration, `.github/workflows/ci.yml`) runs all of this on every push
to GitHub, plus a scan for accidentally committed secrets.

### Exercises

1. Break something on purpose (for example, remove the `user_id` filter from
   `get_owned_document`) and run `uv run pytest -q`. Which test catches it? Undo the change.
2. Run `npx playwright test --ui` in `frontend/` and watch a test drive the browser.

---

## Part 8 — Deployment

- **Vercel** serves the built frontend files and forwards `/api/*` to the backend. The
  browser therefore talks to one address, which keeps the cookie simple and safe.
- **Render** runs the backend from `backend/Dockerfile`. A **Docker image** packages the
  code with its exact Python version and libraries so it runs the same everywhere.
- **Supabase** provides PostgreSQL.
- **Environment variables** (`backend/.env.example`) hold configuration and secrets. They
  are never committed to Git.
- **Origin lock.** Vercel adds a secret header to every request it forwards, and the API
  refuses requests without it. Otherwise anyone could call the API directly and pretend to
  be a different IP address on every request to get around rate limits.

The full step-by-step is in `docs/DEPLOYMENT.md`.

### Exercise

Read `render.yaml`. Which variable would you change to make the public demo stricter about
AI spending, and what happens to a user who goes over the limit?

---

## Interview questions to practise

Try answering out loud before checking the code or `docs/INTERVIEW_GUIDE.md`.

1. Walk me through what happens between clicking *Extract* and seeing the fields.
2. Why store the AI's output and the human's corrections separately?
3. How do you stop one user from reading another user's documents? How is it tested?
4. Why an HttpOnly cookie instead of keeping the token in `localStorage`?
5. What is the difference between a transient and a permanent error, and why does it matter
   for cost?
6. Two retry requests for the same document arrive at the same time. What prevents the
   document from being processed (and billed) twice?
7. How does password reset avoid revealing whether an email has an account?
8. Why does a password reset sign the user out everywhere, and how is that implemented
   with stateless JWTs?
9. How would you move background jobs to a separate worker? What changes, and what stays?
10. What are the limits of the model's confidence score?
11. How would you support invoices with a variable number of line items?
12. What would you need to change to run two copies of the API behind a load balancer?
