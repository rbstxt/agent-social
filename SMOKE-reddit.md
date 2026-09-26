# SMOKE-reddit.md — live smoke vs self-hosted Redlib v0.36.0

Date: 2026-09-26. Backend: `/tmp/redlib-build` (redlib-org/redlib @ main,
built `cargo build --release`, ~2m14s) serving
`http://127.0.0.1:8182`. CLI: `dist/asocial.js` with
`REDLIB_URL=http://127.0.0.1:8182`. All unit tests fixture-only (no network);
below is the live pass.

## Endpoint shapes (JSON vs HTML)

Redlib serves **HTML only** — no `.json` suffix on any route (verified live
and against `src/main.rs` route table):

- `GET /r/cli.json` → 200 with error page
  (`Reddit error 404 "null": "Not Found" | /r/cli.json/hot.json?...` —
  the suffix leaks into the upstream path).
- `GET /r/cli/comments/1a2b3c.json` → 404 text/html.
- `GET /r/cli/hot` → 200 text/html, 25× `div.post#<base36>` cards.

Selectors used (from redlib templates, confirmed live):
listing `div.post#id` → `.post_subreddit/.post_author/.created[title]`,
`.post_title a:not(.post_flair)`, `.post_score[title]` (exact count),
`.post_body`, `.post_footer .post_comments[title]`, footer `a[accesskey=N]`
`after=` token; thread `div.post.highlighted` (plain `<h1>`, NO id anchor —
engine backfills id/permalink from the ref) + `ul#post_links` permalink,
`#comment_count`, `div.thread > div.comment` with
`blockquote.replies`-nested `div.comment`, `a.deeper_replies` more-counts;
user `#user_title/#user_name/#user_description`, `#user_details`
label-then-divs (Karma/Created), `.user-comment` cards.

## Live results (posts → thread → search → user)

1. `r status` → ok, `{ reachable: true, version: "0.36.0" }`.
2. `r posts cli --sort hot --limit 3` → ok, 3 posts (e.g. `1wqpwcw`
   "anime in cli with python", score 13 exact via title attr, `commentCount`
   1, selftext body present; link post `url` null, body null).
3. `r thread 1wqpwcw --limit 10` → ok, post backfilled
   (`id: 1wqpwcw`, permalink `/r/CLI/comments/1wqpwcw/…`, `commentCount: 1`)
   + 1 comment (`pc6ixuc`, author present, permalink backfilled).
   `truncated: false`.
4. `r search "terminal shooter" --limit 3` → ok, `source: "redlib"`,
   3 mixed results. `r search "cli" --sub CLI --limit 2` → ok, 2 results.
5. `r user kekolar22 --limit 3` → ok,
   `{ name, title: "limobanri", karma: 699, created: "Jan 11 '19" }`
   + 3 cross-posted `posts`.
6. Error paths: bad sub → `FETCH_FAILED` (Redlib 404 page surfaced);
   dead port → `status` = `MISSING_DEPENDENCY` + setup hint (exit 1).
7. Arctic Shift fallback: with Redlib pointed at a dead port,
   `r search "phone" --sub AskReddit --limit 2` → ok,
   `source: "arctic_shift"`, 2 posts with constructed permalinks.
   Notes: full-text `query` REQUIRES a subreddit/author scope; it is slow
   (30s CLI timeout; frequent `Timeout. Maybe slow down a bit` under load);
   `fields=` allowlist excludes `permalink` (constructed client-side).
   Without `--sub` the fallback fails fast with a clear error.

## Caveats observed

- Fresh-post scores render as `•` (Redlib `hide_score`-ish default) →
  `score: null`, `scoreText: "• Upvotes"`.
- Media `url` may be a Redlib-proxied relative path (`/img/….png`) —
  resolve against `REDLIB_URL`.
