# Smoke log — YouTube module (youtubei.js 18.1.0, bun 1.4.0, 2026-09-27)

All commands run against the built binary (`node dist/asocial.js`). No secrets involved.

## 1. search (captioned-only default, enriched signals)

`yt search "agentic engineering" --limit 3` → ok, 3 results, all `badges: ["CC"]`.
First hit: `FgaBdwSvOGM` "Agentic Engineering vs Software Engineering: Beyond Vibe Coding",
IBM Technology, 10:46, 51283 views, "1 month ago".

## 2. info (video: chapters + captions)

`yt info FgaBdwSvOGM` → ok. `duration: 10:45`, `viewCount: 51288`,
`hasCaptions: true`, `captionLanguages: ["en","en"]`, 9 chapters parsed
(e.g. `0:31 Agentic engineering` → startMs 31000). Full description present.

## 3. transcript (peek tier + json3 timedtext)

`yt transcript FgaBdwSvOGM --head 60 --format text` → ok, `lang: en`,
`source: innertube`, `truncated: true`, opening narration about agentic engineering.
`--head 30 --max-chars 200` (json) → 2 segments, 148 chars, `truncated: true`.
Signed `caption_tracks[].base_url + fmt=json3` path confirmed working on 18.1.0.
(`info.getTranscript()` avoided per design — InnerTube 400s.)

## 4. frames (yt-dlp + ffmpeg, multi-timestamp)

`yt frames FgaBdwSvOGM --at 31 --at 2:22 --res 720 --out /tmp/asocial-smoke` → ok,
2 frames: `FgaBdwSvOGM-31s.jpg` (24KB) + `FgaBdwSvOGM-142s.jpg` (52KB), both 1280x720.

## 5. info (channel: id + @handle)

- `yt info https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ` → ok:
  title "Marques Brownlee", handle `@mkbhd`, `subscriberCount: 21300000`
  ("21.3M subscribers"), description present.
- `yt info https://www.youtube.com/@mkbhd` → ok, same + `verified: true`
  (@handle resolved via channel-type search; direct getChannel(@handle) 400s).
- NOTE: youtubei.js 18.1.0 returns PageHeader/PageHeaderView (not C4TabbedHeader);
  handle+subs parsed from `content.metadata.metadata_rows`. Channel-id path reports
  `verified: false` (best-effort — PageHeader carries no badge); handle path is exact.

## 6. edges

- `yt info -` with stdin ids → JSON array, all ok.
- `x search q` / `r search q` → `NOT_IMPLEMENTED`, exit 2.
- `yt info garbage` → `INVALID_INPUT`, exit 1.
- FETCH_FAILED hint contains "update youtubei.js (npm i youtubei.js@latest) and
  yt-dlp (brew upgrade yt-dlp) then retry" (unit-asserted).

Unit: 52 pass / 0 fail (`bun test`). Typecheck clean. `bun run build` → dist/asocial.js.
