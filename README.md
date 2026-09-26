# agent-social

Agent-first CLI + Skill for YouTube / X / Reddit.

**YouTube / X / Reddit modules: built.** X needs twscrape + `.env` cookies. Reddit's Redlib auto-starts on demand (nothing resident).

Design credit: the YouTube module's envelope/funnel design is adapted from
[Tamas Gabor's youtube-relay-mcp](https://github.com/gabros20/youtube-relay-mcp)
(MIT) — fresh implementation, no shared code.

## Install (one script)

```bash
./scripts/setup.sh
```

This checks/installs everything and guides cookie setup:

1. runtime: node ≥ 18, bun or npm
2. system: `ffmpeg`, `yt-dlp` (macOS: via brew when available)
3. python: `twscrape` (+ `yt-dlp` fallback) via pipx or pip --user
4. `redlib` binary (Linux: release download; macOS: cargo build; skipped if present)
5. repo deps + build + `npm link` (global `asocial`; `--no-link` to skip)
6. macOS Redlib idle-reaper (launchd; nothing stays resident)
7. credentials → `.env` (gitignored, `chmod 600`):
   - **X (required for `x`)**: guided prompt for `auth_token` + `ct0`
     (x.com DevTools → Application → Cookies). Validate: `asocial x status`.
     Re-extract when auth breaks.
   - **YouTube (optional)**: guided prompt for the youtube.com `Cookie`
     header → `YT_COOKIE`. Enables age-restricted videos for
     `yt search/info/transcript` (youtubei.js login) and `yt frames`
     (yt-dlp `--cookies`). Empty = anonymous access.

Flags: `--yes --no-link --skip-redlib --skip-python --reconfigure --help`.
Secrets are read with echo disabled and never printed. No secrets are ever
logged or committed (`.env` is gitignored).

Manual equivalent (if you prefer each step by hand):

```bash
bun install && bun run build   # or: npm install && npm run build
npm link                       # exposes `asocial` on PATH
pipx install twscrape yt-dlp   # or: pip install --user twscrape yt-dlp
# redlib: see "Reddit backend" below
cp .env.example .env           # then fill X_AUTH_TOKEN/X_CT0 (+ optional YT_COOKIE)
```

## Usage

Every command prints a JSON envelope to stdout (`{ ok, command, data }`;
errors: `{ ok:false, command, error:{ code, message, hint } }`). Exit codes:
0 ok, 1 command error, 2 unknown module/command.

```bash
asocial yt search "agentic engineering" --limit 30 --sort views  # captioned-only by default
asocial yt info <id|url|channel> [<id> ...]                      # video detail or channel meta; `-` reads stdin
asocial yt transcript <id|url> --head 120                        # peek first; full read survivors only
asocial yt frames <id|url> --at 1:30 --at 2:00 --res 1080 --out ./frames
asocial x search "from:X" --limit 10      # X search (from:/since: pass through); every result has source:"x-cookie"
asocial x thread <tweet-id|url> --limit 30
asocial x profile <handle> --limit 10
asocial x status                           # validate X cookies
asocial r status                           # ping local Redlib (reachability + version)
asocial r posts cli --sort hot --limit 20  # subreddit listing (r/ prefix optional)
asocial r thread <post-id|url> --limit 50 --max-chars 1500  # post + comment tree
asocial r search "query" --sub NAME --limit 20              # Redlib; Arctic Shift fallback (source marked)
asocial r user <name> --limit 20         # profile + recent posts/comments
```

### Reddit backend: local Redlib (no Reddit credentials)

Official Reddit OAuth is approval-gated, and public Redlib instances are
unusable (rate-limited / JS-proof-walled), so `asocial r` talks to a
**self-hosted** Redlib (AGPL-3.0, external service — our code stays MIT).
Redlib auto-starts on demand: the first `r` command spawns a detached local
`redlib` (found via `REDLIB_BIN`, `PATH`, or `~/.local/bin/redlib`) when
`REDLIB_URL` is a loopback URL and nothing listens, then waits for readiness.
An idle reaper (`scripts/redlib-idle-reap.sh`, launchd every 10 min,
`com.agent-social.redlib-reap`) kills it after 10 min without use and no open
connections — nothing stays resident. `r status` reports `autostarted: true`
when it cold-started (expect a few seconds delay).

To install the binary (once; keep the build outside the repo):

```bash
git clone https://github.com/redlib-org/redlib /tmp/redlib-build
cd /tmp/redlib-build && cargo build --release   # boring-sys2 compiles BoringSSL — slow, allow ~2-10 min
cp target/release/redlib ~/.local/bin/redlib
```

Then just run (default `http://127.0.0.1:8182`):

```bash
asocial r status    # → { reachable: true, version, baseUrl, autostarted }
```

See [SKILL.md](./SKILL.md) for the agent workflow (the funnel: cheap search →
info shortlist → transcript peek → full read; frames pair with `startMs`).

Full video download and audio extraction are intentionally omitted — both are
trivially yt-dlp-replaceable (`yt-dlp <url>`).

## Development

```bash
bun install
bun run check      # typecheck + tests
bun test           # unit tests (pure normalizers + CLI parsing, no network)
bun run build      # → dist/
```

## Project layout

```
src/
  cli.ts            asocial entry: yt|x|r routing
  yt.ts             `yt` arg parsing + dispatch (search|info|transcript|frames)
  x.ts              `x` arg parsing + dispatch (search|thread|profile|status)
  xnorm.ts          pure twscrape Tweet/User → envelope normalizers (no network)
  xengine.ts        twscrape CLI bridge: ephemeral cookie session, enforced timeouts
  r.ts              `r` arg parsing + dispatch (status|posts|thread|search|user)
  reddit.ts         Redlib engine + Arctic Shift search fallback (only fetcher)
  reddit_parse.ts   pure Redlib HTML → data normalizers (no network)
  youtube.ts        youtubei.js engine (only module importing youtubei.js)
  ids.ts            video-id + channel-ref extraction, URL builders
  parse.ts          view-count + chapter normalizers
  transcript.ts     --head / --max-chars peek tier
  frame.ts          yt-dlp+ffmpeg extraction (only module shelling out)
  output.ts         JSON envelope helpers
  commands/         search|info|transcript|frames runners + x runners (x.ts)
tests/              bun tests (fixtures, no network, no real tokens; reddit fixtures are fictional)
SKILL.md            shared agent skill (repo root)
SMOKE-reddit.md     live Redlib smoke log (posts→thread→search→user)
```

## License

MIT
