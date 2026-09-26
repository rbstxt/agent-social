# SMOKE-x — live X module verification (no secrets)

Date: 2026-09-27. Backend: **twscrape 0.20.1** (`pip install twscrape`;
no fallback needed — twscrape worked first try). Credentials: repo `.env`
(`X_AUTH_TOKEN`/`X_CT0`, gitignored; values never recorded here).
Binary under test: `dist/asocial.js` run via `node` (validates the
`.env`-fallback reader, since node — unlike bun — does not auto-load `.env`).

| # | Command | Result |
|---|---------|--------|
| 1 | `x status` | `ok:true`, `authenticated:true`, `twscrapeVersion:"0.20.1"`, probe `@X` id `783214` |
| 2 | `x search "from:X" --limit 3` | `ok:true`, exactly 3 tweets (client-side cap; twscrape 0.20.1 ignores small `--limit`, yields ~25-row first page — capped in `src/commands/x.ts`), all `source:"x-cookie"` |
| 3 | `x thread 2103299958007095807 --limit 5` | `ok:true`, root `2103299958007095807` ("this used to be a draft believe it or not") + 4 replies in order, `truncated:true` |
| 4 | `x profile X --limit 3` | `ok:true`, user `@X` (~60.7M followers), 3 recent tweets |

Notes:
- twscrape CLI has no `--help` on the top level (lists subcommands instead);
  per-command help is `twscrape <cmd> --help`. Cookie format accepted:
  `auth_token=…; ct0=…` via stdin to `add_cookie`.
- Dead cookies make twscrape retry-hang (no fast failure observed); the
  bridge enforces a ~90s per-call timeout and maps it to `FETCH_FAILED`
  with the re-extract-cookies hint.
- Stderr on success is twscrape log noise only; stdout is clean JSON.
