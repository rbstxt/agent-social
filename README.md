# agent-social

Agent-first CLI + Skill for YouTube / X / Reddit.

**YouTube module: built. X module: built (needs twscrape + `.env` cookies).** Reddit: see `r` docs below.

Design credit: the YouTube module's envelope/funnel design is adapted from
[Tamas Gabor's youtube-relay-mcp](https://github.com/gabros20/youtube-relay-mcp)
(MIT) — fresh implementation, no shared code.

## Install

```bash
bun install
bun run build        # → dist/asocial.js
bun link             # or: npm i -g .   (exposes `asocial` on PATH)
```

Prerequisites: `bun` (or node ≥ 18). `frames` additionally needs
`ffmpeg` + `yt-dlp` on PATH (`brew install ffmpeg yt-dlp`). The `x` module
needs the external `twscrape` backend on PATH:

```bash
pip install twscrape        # or: pipx install twscrape
twscrape version            # should print a version (0.20.1 verified)
```

Then add X cookies (no secrets are ever logged or committed):

```bash
cp .env.example .env
```

and fill in `X_AUTH_TOKEN` + `X_CT0` from a logged-in x.com browser session
(DevTools → Application → Cookies → x.com). Validate with
`asocial x status`. If auth breaks later, re-extract both cookies and update
`.env` (gitignored — never commit it).

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
asocial r ...   # TODO — NOT_IMPLEMENTED
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
  youtube.ts        youtubei.js engine (only module importing youtubei.js)
  ids.ts            video-id + channel-ref extraction, URL builders
  parse.ts          view-count + chapter normalizers
  transcript.ts     --head / --max-chars peek tier
  frame.ts          yt-dlp+ffmpeg extraction (only module shelling out)
  output.ts         JSON envelope helpers
  commands/         search|info|transcript|frames runners + x runners (x.ts)
tests/              bun tests (fixtures, no network, no real tokens)
SKILL.md            shared agent skill (repo root)
```

## License

MIT
