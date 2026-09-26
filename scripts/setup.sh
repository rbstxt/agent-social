#!/bin/bash
# agent-social setup: installs the CLI, builds repo deps, guides cookie setup.
# (Skill installation is separate — see README, via `npx skills add`.)
# Usage: ./scripts/setup.sh [--yes] [--no-link] [--skip-redlib] [--skip-python] [--reconfigure]
# Unattended secrets: ASOCIAL_X_AUTH_TOKEN, ASOCIAL_X_CT0, ASOCIAL_YT_COOKIE.
# Secrets are read with echo disabled and never printed.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO/.env"
YES=0 LINK=1 BUILD_REDLIB=1 PY=1 RECONF=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    --no-link) LINK=0 ;;
    --skip-redlib) BUILD_REDLIB=0 ;;
    --skip-python) PY=0 ;;
    --reconfigure) RECONF=1 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

ok() { printf '  ok: %s\n' "$1"; }
warn() { printf '  warn: %s\n' "$1"; }
fail() { printf '  FAIL: %s\n' "$1"; FAILS=$((FAILS+1)); }
FAILS=0
have() { command -v "$1" >/dev/null 2>&1; }
ask_secret() { # $1=prompt -> stdout (no echo)
  local p="$1" ans
  printf '%s (input hidden, empty to skip): ' "$p" >/dev/tty
  IFS= read -rs ans </dev/tty || ans=""
  printf '\n' >/dev/tty
  printf '%s' "$ans"
}
env_get() { # $1=key -> value or empty
  [ -f "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']$//"
}
env_set() { # $1=key $2=value — replaces or appends, keeps other lines
  local k="$1" v="$2" tmp
  tmp="$(mktemp)" || return 1
  if [ -f "$ENV_FILE" ]; then grep -v -E "^$k=" "$ENV_FILE" >"$tmp" 2>/dev/null || true; fi
  printf '%s=%s\n' "$k" "$v" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
}

echo "== agent-social setup ($REPO)"
OS="$(uname -s)"
echo "-- OS: $OS"

echo "-- 1/7 runtime: node, package manager"
if have node; then ok "node $(node --version)"; else fail "node >=18 required: https://nodejs.org"; fi
if have bun; then PM="bun"; ok "bun $(bun --version)";
elif have npm; then PM="npm"; ok "npm (bun not found, using npm)";
else fail "need bun or npm"; PM=":"; fi

echo "-- 2/7 system binaries: ffmpeg, yt-dlp"
if have ffmpeg; then ok "ffmpeg"; else
  if [ "$OS" = Darwin ] && have brew; then brew install ffmpeg 2>&1 | tail -1; have ffmpeg && ok "ffmpeg installed" || fail "ffmpeg: run 'brew install ffmpeg'";
  else fail "ffmpeg missing: macOS 'brew install ffmpeg' / Debian/Ubuntu 'sudo apt install ffmpeg'"; fi
fi
if have yt-dlp; then ok "yt-dlp $(yt-dlp --version 2>/dev/null)";
elif [ "$PY" = 1 ] && have pipx; then pipx install yt-dlp >/dev/null 2>&1 && ok "yt-dlp (pipx)" || warn "pipx yt-dlp failed — trying pip";
else warn "yt-dlp not found (python step below may provide it)"; fi

echo "-- 3/7 python: twscrape (+ yt-dlp fallback)"
if [ "$PY" = 1 ]; then
  if ! have python3; then fail "python3 required for twscrape/yt-dlp";
  else
    for pkg in twscrape yt-dlp; do
      if have "$pkg"; then ok "$pkg already installed"; continue; fi
      if have pipx; then pipx install "$pkg" >/dev/null 2>&1 && ok "$pkg (pipx)" || warn "$pkg pipx failed";
      elif have pip3; then pip3 install --user "$pkg" >/dev/null 2>&1 && ok "$pkg (pip --user)" || warn "$pkg pip failed"; fi
      have "$pkg" || { [ "$pkg" = yt-dlp ] && fail "$pkg missing: pipx install yt-dlp / brew install yt-dlp"; }
      [ "$pkg" = twscrape ] && ! have "$pkg" && fail "$pkg missing: pipx install twscrape";
    done
    have twscrape && ok "twscrape $(twscrape --version 2>/dev/null || echo present)"
  fi
else ok "python step skipped"; fi

echo "-- 4/7 redlib binary (Reddit backend)"
REDLIB_FOUND=""
[ -n "${REDLIB_BIN:-}" ] && [ -x "$REDLIB_BIN" ] && REDLIB_FOUND="$REDLIB_BIN"
[ -z "$REDLIB_FOUND" ] && have redlib && REDLIB_FOUND="$(command -v redlib)"
[ -z "$REDLIB_FOUND" ] && [ -x "$HOME/.local/bin/redlib" ] && REDLIB_FOUND="$HOME/.local/bin/redlib"
if [ -n "$REDLIB_FOUND" ]; then ok "redlib already installed ($REDLIB_FOUND — skipping)";
elif [ "$BUILD_REDLIB" = 1 ]; then
  ARCH="$(uname -m)"; SYS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  if [ "$SYS" = linux ]; then
    case "$ARCH" in x86_64) T="x86_64-unknown-linux-musl";; aarch64|arm64) T="aarch64-unknown-linux-musl";; *) T="";; esac
    if [ -n "$T" ]; then
      URL="https://github.com/redlib-org/redlib/releases/latest/download/redlib-$T.tar.gz"
      mkdir -p "$HOME/.local/bin" && curl -sL "$URL" | tar -xz -C "$HOME/.local/bin" && chmod +x "$HOME/.local/bin/redlib" && ok "redlib downloaded" || warn "redlib download failed — see README";
    else warn "unsupported arch $ARCH — see README"; fi
  elif have cargo; then
    echo "   building redlib from source (several minutes)…"
    rm -rf /tmp/redlib-build && git clone -q https://github.com/redlib-org/redlib /tmp/redlib-build 2>/dev/null \
      && (cd /tmp/redlib-build && cargo build --release -q 2>&1 | tail -1) \
      && mkdir -p "$HOME/.local/bin" && cp /tmp/redlib-build/target/release/redlib "$HOME/.local/bin/redlib" \
      && ok "redlib built" || warn "redlib build failed — see README";
  else warn "need cargo (rustup.rs) or Docker to build redlib — see README"; fi
else ok "redlib step skipped"; fi

echo "-- 5/7 repo deps + build + link"
[ -f "$ENV_FILE" ] || { cp "$REPO/.env.example" "$ENV_FILE" 2>/dev/null && ok ".env created from example"; }
if [ "$PM" = bun ]; then (cd "$REPO" && bun install 2>&1 | tail -1 && bun run build 2>&1 | tail -1);
else (cd "$REPO" && npm install --no-audit --no-fund 2>&1 | tail -1 && npm run build 2>&1 | tail -1); fi
(cd "$REPO" && (bun test 2>&1 || npm test 2>&1) | tail -3)
if [ "$LINK" = 1 ]; then
  if have asocial; then ok "asocial already linked ($(command -v asocial) — skipping)";
  else (cd "$REPO" && npm link 2>&1 | tail -1) && ok "asocial linked globally" || warn "npm link failed — use ./dist/asocial.js directly"; fi
fi

echo "-- 6/7 macOS idle-reaper for Redlib (no resident process)"
if [ "$OS" = Darwin ]; then
  launchctl unload "$HOME/Library/LaunchAgents/com.agent-social.redlib.plist" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.agent-social.redlib.plist"
  mkdir -p "$HOME/.local/share/agent-social"
  if launchctl list 2>/dev/null | grep -q com.agent-social.redlib-reap; then
    ok "idle reaper already installed (skipping)"
  else
  cat >"$HOME/Library/LaunchAgents/com.agent-social.redlib-reap.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.agent-social.redlib-reap</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$REPO/scripts/redlib-idle-reap.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>600</integer>
  <key>StandardOutPath</key>
  <string>$HOME/.local/share/agent-social/redlib-reap.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.local/share/agent-social/redlib-reap.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$HOME/Library/LaunchAgents/com.agent-social.redlib-reap.plist" 2>/dev/null || true
  launchctl load "$HOME/Library/LaunchAgents/com.agent-social.redlib-reap.plist" 2>/dev/null \
    && ok "idle reaper installed (kills Redlib after 10 min idle)" \
    || warn "reaper plist install failed — see README";
  fi
else ok "non-macOS — run redlib on demand; CLI auto-starts it"; fi

echo "-- 7/7 credentials (.env — values stay in this file, never committed)"
echo "   Unattended: export ASOCIAL_X_AUTH_TOKEN / ASOCIAL_X_CT0 / ASOCIAL_YT_COOKIE."
echo "   X/Twitter cookies: browser DevTools → Application → Cookies → x.com → copy auth_token and ct0."
if [ -n "$(env_get X_AUTH_TOKEN)" ] && [ -n "$(env_get X_CT0)" ] && [ "$RECONF" = 0 ]; then ok "X cookies already set";
else
  A="${ASOCIAL_X_AUTH_TOKEN:-${X_AUTH_TOKEN:-}}"; C="${ASOCIAL_X_CT0:-${X_CT0:-}}"
  if [ -z "$A" ]; then A="$(ask_secret 'X auth_token')"; fi
  if [ -z "$C" ]; then C="$(ask_secret 'X ct0')"; fi
  if [ -n "$A" ] && [ -n "$C" ]; then env_set X_AUTH_TOKEN "$A"; env_set X_CT0 "$C"; ok "X cookies saved to .env";
  else warn "X cookies skipped — x commands will fail until set (re-run with --reconfigure)"; fi
fi
echo "   YouTube cookie (optional): youtube.com DevTools → Cookies → copy the whole Cookie header. Enables age-restricted videos."
if [ -n "$(env_get YT_COOKIE)" ] && [ "$RECONF" = 0 ]; then ok "YT cookie already set";
elif [ -n "$(env_get YT_COOKIES_FILE)" ] && [ "$RECONF" = 0 ]; then ok "YT cookie file already set ($(env_get YT_COOKIES_FILE) — skipping)";
else
  Y="${ASOCIAL_YT_COOKIE:-${YT_COOKIE:-}}"
  if [ -z "$Y" ]; then Y="$(ask_secret 'YT Cookie header')"; fi
  if [ -n "$Y" ]; then env_set YT_COOKIE "$Y"; ok "YT cookie saved (used by youtubei.js + yt-dlp frames)";
  else ok "YT cookie skipped (optional)"; fi
fi
chmod 600 "$ENV_FILE" 2>/dev/null || true

echo "== smoke"
(cd /tmp && asocial yt search "test" --limit 1 2>/dev/null | head -c 60; echo; asocial r status 2>/dev/null | head -c 120; echo)
[ "$FAILS" = 0 ] && echo "setup complete." || echo "setup done with $FAILS blocking issue(s) — see FAIL lines above."
exit "$([ "$FAILS" = 0 ] && echo 0 || echo 1)"
