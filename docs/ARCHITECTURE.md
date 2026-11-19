# Architecture

DocuExtract AI is a two-tier web application: a React single-page app talking to a
FastAPI service over a JSON API, backed by PostgreSQL (Supabase in production, SQLite
for local development and tests).

```
 Browser (React SPA)                     FastAPI service                        Data
┌──────────────────────┐   /api/*   ┌────────────────────────────┐      ┌──────────────────┐
│ React Router pages   │──────────▶│ routers/   (HTTP layer)     │      │ PostgreSQL        │
│ TanStack Query cache │  cookie    │   auth, documents, schemas,│─────▶│ (Supabase)        │
│ shadcn/ui + Tailwind │  session   │   exports, usage           │ SQLA │ users, schemas,   │
│ Motion animations    │◀──────────│ services/  (domain logic)   │      │ documents (+blob),│
└──────────────────────┘   JSON     │   files, processing,       │      │ usage_events      │
                                    │   exporter, demo_seed      │      └──────────────────┘
                                    │ extraction/ (AI providers) │
                                    │   GeminiExtractor ─────────┼────▶ Google Gemini API
                                    │   StandardExtractor (text, │
                                    │   OCR, rules; no AI)       │
                                    └────────────────────────────┘
```

## Request lifecycle of an extraction

1. `POST /api/documents` (multipart). `services/files.py` validates the upload:
   size limit, magic bytes (the declared content type is ignored), PDF parseability,
   page limit and encryption, image decoding and pixel limit, and sanitises the filename.
   The daily upload cap is checked, expired documents are purged, and a file whose
   SHA-256 the user already uploaded returns the existing document (`duplicate: true`).
2. Without a template the document stays `uploaded` and the response carries
   `suggested_schema_id` (`extraction/classify.py`, keyword scoring on the PDF text and the
   filename; it only suggests when one type clearly wins).
3. `POST /api/documents/{id}/extract {schema_id, mode}` stores a **snapshot of the
   template's fields** (later template edits never change old results) and the mode
   (`auto` = AI when possible, `private` = never AI), then queues the job.
4. A FastAPI `BackgroundTask` runs `services/processing.py::process_document`:
   - atomically claims the job (`UPDATE … WHERE status = 'queued'`), so two runs of the
     same document can never both call the provider;
   - decides whether AI may be used (`services/limits.py::ai_block_reason`: private mode,
     demo user, no key, admin switch off, global or per-user daily cap). If yes, Gemini is
     called; transient errors (HTTP 429/5xx, timeouts) are retried with exponential
     backoff up to `EXTRACTION_MAX_ATTEMPTS`;
   - if AI is not allowed or fails, the standard reader runs instead and the reason is
     stored in `notes`; `provider` records the method actually used (`gemini`, `text`, `ocr`);
   - AI values are checked against the PDF text layer (`extraction/verify.py`); values
     that cannot be found are capped at 40 % confidence;
   - every attempt is written to `usage_events` (tokens, latency, success/error);
   - status → `needs_review` on success, `failed` (with a user-safe message) otherwise.
5. The client polls `GET /api/documents/{id}` while the status is `queued`/`processing`.
6. The user reviews fields side by side with the original file, edits values and
   marks the document `validated`. Edited values are stored in `reviewed_data`;
   the original AI output in `extracted_data` is never overwritten (audit trail).
7. `POST /api/documents/{id}/retry` re-queues a failed or reviewed document. The UI asks
   for confirmation first when that would discard human edits.

## Extraction providers

`extraction/base.py` defines a tiny `Extractor` protocol:
`extract(content, mime_type, fields) -> ExtractionResult`.

| Provider | When | How |
|---|---|---|
| `GeminiExtractor` | Smart mode, key set, quota left | Sends the raw file as an inline part with a JSON **response schema** generated from the template's fields (each field → `{value, confidence}`), `temperature=0`, and a system instruction that the document is untrusted data. |
| `StandardExtractor` | private mode, demo users, or AI unavailable | `extraction/text.py` reads the PDF text layer with `pypdf` (layout mode keeps table columns apart). Pages with almost no text are treated as scans: rendered with `pypdfium2` at 200 dpi and read by Tesseract (eng+spa), up to `OCR_MAX_PAGES`. Images go straight to Tesseract. `extraction/rules.py` then matches label synonyms (English and Spanish) on the same line, after a separator, or on the next line, and types the value. Confidence reflects how the value was found and is lowered for OCR text. Nothing is guessed: no label, no value. |

Both outputs pass through `extraction/normalize.py`, which coerces values to the
declared field type (numbers, ISO dates, booleans) so the UI and exports see
consistent data regardless of provider.

## Security model

| Concern | Measure |
|---|---|
| Authentication | Google and GitHub OAuth (PKCE + signed state cookie, verified-email linking) or email + password with bcrypt hashes; short-lived HS256 JWT in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). The SPA never sees the token, so XSS cannot exfiltrate it. |
| Brute force | In-memory sliding-window limits. Per IP on auth endpoints, and keyed on things a forged IP cannot change: the target account for sign-in, the email for password reset, the user for uploads, and a global cap on new accounts/demo workspaces. |
| Client IP | `security.client_ip` uses the TCP peer by default. Proxy headers are ignored unless the origin lock is on. Behind Vercel, `CLIENT_IP_HEADER=x-forwarded-for` takes the first entry, which Vercel overwrites with the visitor IP (Render then appends its own hop, and rewrites `x-real-ip`, which is why that header is not used). |
| Origin lock | Vercel's route transform sets `x-origin-secret` from its `ORIGIN_SECRET` environment variable on every proxied request; `main.py` returns 403 to anything else except `/api/health`. The startup check refuses `CLIENT_IP_HEADER` without a 32+ character secret. |
| Password reset | `secrets.token_urlsafe(32)` emailed once; only its SHA-256 is stored; 30-minute expiry; single use enforced atomically; identical response for unknown emails. A successful reset bumps `users.token_version`, which is embedded in every JWT, so all existing sessions stop working. |
| AI cost | Daily Gemini caps per user and global, counted from `usage_events` (retries count), stored in `app_settings` and editable in the admin panel. Over a cap, documents fall back to the standard reader. Demo users never reach Gemini. |
| Data isolation | Every query goes through helpers that filter by `user_id`; foreign IDs return **404, not 403**, to avoid leaking existence. Covered by integration tests. |
| Upload safety | `Content-Length` checked before the body is parsed (413), then a bounded read, magic-byte sniffing (the client's content type is ignored), size/page limits, encrypted/corrupt PDF rejection, filename sanitisation. Originals are served with the sniffed type and `X-Content-Type-Options: nosniff`. |
| Supabase Data API | Row Level Security is enabled on every table at startup with **no policies**. The backend connects as the table owner (which bypasses RLS), while Supabase's `anon`/`authenticated` roles see nothing. Verified against PostgreSQL: owner sees rows, non-owner role sees 0. |
| CSRF | `SameSite=Lax` cookies are not sent on cross-site POST/PUT/PATCH/DELETE, and all GET endpoints are read-only. |
| Prompt injection | Text inside a document could try to steer the model. The system instruction tells the model the document is data; output is constrained to the JSON schema; the model has no tools; values absent from the PDF text are flagged; and every value goes through human review before it counts as validated. |
| API keys | Gemini key exists only in the backend environment. The frontend has no secrets. |
| Export | CSV/XLSX cells beginning with `= + - @` are prefixed with `'` to prevent formula injection. |
| Errors | Provider errors are logged server-side; users get generic messages. |

## Data model

```
users ─┬─< extraction_schemas            (fields: JSON list of field definitions)
       ├─< password_reset_tokens         (token_hash, expires_at, used_at)
       ├─< documents >── schema (nullable, SET NULL on delete)
       │      content (bytes, deferred-loaded), schema_snapshot, extracted_data,
       │      reviewed_data, status, attempts, error
       └─< usage_events >── document (nullable)
```

Files are stored in the `documents.content` column (`bytea`). This keeps the
deployment to one stateful service, which is fine for a portfolio workload
(10 MB limit). The upgrade path is Supabase Storage / S3 with signed URLs.

## Database migrations

Schema changes are versioned with **Alembic** (`backend/migrations/`). On startup,
`db.init_db()` runs `upgrade head`:

- A fresh database gets every revision in order.
- A database created before migrations existed (by `create_all`, with no `alembic_version`
  table) is inspected and **stamped** with the revision it actually matches, then upgraded.
  No data is dropped. This was verified on a real pre-migration database: 1 user,
  7 documents, 4 schemas and 10 usage events kept, `token_version` added with default 0.
- `tests/test_migrations.py` checks that migrations and models describe exactly the same
  schema (`compare_metadata` → no differences), on SQLite and PostgreSQL.

New change: edit the models, run `uv run alembic revision --autogenerate -m "…"`, review
the generated file, commit it.

## Frontend structure

```
src/
  lib/api.ts          typed fetch wrapper, ApiError, all endpoints
  lib/queries.ts      TanStack Query hooks (cache keys, polling, invalidation)
  components/ui/      shadcn/ui primitives
  components/         app-level components (AppShell, UploadDropzone, StatusBadge…)
  pages/              one file per route
```

Server state lives in TanStack Query; there is no global client store. Polling is
enabled only while a document is `queued`/`processing`.

## Known limitations (honest list)

- Background processing uses in-process `BackgroundTasks`. On startup, jobs left
  `queued`/`processing` by a restart are marked `failed` with a clear message so users can
  retry. A multi-instance deployment needs a durable queue (Postgres job table, Redis worker).
- Rate limiting is per process and in memory.
- The AI quota is check-then-act, so concurrent extractions can overshoot it by a few calls (the extra documents simply use AI; nothing breaks).
- Migrations run automatically on startup, which is right for a single instance; with
  several instances, run `alembic upgrade head` as a release step instead.
- Supabase is used as managed PostgreSQL. Supabase Auth and Storage are not used,
  so a single, fully testable auth path exists locally and in production.
- OCR runs in the API process on a 0.1-CPU free instance: a photo takes seconds, and only the first `OCR_MAX_PAGES` pages of a scan are read. Browser-side OCR (tesseract.js) was considered and rejected: a ~10 MB download per visitor and slow on phones.
- The rules read flat label/value fields; line-item tables are not extracted.
- Sessions are stateless JWTs. Password reset revokes them all through `token_version`;
  logout only clears the cookie on that device.
- `pypdf` parses untrusted PDFs in-process. Size and page limits bound the cost, but a
  hardened deployment would parse in a sandboxed worker.

## Frontend decisions worth knowing

- **Route-level code splitting**: pages load lazily (`react-router` `lazy`), keeping the
  initial bundle at about 155 KB gzipped (about 33 KB of it is Motion's `MotionConfig`,
  kept so animations honour the OS *reduce motion* setting). Charts load only on the pages that use them.
- **Enter-only page transitions**: an `AnimatePresence mode="wait"` exit transition
  rendered the *new* route inside the leaving wrapper and then remounted it, which
  silently discarded edits made in the first ~200 ms. An E2E test caught this, and it was
  fixed by animating entry only.
- **Form state vs. server state**: the review form keeps local edits and re-syncs only
  when the server copy actually changes. TanStack Query's structural sharing keeps the
  object identity stable when a refetch returns identical data.
