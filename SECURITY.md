# Security policy

DocuExtract AI is an independent portfolio project, not a commercial service. It is
still built to be safe to deploy publicly, and reports are welcome.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private
[security advisory form](../../security/advisories/new) for this repository instead.
Include the affected endpoint or file, steps to reproduce, and the impact you expect.
You should get a reply within a week. There is no bug bounty.

## Supported versions

Only the latest commit on `main` is maintained.

## What the application does to stay safe

| Area | Measure |
|---|---|
| Passwords | bcrypt; unknown emails still run a bcrypt check so timing does not reveal accounts |
| Sessions | HS256 JWT in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production); a password reset bumps a per-user token version, which signs out every existing session |
| Password reset | 256-bit random token, only its SHA-256 hash is stored, 30-minute expiry, single use (atomic), same response for known and unknown emails, rate limited |
| Isolation | every query is scoped to the signed-in user; other users' IDs return 404 (tested for every endpoint) |
| Uploads | `Content-Length` guard before parsing, magic-byte type detection, size and page limits, encrypted/corrupt PDF rejection, sanitised filenames, `nosniff` when serving files |
| Exports | spreadsheet formula injection neutralised in CSV and XLSX |
| Rate limits | Per-IP limits on auth endpoints, plus limits a forged IP cannot escape: per account on sign-in (10 per 15 min), per email on password reset (3 per hour), per user on uploads, and a global cap on new accounts and demo workspaces |
| Origin lock | Behind Vercel, the proxy attaches a secret `x-origin-secret` header (value from an environment variable, never in the repo); the API rejects requests without it using a timing-safe comparison. Only then are client-IP headers trusted; without the lock, only the TCP peer address is used |
| AI spend | hard daily caps on Gemini calls, per user and global (`AI_DAILY_LIMIT_*`); the demo workspace never calls Gemini |
| Database | Versioned Alembic migrations; Row Level Security enabled with no policies, so Supabase's public Data API cannot read any table |
| Secrets | configuration only through environment variables; `.env` files are git-ignored; CI runs gitleaks on every push |

## Known limitations

These are documented trade-offs, not oversights:

- Rate limiting is in memory and per process, so it resets on restart and is not shared
  between instances.
- The client IP behind Vercel comes from the `x-real-ip` header Vercel sets. This is
  trusted only because the origin lock guarantees every request passed through Vercel.
- Session tokens are not stored server-side; logout clears the cookie, and a password
  reset revokes all sessions, but a stolen token is otherwise valid until it expires (12 h).
- Uploaded PDFs are parsed in the API process by `pypdf`, bounded by size and page limits.
- There is no email verification on sign-up.
