#!/bin/bash
# Open DSH without restarting an existing server. Tokens stay in private files.
set -uo pipefail
umask 077
APP_MODE=0
if [ "${1:-}" = --app ]; then APP_MODE=1; fi
# App mode returns one result on FD 3, which the native parent owns.
open_target() {
  if [ "$APP_MODE" = 1 ]; then
    printf 'ready\t%s\n' "$1" >&3
  else
    "$OPEN_BIN" "$1"
  fi
}
PORT="${DSH_WEB_PORT:-3080}"
URL="http://127.0.0.1:${PORT}/"
DSH_BIN="${DSH_BIN:-/Applications/.dsh}"
LOG_DIR="${DSH_LOG_DIR:-$HOME/Library/Logs}"
LOG="$LOG_DIR/dsh-web.log"
URL_FILE="$LOG_DIR/dsh-web-url.txt"
WAIT_SECONDS="${DSH_WAIT_SECONDS:-90}"
# Injectable presentation commands for tests; neither receives validation output.
OPEN_BIN="${DSH_OPEN_BIN:-/usr/bin/open}"
DIALOG_BIN="${DSH_DIALOG_BIN:-}"
# A terminal launch already carries the user's PATH (mise, fnm, cargo); a Dock or
# Finder launch does not. Keep it for the fallback below.
CALLER_PATH="${PATH:-}"
# This script's own tools stay deterministic however it was launched.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

dialog() {
  if [ "$APP_MODE" = 1 ]; then printf 'error\n' >&3; return; fi
  if [ -n "$DIALOG_BIN" ]; then "$DIALOG_BIN" "$1"; return; fi
  /usr/bin/osascript - "$1" <<'APPLESCRIPT' >/dev/null 2>&1
on run argv
  display alert "DSH" message (item 1 of argv)
end run
APPLESCRIPT
}
recovery() {
  # Try the app's persistent cookie before asking for another launch URL.
  if [ "$APP_MODE" = 1 ]; then open_target "$URL"; return; fi
  local message="認証 URL を取得できませんでした。起動元のターミナルに表示された token= 付き URL を、同じブラウザで開いてください。既にログイン済みなら通常画面を開けます。サーバーは停止していません。"
  if [ -n "$DIALOG_BIN" ]; then
    "$DIALOG_BIN" "$message" "通常画面を開く" && open_target "$URL"
  else
    local answer
    answer=$(/usr/bin/osascript - "$message" <<'APPLESCRIPT'
on run argv
  set result to display dialog (item 1 of argv) with title "DSH" buttons {"閉じる", "通常画面を開く"} default button "閉じる"
  return button returned of result
end run
APPLESCRIPT
)
    [ "$answer" != "通常画面を開く" ] || open_target "$URL"
  fi
}
status() {
  /usr/bin/curl -q -s -o /dev/null -w '%{http_code}' --noproxy '*' --max-time 3 "$URL" 2>/dev/null || true
}
# Validate exact local origin and query before any network request. Do not follow
# redirects: acceptance requires DSH's cookie exchange and a clean-root redirect.
valid_token() {
  local candidate="$1" token headers
  case "$candidate" in "$URL"'?token='*) ;; *) return 1 ;; esac
  token="${candidate#*\?token=}"
  case "$token" in ''|*[!A-Za-z0-9._-]*) return 1 ;; esac
  headers=$(printf 'url = "%s"\n' "$candidate" | /usr/bin/curl -q -s --config - \
    --noproxy '*' --max-time 3 -D - -o /dev/null 2>/dev/null) || return 1
  printf '%s\n' "$headers" | /usr/bin/grep -Eq '^HTTP/[^ ]+ 303 ' || return 1
  printf '%s\n' "$headers" | /usr/bin/grep -Eiq '^set-cookie: ' || return 1
  printf '%s\n' "$headers" | /usr/bin/tr -d '\r' | /usr/bin/grep -Eiq '^location: /$'
}
open_existing() {
  local code="$1" candidate=""
  if [ "$code" = 200 ]; then open_target "$URL"; return; fi
  if [ "$code" = 401 ]; then
    [ ! -f "$URL_FILE" ] || candidate=$(<"$URL_FILE")
    if valid_token "$candidate"; then open_target "$candidate"; else recovery; fi
  else
    dialog "DSH が HTTP $code を返しました。接続先とサーバーのログを確認してください。"
  fi
}
# DSH and the bash tool it runs need the PATH the user's terminal has: under a
# Dock or Finder launch only the bare system PATH arrives, so ~/.local/bin
# (qrun, claude), mise/fnm shims, and cargo would disappear. Ask the login shell
# once instead of hardcoding a list. `DSH_LAUNCH_SHELL=""` disables the probe for
# tests; a probe that fails or returns nothing usable keeps the caller's PATH
# plus the fixed base set above.
resolve_server_path() {
  local shell_bin="${DSH_LAUNCH_SHELL-/bin/zsh}" resolved="" base
  if [ -n "$shell_bin" ] && [ -x "$shell_bin" ]; then
    # Ignore anything the rc files print: only the marked line is the PATH.
    resolved=$("$shell_bin" -ilc 'printf "DSH_PATH=%s\n" "$PATH"' 3>&- 2>/dev/null \
      | /usr/bin/grep -o 'DSH_PATH=.*' | /usr/bin/tail -n 1 | /usr/bin/sed 's/^DSH_PATH=//')
  fi
  # A PATH that lost the system directories is unusable; each check stands alone
  # because adjacent entries share the colon the patterns would both consume.
  case ":$resolved:" in *":/usr/bin:"*) ;; *) resolved="" ;; esac
  case ":$resolved:" in *":/bin:"*) ;; *) resolved="" ;; esac
  if [ -n "$resolved" ]; then
    base="$resolved"
  else
    base="${CALLER_PATH:+$CALLER_PATH:}/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  fi
  # User CLIs live in ~/.local/bin; the default DSH executable lives in Homebrew.
  case ":$base:" in *":$HOME/.local/bin:"*) ;; *) base="$HOME/.local/bin:$base" ;; esac
  case ":$base:" in *":/opt/homebrew/bin:"*) ;; *) base="/opt/homebrew/bin:$base" ;; esac
  PATH="$base"
  export PATH
}
mkdir -p "$LOG_DIR"
code=$(status)
if [ -n "$code" ] && [ "$code" != 000 ]; then open_existing "$code"; exit 0; fi
# A listening server may be temporarily unresponsive. Never start a competing
# process just because its HTTP probe timed out.
if [ "$APP_MODE" = 1 ] && [ -n "$(/usr/sbin/lsof -nP -a -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null)" ]; then
  dialog "接続先が応答しません。サーバーは停止していません。"
  exit 1
fi
resolve_server_path
if [ ! -x "$DSH_BIN" ]; then dialog "dsh が見つかりません: $DSH_BIN"; exit 1; fi
before=0
[ ! -f "$LOG" ] || before=$(/usr/bin/wc -l < "$LOG")
# Discard stale credentials before starting a new process.
: > "$URL_FILE"
chmod 600 "$URL_FILE"
if [ "$APP_MODE" = 1 ]; then
  # Extract credentials to the private URL file, never the normal server log.
  /usr/bin/nohup "$DSH_BIN" web --no-open --port "$PORT" > >(
    exec >/dev/null 2>&1 3>&-
    /usr/bin/awk -v urlfile="$URL_FILE" -v logfile="$LOG" '
      {
        if (match($0, /http:\/\/[^[:space:]]*token=[A-Za-z0-9._-]+/)) {
          print substr($0, RSTART, RLENGTH) > urlfile; close(urlfile)
          gsub(/http:\/\/[^[:space:]]*token=[A-Za-z0-9._-]+/, "[authentication URL omitted]")
        }
        print >> logfile; fflush(logfile)
      }'
  ) 2>&1 </dev/null 3>&- &
else
  /usr/bin/nohup "$DSH_BIN" web --no-open --port "$PORT" >> "$LOG" 2>&1 </dev/null 3>&- &
fi
launch_pid=$!
disown 2>/dev/null || true
deadline=$(( SECONDS + WAIT_SECONDS ))
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ "$APP_MODE" = 1 ]; then candidate=$(<"$URL_FILE"); else
  candidate=$(/usr/bin/tail -n "+$((before + 1))" "$LOG" | /usr/bin/grep -o 'http://[^[:space:]]*token=[A-Za-z0-9._-]*' | /usr/bin/tail -n 1)
  fi
  if valid_token "$candidate"; then
    printf '%s\n' "$candidate" > "$URL_FILE"
    open_target "$candidate"
    exit 0
  fi
  if ! kill -0 "$launch_pid" 2>/dev/null; then
    if /usr/bin/tail -n "+$((before + 1))" "$LOG" | /usr/bin/grep -q "EPERM.*operation not permitted"; then
      dialog "DSH の実行ファイルへのアクセスが拒否されました。システム設定 → プライバシーとセキュリティ → ファイルとフォルダで、DSH の書類フォルダへのアクセスを確認してください。ログ: $LOG"
    else
      dialog "DSH サーバーが起動中に終了しました。ログ: $LOG"
    fi
    exit 1
  fi
  /bin/sleep 1
done
code=$(status)
if [ "$code" = 200 ]; then open_target "$URL"; exit 0; fi
if [ "$code" = 401 ]; then recovery; else dialog "DSH の起動が ${WAIT_SECONDS} 秒以内に完了しませんでした。ログ: $LOG"; fi
exit 1
