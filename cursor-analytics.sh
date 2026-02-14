#!/bin/zsh

# Cursor Analytics - Team usage analytics via cursor.com API
# Uses Chrome DevTools Protocol to extract session cookies automatically
#
# Dependencies:
#   - websocat (brew install websocat)
#   - jq (brew install jq)
#
# Commands:
#   cursor-analytics login   - Authenticate with cursor.com via Chrome CDP
#   cursor-analytics get     - Fetch team analytics (with 10s cache)
#   cursor-analytics status  - Show current session status
#   cursor-analytics logout  - Clear saved session

CURSOR_SESSION_FILE="$HOME/.cursor-session"
CURSOR_CACHE_FILE="$HOME/.cursor-analytics-cache"
CURSOR_TEAM_ID="14135413"
CDP_PORT="9222"

# ── JWT utilities ────────────────────────────────────────────────────────────

_jwt_decode() {
  # Decode JWT payload and extract a field using jq
  # Usage: _jwt_decode "$token" ".exp"
  local token="$1"
  local field="${2:-.}"
  
  # URL-decode
  token="${token//\%3A/:}"
  token="${token//\%253A/:}"
  
  # Strip userId:: prefix
  if [[ "$token" == *"::"* ]]; then
    token="${token#*::}"
  fi
  
  # Extract payload (second segment)
  local payload
  payload="$(echo "$token" | cut -d. -f2)"
  
  # Add base64 padding
  local pad=$(( 4 - ${#payload} % 4 ))
  [[ $pad -lt 4 ]] && payload="${payload}$(printf '=%.0s' {1..$pad})"
  
  # Decode and extract field with jq
  echo "$payload" | base64 -d 2>/dev/null | jq -r "$field" 2>/dev/null
}

_jwt_is_valid() {
  # Check if JWT is still valid (not expired)
  local token="$1"
  local exp
  exp="$(_jwt_decode "$token" ".exp")"
  
  [[ -z "$exp" || "$exp" == "null" ]] && return 1
  
  local now
  now="$(date +%s)"
  
  # Consider expired if less than 1 day remaining
  (( exp - now > 86400 ))
}

_jwt_days_remaining() {
  # Return days remaining until JWT expires
  local token="$1"
  local exp
  exp="$(_jwt_decode "$token" ".exp")"
  
  [[ -z "$exp" || "$exp" == "null" ]] && echo "0" && return
  
  local now
  now="$(date +%s)"
  echo $(( (exp - now) / 86400 ))
}

# ── CDP utilities ────────────────────────────────────────────────────────────

_cdp_get_ws_url() {
  # Get WebSocket debugger URL from Chrome CDP
  curl -s "http://localhost:${CDP_PORT}/json/version" | jq -r '.webSocketDebuggerUrl' 2>/dev/null
}

_cdp_get_cookies() {
  # Extract cookies from Chrome via CDP
  # Returns cookie string suitable for curl -b
  local ws_url
  ws_url="$(_cdp_get_ws_url)"
  
  if [[ -z "$ws_url" || "$ws_url" == "null" ]]; then
    echo "ERROR: Could not connect to Chrome CDP. Is Chrome running with --remote-debugging-port=${CDP_PORT}?" >&2
    return 1
  fi
  
  # Send CDP command to get all cookies (using Storage domain, not Network)
  local response
  response="$(echo '{"method":"Storage.getCookies","params":{},"id":1}' | websocat -n1 "$ws_url" 2>/dev/null)"
  
  if [[ -z "$response" ]]; then
    echo "ERROR: CDP command failed" >&2
    return 1
  fi
  
  # Extract cursor.com cookies we need
  local session_token team_id
  session_token="$(echo "$response" | jq -r '.result.cookies[] | select(.domain | contains("cursor.com")) | select(.name == "WorkosCursorSessionToken") | .value' 2>/dev/null | head -1)"
  team_id="$(echo "$response" | jq -r '.result.cookies[] | select(.domain | contains("cursor.com")) | select(.name == "team_id") | .value' 2>/dev/null | head -1)"
  
  if [[ -z "$session_token" ]]; then
    echo "ERROR: WorkosCursorSessionToken not found in cookies" >&2
    return 1
  fi
  
  # Build cookie string
  local cookie_str="WorkosCursorSessionToken=${session_token}"
  [[ -n "$team_id" ]] && cookie_str="${cookie_str}; team_id=${team_id}"
  
  echo "$cookie_str"
}

# ── Session management ───────────────────────────────────────────────────────

_session_read() {
  # Read session cookie from file
  [[ -f "$CURSOR_SESSION_FILE" ]] && cat "$CURSOR_SESSION_FILE"
}

_session_get_token() {
  # Extract WorkosCursorSessionToken value from session file
  local cookie_str
  cookie_str="$(_session_read)"
  [[ -z "$cookie_str" ]] && return 1
  
  echo "$cookie_str" | tr ';' '\n' | grep 'WorkosCursorSessionToken=' | sed 's/.*WorkosCursorSessionToken=//' | xargs
}

_session_is_valid() {
  # Check if cached session exists and is not expired
  local token
  token="$(_session_get_token)"
  
  [[ -z "$token" ]] && return 1
  
  _jwt_is_valid "$token"
}

# ── Cache management ─────────────────────────────────────────────────────────

_cache_is_fresh() {
  # Check if cache file exists and is less than 10 seconds old
  [[ ! -f "$CURSOR_CACHE_FILE" ]] && return 1
  
  local cache_age
  cache_age="$(( $(date +%s) - $(stat -f %m "$CURSOR_CACHE_FILE" 2>/dev/null || stat -c %Y "$CURSOR_CACHE_FILE" 2>/dev/null || echo 0) ))"
  
  (( cache_age < 10 ))
}

_cache_read() {
  # Read cached response
  [[ -f "$CURSOR_CACHE_FILE" ]] && cat "$CURSOR_CACHE_FILE"
}

_cache_write() {
  # Write response to cache
  cat > "$CURSOR_CACHE_FILE"
}

# ── Commands ─────────────────────────────────────────────────────────────────

cursor_analytics_login() {
  echo "Launching Chrome with remote debugging enabled..."
  echo ""
  
  # Always use a temporary profile to avoid conflicts with existing Chrome instances
  local chrome_data_dir="/tmp/cursor-analytics-chrome-$$"
  mkdir -p "$chrome_data_dir"
  echo "Using temporary profile (will be cleaned up after login)"
  echo ""
  
  # Launch Chrome with CDP enabled
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
    --remote-debugging-port="${CDP_PORT}" \
    --user-data-dir="$chrome_data_dir" \
    "https://cursor.com/dashboard" \
    >/dev/null 2>&1 &
  
  local chrome_pid=$!
  
  # Wait for Chrome to start
  sleep 2
  
  # Verify Chrome is running with CDP
  if ! lsof -nP -iTCP:"${CDP_PORT}" | grep -q LISTEN; then
    echo "ERROR: Chrome did not start with remote debugging port ${CDP_PORT}" >&2
    return 1
  fi
  
  echo "✓ Chrome launched with remote debugging on port ${CDP_PORT}"
  echo ""
  echo "Please log in to cursor.com in the Chrome window."
  echo "Once you're logged in and see the dashboard, press Enter to continue..."
  read
  
  echo ""
  echo "Extracting session cookie via CDP..."
  
  local cookie_str
  cookie_str="$(_cdp_get_cookies)"
  
  if [[ $? -ne 0 || -z "$cookie_str" ]]; then
    echo ""
    echo "Failed to extract cookies. Make sure:" >&2
    echo "  1. You're logged in at cursor.com/dashboard" >&2
    echo "  2. Chrome is still running" >&2
    return 1
  fi
  
  # Save session
  echo "$cookie_str" > "$CURSOR_SESSION_FILE"
  chmod 600 "$CURSOR_SESSION_FILE"
  
  # Extract and validate token
  local token
  token="$(_session_get_token)"
  
  if [[ -z "$token" ]]; then
    echo "ERROR: Could not parse session token" >&2
    return 1
  fi
  
  # Show session info
  local exp days_remaining user_id
  exp="$(_jwt_decode "$token" ".exp")"
  user_id="$(_jwt_decode "$token" ".sub")"
  days_remaining="$(_jwt_days_remaining "$token")"
  
  echo ""
  echo "✓ Session saved successfully!"
  echo ""
  echo "User ID:         $user_id"
  if [[ -n "$exp" && "$exp" != "null" ]]; then
    local exp_date
    exp_date="$(date -r "$exp" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)"
    echo "Expires:         $exp_date"
    echo "Valid for:       ${days_remaining} days"
  fi
  echo ""
  
  # Cleanup temporary profile
  echo "Closing Chrome and cleaning up temporary profile..."
  kill "$chrome_pid" 2>/dev/null
  sleep 1
  rm -rf "$chrome_data_dir" 2>/dev/null
  echo "✓ Temporary profile cleaned up"
  echo ""
  
  echo "Run 'cursor-analytics get' to fetch team usage data."
}

cursor_analytics_get() {
  local raw_output=false
  
  # Parse flags
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --raw|-r)
        raw_output=true
        shift
        ;;
      *)
        echo "Unknown option: $1" >&2
        echo "Usage: cursor-analytics get [--raw]" >&2
        return 1
        ;;
    esac
  done
  
  # Check cache first
  if _cache_is_fresh; then
    local cached
    cached="$(_cache_read)"
    if [[ -n "$cached" ]]; then
      if $raw_output; then
        echo "$cached"
      else
        _format_usage_output "$cached"
      fi
      return 0
    fi
  fi
  
  # Validate session
  if ! _session_is_valid; then
    echo "ERROR: No valid session found." >&2
    echo "Run 'cursor-analytics login' to authenticate." >&2
    return 1
  fi
  
  # Get session cookie
  local cookie_str
  cookie_str="$(_session_read)"
  
  # Make API request
  local response
  response="$(curl -s 'https://cursor.com/api/dashboard/get-team-spend' \
    -H 'accept: application/json' \
    -H 'content-type: application/json' \
    -H 'origin: https://cursor.com' \
    -H 'referer: https://cursor.com/dashboard?tab=usage' \
    -b "$cookie_str" \
    --data-raw "{\"teamId\":${CURSOR_TEAM_ID}}")"
  
  # Check if response is valid
  if ! echo "$response" | jq -e '.totalMembers' >/dev/null 2>&1; then
    echo "ERROR: API request failed or returned invalid data." >&2
    echo "Response: $response" >&2
    echo "" >&2
    echo "Your session may have expired. Try:" >&2
    echo "  cursor-analytics logout" >&2
    echo "  cursor-analytics login" >&2
    return 1
  fi
  
  # Cache response
  echo "$response" | _cache_write
  
  # Output
  if $raw_output; then
    echo "$response"
  else
    _format_usage_output "$response"
  fi
}

_format_usage_output() {
  # Format the API response in a friendly, human-readable way
  local response="$1"
  
  # Extract values
  local max_spend_cents next_cycle_start
  max_spend_cents="$(echo "$response" | jq -r '.maxUserSpendCents // 0')"
  next_cycle_start="$(echo "$response" | jq -r '.nextCycleStart')"
  
  # Find the user with the highest spend (that's you!)
  local user_email user_name
  user_email="$(echo "$response" | jq -r '.teamMemberSpend | map(select(.spendCents != null)) | sort_by(-.spendCents) | .[0].email // empty')"
  user_name="$(echo "$response" | jq -r '.teamMemberSpend | map(select(.spendCents != null)) | sort_by(-.spendCents) | .[0].name // empty')"
  
  # Convert cents to dollars with formatting
  local dollars cents_part
  dollars=$(( max_spend_cents / 100 ))
  cents_part=$(( max_spend_cents % 100 ))
  
  # Add thousand separators
  local formatted_dollars
  formatted_dollars="$(printf "%'d" "$dollars" 2>/dev/null || echo "$dollars")"
  
  # Format as currency
  local max_spend
  max_spend="$(printf "\$ %s.%02d" "$formatted_dollars" "$cents_part")"
  
  # Calculate cycle renewal date and days remaining
  local cycle_timestamp cycle_date days_until now
  cycle_timestamp=$(( next_cycle_start / 1000 ))
  cycle_date="$(date -r "$cycle_timestamp" '+%b %-d' 2>/dev/null)"
  now="$(date +%s)"
  days_until=$(( (cycle_timestamp - now) / 86400 ))
  
  # Build renewal string
  local renewal_str
  if (( days_until == 0 )); then
    renewal_str="$cycle_date, today"
  elif (( days_until == 1 )); then
    renewal_str="$cycle_date, tomorrow"
  elif (( days_until < 0 )); then
    renewal_str="$cycle_date (overdue)"
  else
    renewal_str="$cycle_date, in $days_until days"
  fi
  
  # Output formatted summary
  echo "Cursor Usage"
  echo ""
  if [[ -n "$user_email" ]]; then
    echo "User:            $user_email"
  fi
  echo "Your spend:      $max_spend"
  echo "Cycle renews:    $renewal_str"
}

cursor_analytics_status() {
  if [[ ! -f "$CURSOR_SESSION_FILE" ]]; then
    echo "No session found."
    echo "Run 'cursor-analytics login' to authenticate."
    return 1
  fi
  
  local token
  token="$(_session_get_token)"
  
  if [[ -z "$token" ]]; then
    echo "Session file exists but is invalid."
    return 1
  fi
  
  # Extract JWT fields
  local user_id exp now days_remaining exp_date
  user_id="$(_jwt_decode "$token" ".sub")"
  exp="$(_jwt_decode "$token" ".exp")"
  now="$(date +%s)"
  
  echo "Session file:    $CURSOR_SESSION_FILE"
  echo "User ID:         $user_id"
  
  if [[ -n "$exp" && "$exp" != "null" ]]; then
    days_remaining=$(( (exp - now) / 86400 ))
    exp_date="$(date -r "$exp" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)"
    
    echo "Expires:         $exp_date"
    echo "Days remaining:  $days_remaining"
    echo ""
    
    if (( days_remaining < 1 )); then
      echo "Status:          EXPIRED"
      echo ""
      echo "Run 'cursor-analytics login' to re-authenticate."
    elif (( days_remaining < 7 )); then
      echo "Status:          Valid (expiring soon)"
    else
      echo "Status:          Valid"
    fi
  else
    echo "Status:          Unknown (could not parse expiry)"
  fi
}

cursor_analytics_logout() {
  local removed=false
  
  if [[ -f "$CURSOR_SESSION_FILE" ]]; then
    rm -f "$CURSOR_SESSION_FILE"
    echo "✓ Removed session file"
    removed=true
  fi
  
  if [[ -f "$CURSOR_CACHE_FILE" ]]; then
    rm -f "$CURSOR_CACHE_FILE"
    echo "✓ Removed cache file"
    removed=true
  fi
  
  if ! $removed; then
    echo "No session or cache files to remove."
  else
    echo ""
    echo "Logged out successfully."
  fi
}

cursor_analytics_help() {
  cat <<'EOF'
Cursor Analytics - Team usage analytics

Usage:
  cursor-analytics <command> [options]

Commands:
  login               Authenticate with cursor.com via Chrome CDP
  get [--raw]         Fetch team usage (formatted by default, --raw for JSON)
  status              Show current session status and expiry
  logout              Clear saved session and cache
  help                Show this help message

Examples:
  cursor-analytics login
  cursor-analytics get                           # Friendly formatted output
  cursor-analytics get --raw | jq '.totalMembers' # Full JSON output
  cursor-analytics status
  cursor-analytics logout

Dependencies:
  - websocat (brew install websocat)
  - jq (brew install jq)
EOF
}

# ── Main dispatcher ──────────────────────────────────────────────────────────

cursor-analytics() {
  local command="${1:-help}"
  shift || true
  
  case "$command" in
    login)
      cursor_analytics_login "$@"
      ;;
    get)
      cursor_analytics_get "$@"
      ;;
    status)
      cursor_analytics_status "$@"
      ;;
    logout)
      cursor_analytics_logout "$@"
      ;;
    help|--help|-h)
      cursor_analytics_help
      ;;
    *)
      echo "Unknown command: $command" >&2
      echo "Run 'cursor-analytics help' for usage." >&2
      return 1
      ;;
  esac
}
