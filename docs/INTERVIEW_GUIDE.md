# Interview guide

A walkthrough of each important component: what it does, why it is built that way, and
the questions an interviewer is likely to ask. File references are relative to the repo
root.

---

## 1. The 30-second pitch

> DocuExtract turns invoices, receipts and contracts into a spreadsheet. You upload a file,
> pick the document type (it is usually suggested), and it finds the key values; you check
> them next to the original and download Excel, CSV or JSON. Reading is hybrid: Gemini when
> it is available and allowed, otherwise PDF text or Tesseract OCR plus rules, and every
> document says which method was used. The interesting engineering is around the model:
> fallbacks, quotas the owner can change live, never inventing values, secure OAuth, and
> keeping the raw output separate from human corrections. It costs nothing to run.

---

## 2. Extraction pipeline (`backend/app/services/processing.py`)

**What happens:** upload → row created as `queued` with a *snapshot* of the schema →
`BackgroundTasks` runs `process_document` → status `processing` → extractor called →
`needs_review` or `failed`.

**Key decisions**
- **Schema snapshot on the document.** If a user later edits or deletes the schema, old
  documents still know exactly which fields they were extracted with. Exports and the
  review screen read the snapshot, not the live schema.
- **Transient vs. permanent errors** (`extraction/base.py`). `TransientExtractionError`
  (429, 5xx, timeouts) is retried with exponential backoff (`1s, 2s, 4s…`). Permanent
  errors (400, invalid JSON) fail immediately, because retrying a bad request wastes money.
- **Every attempt is metered**, failures included, because failed calls can still be billed
  and are the signal you need when a provider degrades.
- **Atomic claim:** `process_document` starts with
  `UPDATE documents SET status='processing' WHERE id=? AND status='queued'` and only
  continues if one row changed. Two concurrent runs (a double-clicked retry, say) cannot
  both call the provider and bill twice. A read-then-write check would have a race window.
- **Cost guard with a fallback, not an error:** `services/limits.py::ai_block_reason`
  counts today's Gemini usage events for the user and globally. Past a limit (or in
  private mode, for demo users, with no key, or when the admin switches AI off) the job
  uses the standard reader and stores a plain-language reason. It is check-then-act, so
  concurrent jobs can overshoot by a few calls; an exact cap would need a counter row
  locked with `SELECT … FOR UPDATE`.
- **Restart recovery:** on startup, rows stuck in `queued`/`processing` become `failed` with
  a "please retry" message (`recover_interrupted_jobs`).

**Likely questions**
- *Why not Celery/Redis?* It's a single-service portfolio deployment. `BackgroundTasks`
  keeps the infrastructure to one container. The `process_document(document_id)`
  signature is already queue-shaped, so moving it to a worker is a deployment change, not
  a rewrite. I'd use a Postgres job table with `SELECT … FOR UPDATE SKIP LOCKED` before
  adding Redis.
- *What happens with two API instances?* Recovery on startup could mark another
  instance's in-flight job as failed. That is why the code carries a `shortcut:` comment
  saying it assumes a single instance.

## 3. Gemini adapter (`backend/app/extraction/gemini.py`)

- The user's fields become a **response schema**: each field is an object
  `{value, confidence}`, with `value` typed (`NUMBER`, `BOOLEAN`, `STRING`) and nullable.
  The model is forced into that shape, so there is no fragile prompt parsing.
- `temperature=0` for repeatable extraction. The file is sent as an inline part, so PDFs
  and images take the same path.
- Token counts come from `usage_metadata`.
- **Model choice is configuration.** During development `gemini-2.5-flash` was retired for
  new keys and `gemini-3.8-flash` was overloaded (503). The app surfaced both failures
  cleanly, and the default became `gemini-3.5-flash-lite` (fast, cheap, 8/8 fields
  correct on the test invoice).
- **Testing without the network:** the adapter accepts an injected `client`, and the tests
  use a fake object to cover success, 503 → transient, 400 → permanent, and invalid JSON.

*Is the confidence score real?* It is the model's self-reported confidence. That is useful
for ranking what to review first, but it is not calibrated, and the UI treats it only as a
hint ("Low confidence, please double-check").

## 4. Normalisation (`backend/app/extraction/normalize.py`)

Both providers pass their raw output through `normalize_fields`, so the rest of the system
sees one contract: numbers as floats, dates as ISO `YYYY-MM-DD`, booleans as `bool`.
- `parse_number` handles `$1,234.56`, `1.234,56 €` and `403,28`. Rule: when both
  separators appear, the last one is the decimal separator.
- A value that cannot be coerced is **kept as a string with its confidence capped at 0.3**
  instead of being dropped, so a human sees it and fixes it. Losing data silently is worse
  than showing a messy value.
- *Ambiguity:* `03/04/2026` could be 3 April or 4 March. The parser tries day-first
  formats first. This is a known limitation, and the human review step exists for it.

## 5. Human review (`backend/app/routers/documents.py::review_document`, `frontend/src/pages/document-detail.tsx`)

- `extracted_data` (the AI's output) is **never modified**. Corrections go to
  `reviewed_data`, and exports use `final_values()` = AI values overridden by human
  values. This gives an audit trail and lets you measure model accuracy later (diff
  extracted vs. reviewed).
- The server re-validates every edited value against the field type and returns per-field
  errors (`422 {fields: {...}}`), which the UI shows inline. Required fields are enforced
  only when validating, so drafts can be incomplete.
- Frontend: local form state, "unsaved changes" counter, per-field undo, confidence meter.

**A bug worth telling:** an E2E test showed that an edit typed right after landing on the
page was lost. Logging the network requests showed the original file being fetched twice,
meaning the page mounted twice. The cause was the `AnimatePresence mode="wait"` page
transition: the leaving wrapper rendered the *new* route through `<Outlet>`, then the
entering wrapper mounted it again. The fix was entry-only animations. Lesson: animation
libraries can change component identity, and E2E tests catch things unit tests cannot.

## 6. Authentication and isolation (`backend/app/security.py`)

- bcrypt hashes. On an unknown email, a dummy hash is still checked, so response time
  doesn't reveal which emails exist.
- A JWT (HS256) in an **HttpOnly, SameSite=Lax** cookie (`Secure` in production). The
  React app never touches the token, so an XSS bug cannot steal it. `SameSite=Lax` blocks
  cross-site writes (CSRF), and all GETs are read-only.
- In production, the frontend proxies `/api` through Vercel, so the cookie is first-party.
  No CORS credentials dance is needed.
- **Isolation:** every lookup goes through `get_owned_document` / `get_owned_schema`, which
  filter by `user_id`. Another user's ID returns **404, not 403**, so IDs cannot be
  probed. `test_users_cannot_access_each_others_data` checks every endpoint.
- **Revocation:** every JWT carries the user's `token_version`. A password reset bumps it,
  so every session issued before the reset is rejected. Plain logout still only clears
  the cookie on that device.

**Password reset** (`backend/app/routers/auth.py`)
- The emailed token is `secrets.token_urlsafe(32)`; only its SHA-256 is stored, so a
  database leak does not leak usable links. (A fast hash is fine here: the token has 256
  bits of entropy, unlike a password.)
- Single use is enforced by `UPDATE … SET used_at=now WHERE token_hash=? AND used_at IS NULL
  AND expires_at > now`, so two simultaneous submissions cannot both succeed.
- `/forgot-password` returns the same 202 body whether or not the email exists, and the
  email is sent in a background task, so timing does not reveal accounts either.
- Without SMTP, development logs the link; production hides the feature entirely
  (`password_reset_enabled` in `/api/config`).

## 7. Supabase (`backend/app/db.py`)

- Supabase is used as **managed PostgreSQL**. Auth stays in the backend, so there is one
  auth path that works offline and in tests.
- **RLS lock-down:** Supabase auto-exposes `public` tables through its REST Data API to
  anyone holding the anon key. At startup the app runs `ENABLE ROW LEVEL SECURITY` with no
  policies. The backend connects as the table owner (which bypasses RLS), while
  `anon`/`authenticated` see nothing. This was verified on Postgres: the owner sees rows,
  a non-owner role sees 0.
- `psycopg` 3 driver. Use the **session pooler / direct (5432)**, not the transaction
  pooler, because psycopg uses server-side prepared statements.

## 8. Upload security (`backend/app/services/files.py`, `backend/app/main.py`)

Layers, in order:
1. A `Content-Length` over the limit → 413 *before* Starlette writes the multipart body
   to disk.
2. Bounded read (`limit + 1` bytes).
3. **Magic bytes decide the type**: the browser's content type and the file extension are
   ignored. A `.pdf` holding HTML is rejected (covered by an E2E test).
4. PDFs are parsed: corrupt, encrypted, zero-page or over-page-limit files are rejected.
5. Filename sanitised (path components stripped, unsafe characters replaced).
6. Served back with the sniffed MIME type and `nosniff`, so the browser cannot be
   tricked into rendering it as HTML.

Exports neutralise **CSV/formula injection** (`=HYPERLINK(...)` becomes `'=HYPERLINK(...)`).

## 9. Frontend architecture

- **TanStack Query** owns all server state; there is no Redux. Polling is conditional:
  `refetchInterval` is active only while a visible document is `queued`/`processing`.
- **Typed API client** (`lib/api.ts`) converts every FastAPI error shape (string,
  Pydantic list, custom `{message, fields}`) into one `ApiError` with per-field messages.
- **Route-level code splitting** cut the initial JS from 388 KB to about 120 KB gzipped
  (about 155 KB after adding `MotionConfig` for reduced-motion support).
- Theme: CSS variables in `oklch`, dark/light/system, applied before first paint by an
  inline script so there is no flash.
- **Design identity:** "ink on paper" neutrals plus a single highlighter accent. The
  highlighter marks what the AI found (the `.marker` stroke on the sign-in page, active
  nav, primary actions in dark mode). Monospace (IBM Plex Mono) is used for extracted
  values, because they are data.

## 10. Testing strategy

| Level | Tool | What it proves |
|---|---|---|
| Unit | pytest | Number/date parsing, upload validation, Gemini adapter error classification (SDK faked) |
| Integration | pytest + TestClient + real DB | Every endpoint, cross-user isolation, retries, usage metering, exports, demo seeding, restart recovery, 413 guard |
| Same suite on Postgres | CI service container (embedded Postgres locally) | No SQLite-only assumptions |
| Frontend unit | Vitest + Testing Library | Error mapping, formatting, key generation, components |
| E2E | Playwright | Real browser + real API: sign-up → upload → review → validate → CSV; bad files; auth redirects; demo tour; re-run confirmation; forgot password |
| Accessibility | axe-core in Playwright | WCAG 2.1 A/AA rules on every screen, light and dark |

*Why not test Gemini live in CI?* It would cost money, be flaky (the 503s seen during
development), and need a secret in CI. The adapter's contract is unit-tested, and live
calls are a documented manual check.

## 11. Honest answers to hard questions

- *Is the standard reader AI?* No. It is PDF text or Tesseract OCR plus label rules. Each
  document shows a badge (*Read by AI*, *Text reading*, *OCR*) so users know.
- *How do you stop the AI from making things up?* Values must fit the template's JSON
  schema; AI values are searched for in the PDF's own text and get low confidence if absent;
  the rules never guess (no label, no value); and a human validates every document.
- *How accurate is it?* `scripts/benchmark.py` generates fictional documents in several
  layouts, including wordings the rules have never seen, and scores every field (about
  95 % for text reading on these). Synthetic documents are easier than real ones, which is
  why review is built in.
- *What would you do next?* A durable job queue, object storage for
  files, line-item tables (repeating fields), an accuracy dashboard comparing extracted vs.
  reviewed values, and email verification.
- *What was verified?* See "What has been verified" in the README. The Docker image,
  GitHub Actions run and live cloud deployment were **not** verified in the development
  environment.

## 12. Bugs found by the tests, worth telling

- **Lost edits from a page transition** (section 5).
- **Contrast:** the axe audit flagged light-mode warning/success badge text at 2.8:1. The
  status colour tokens were darkened to pass 4.5:1. The same audit at first also "failed"
  text that was mid fade-in, so it now waits for entry animations before measuring.
- **Lazy routes and fast typists:** react-router keeps the old page on screen while a lazy
  page loads. A test typed into the *login* form's Email field just before the
  forgot-password page replaced it. The fix in the test was to wait for the new heading.

## 13. Rate limiting that survives a forged IP

**The bug:** the first version trusted `X-Forwarded-For` from anyone (`--forwarded-allow-ips='*'`).
Render's proxy appends to that header without removing what the client sent, so a script
calling the API host directly could invent a new IP per request and never hit a limit.

**The fix, in two layers** (`backend/app/security.py`, `backend/app/main.py`):
1. **Origin lock.** Vercel attaches a secret header to every proxied request (a route
   transform reading an environment variable). The API refuses anything without it, using
   `hmac.compare_digest`. With direct access closed, the first `X-Forwarded-For` entry,
   which Vercel overwrites with the visitor IP, can be trusted, and only then is it used.
   (First attempt used `x-real-ip`; the live logs showed `127.0.0.1` for everyone because
   Render's proxy rewrites that header. Checking production logs caught it.)
2. **Keys an attacker can't rotate.** Sign-in attempts are limited per *target account*,
   reset requests per *email*, uploads per *user*, and new accounts and demo workspaces
   by a *global* hourly cap. These hold even if the IP is wrong.

*Trade-off to mention:* the per-account sign-in limit lets someone lock a known account
out for 15 minutes. That is the usual price of stopping distributed brute force without a
CAPTCHA.

## 14. Migrations on a database that predates them

Alembic was added after the app already had databases created by `create_all`. Running
`upgrade head` on those would fail ("table already exists"). `init_db()` detects a database
with tables but no `alembic_version`, inspects the `users` columns to see which revision it
matches, `stamp`s that revision, then upgrades. The new column has a `server_default`, so
existing rows get a valid value. A test builds a pre-migration database with data and
checks that the data survives.

## 15. Hybrid reading and fallbacks (`backend/app/services/processing.py::_hybrid`)

**What happens:** the job asks `ai_block_reason` whether AI may be used. If yes, Gemini
runs with retries; any final error falls through to `StandardExtractor`. The method
actually used is stored in `provider` and the reason in `notes`.

**Questions to expect**
- *Why not just fail when Gemini is down?* The user came to get data out of a document. A
  slightly less capable result, clearly labelled, beats an error page.
- *Why Tesseract on the server and not in the browser?* tesseract.js means a ~10 MB
  download per visitor and is slow on phones. The server already has the file; the cost is
  CPU on a small free instance, bounded by `OCR_MAX_PAGES` and a timeout.
- *How is the type suggested?* `extraction/classify.py` scores keywords in the PDF text
  and filename and only suggests when one type clearly wins. A wrong suggestion costs a
  click; a hidden wrong guess would cost trust.

## 16. Google and GitHub sign-in (`backend/app/routers/oauth.py`)

- **PKCE + signed state cookie:** the start endpoint stores `state` and the PKCE verifier
  in a short-lived signed `HttpOnly` cookie; the callback rejects a missing or different
  state (CSRF / login injection) and exchanges the code server-side.
- **Linking by verified email only.** An attacker could register `victim@gmail.com` with a
  password before the victim ever signs in with Google. When the verified Google sign-in
  arrives, that unverified account's password is wiped and its sessions revoked
  (`token_version`), so the attacker is locked out. Tested in `tests/test_product.py`.
- **Admin by allow-list + verified email:** `ADMIN_EMAILS` alone is not enough, because
  anyone could register that email with a password; the account must be provider-verified.

## 17. Demo script (3 minutes, works on a phone)

1. Landing page: one sentence on the problem, show the examples tabs.
2. *Try it now*: open a checked invoice; point at confidence and the method badge.
3. Open the scanned photo, choose *Receipt*, *Extract information*: OCR live.
4. *Extract a document* → purchase-order sample: type already suggested; extract.
5. *Download* → Excel.
6. If you are signed in as the owner, open the admin panel: quota, fallbacks, limits.
7. Close with the fallback story and the privacy choice (Smart vs Private).
