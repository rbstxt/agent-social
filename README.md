# agent-social

Agent-first CLI + Skill for YouTube / X / Reddit.

**YouTube module: built.** X and Reddit are placeholders (TODO).

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
`ffmpeg` + `yt-dlp` on PATH (`brew install ffmpeg yt-dlp`).

## Usage

Every command prints a JSON envelope to stdout (`{ ok, command, data }`;
errors: `{ ok:false, command, error:{ code, message, hint } }`). Exit codes:
0 ok, 1 command error, 2 unknown module/command.

```bash
asocial yt search "agentic engineering" --limit 30 --sort views  # captioned-only by default
asocial yt info <id|url|channel> [<id> ...]                      # video detail or channel meta; `-` reads stdin
asocial yt transcript <id|url> --head 120                        # peek first; full read survivors only
asocial yt frames <id|url> --at 1:30 --at 2:00 --res 1080 --out ./frames
asocial x ...   # TODO — NOT_IMPLEMENTED
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
  cli.ts            asocial entry: yt|x|r routing (x/r → NOT_IMPLEMENTED)
  yt.ts             `yt` arg parsing + dispatch (search|info|transcript|frames)
  youtube.ts        youtubei.js engine (only module importing youtubei.js)
  ids.ts            video-id + channel-ref extraction, URL builders
  parse.ts          view-count + chapter normalizers
  transcript.ts     --head / --max-chars peek tier
  frame.ts          yt-dlp+ffmpeg extraction (only module shelling out)
  output.ts         JSON envelope helpers
  commands/         search|info|transcript|frames runners
tests/              bun tests (no network)
SKILL.md            shared agent skill (repo root)
```

## License

MIT
