---
name: agent-social
description: >
  Research YouTube via the `asocial yt` CLI — search videos, rank on cheap
  metadata, fetch descriptions/chapters/channel metadata, peek or read
  transcripts, extract still frames, and get embeddable video IDs. Use whenever
  the task involves finding, evaluating, summarizing, quoting, or embedding
  YouTube videos — "find videos about X", "what does this video say", "get the
  transcript", "summarize this YouTube link" — or when a YouTube URL or video
  ID appears and its content is needed.
---

# agent-social — YouTube

Commands print a JSON envelope to stdout — `{ ok, command, data }` on success,
`{ ok:false, command, error:{ code, message, hint } }` on failure. youtubei.js
parser warnings go to **stderr**; stdout is always clean JSON. Exit codes: 0 ok,
1 command error, 2 unknown module/command.

## Funnel (protect your context window)

Transcripts are large. NEVER full-read during exploration.

```
GATE 1 — net (CHEAP: search, captioned-only by default)
  asocial yt search "prompt engineering" --limit 30 --sort views
  asocial yt search "how to write prompts for llms" --limit 30
  Rank on title/channel/verified/viewCount/published/snippet/duration alone.
  Dedupe by `id` across query variants. Keep ~10-15. NO transcript yet.

GATE 2 — enrich (1 call: batch info)
  asocial yt info <id1> <id2> ...     # full description + chapters + captions
  Re-rank on description/chapters (real chapters = structured, quality signal).
  Drop to ~5-8. STILL no transcript.

GATE 3 — peek (CHEAP: transcript --head / --max-chars)
  asocial yt transcript <id> --head 120        # first 2 minutes
  asocial yt transcript <id> --max-chars 1500  # ~first 1500 chars
  Either sets `truncated: true`. Confirm it delivers on its title.

GATE 4 — full read (EXPENSIVE: plain transcript, survivors only)
  asocial yt transcript <id>                   # json w/ segments, or --format text
```

## Commands

### `search` — CHEAP, broad. The net.
```
asocial yt search "<query>" [--limit N] [--sort relevance|date|views|rating]
        [--upload-date all|hour|today|week|month|year] [--duration any|short|medium|long]
        [--features cc|all]
```
Captioned-only by default (`cc`); `--features all` widens to uncaptioned.
`--limit` follows pagination (page ceiling ≈ 100). Per result: `id, title,
channel, duration, url, embedUrl, viewCount, viewCountText, published, verified,
descriptionSnippet, badges`.

### `info` — 1 call, rich. Video detail OR channel metadata.
```
asocial yt info <video|url|channel> [<id|url|channel> ...]   # batch ok; `-` reads ids from stdin
```
Video → `title, description (full), channel, duration, url, embedUrl, viewCount,
published, verified, hasCaptions, captionLanguages, chapters[{title,start,startMs}]`.
Channel (`/channel/<id>`, `/@handle`, `/c/`, `/user/`, bare `UC…` or `@handle`)
→ `title, handle, subscriberCount, subscriberText, description, verified`.
Multiple targets → JSON array. `kind: "video"|"channel"` discriminates.

### `transcript` — EXPENSIVE. Peek first.
```
asocial yt transcript <id|url> [<id|url> ...] [--lang xx] [--format text|json]
        [--head SECS] [--max-chars N]
```
`--format json` (default) includes timestamped `segments[{text,startMs,durationMs}]`;
`text` is the string only. No captions → `ok:true` with `transcript: null` + `reason`
(not an error). `--lang` picks exact → base-lang → manual-over-auto track.

### `frames` — SEE a moment (needs ffmpeg + yt-dlp; the only command that does).
```
asocial yt frames <id|url> --at <t> [--at <t2> ...] [--res 720|1080|1440|2160|max]
        [--format jpg|png] [--out DIR]
```
`--at` repeatable: seconds / `mm:ss` / `h:mm:ss` / `<n>ms` (drop a transcript
`startMs` straight in). Writes files, returns `{ id, frames: [{ at, path, width,
height } | { at, error }] }`. Visuals often lag narration — grab
`--at <t> --at <t+3> --at <t+5>` and pick the clearest. Missing binaries →
`MISSING_DEPENDENCY`. Default `--res 1080`; `max` for 4K.

## Notes

- **Embedding**: every video result has `embedUrl` (`https://www.youtube.com/embed/<id>`).
- **Batch/stdin**: `info`/`transcript` take many ids → array out (single id stays a
  single envelope). Pipe: `... | asocial yt info -`.
- **Not implemented**: full video download, audio extraction (both trivially
  yt-dlp-replaceable — use yt-dlp directly).

## Errors

- `INVALID_INPUT` — empty query / unresolvable id-or-URL / bad flag. No network call.
- `FETCH_FAILED` — YouTube request failed (unavailable/private video, API change, or
  datacenter-IP block). Hint tells you to update deps and retry from residential IP.
- `MISSING_DEPENDENCY` — `frames`: ffmpeg/yt-dlp not on PATH (install hint);
  `x`: twscrape not on PATH (install hint). `UNKNOWN_COMMAND` — bad module/command.

## X — cookie-authenticated reads (needs twscrape + `.env`)

Backend: external `twscrape` binary (cookie session from `X_AUTH_TOKEN` /
`X_CT0` in `.env`; ephemeral per-call session, nothing persisted). Every
result carries `source: "x-cookie"`. READ-ONLY — no posting/likes/follows.
`from:` / `since:` operators pass through to `search`.

```
asocial x search "<query>" [--limit N]     # default 20; client-capped (twscrape ignores small limits)
asocial x thread <tweet-id|url> [--limit N]  # default 50 → { root, replies, truncated }
asocial x profile <handle|url> [--limit N]   # default 20 → { user, recentTweets }
asocial x status                             # lightweight auth probe (user_by_login @X)
```

- `INVALID_INPUT` — missing query/id/handle, bad `--limit`, or missing
  `X_AUTH_TOKEN`/`X_CT0` (hint: set them in `.env`, never commit it).
- `FETCH_FAILED` — network/auth failure; hint says to re-extract
  auth_token/ct0 cookies and update `.env`. Dead cookies make twscrape
  retry-hang — the CLI enforces a ~90s timeout and surfaces it as
  `FETCH_FAILED` with the same hint.
- `MISSING_DEPENDENCY` — `twscrape` not on PATH (`pip install twscrape`).

## Reddit (TODO)

Reddit module not built yet. `asocial r ...` returns `NOT_IMPLEMENTED` (exit 2).
